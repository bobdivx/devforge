//! SSO OIDC pour connexion à la plateforme DevForge elle-même (distinct du SSO des apps déployées).

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Redirect},
    routing::get,
    Json, Router,
};
use chrono::{Duration, Utc};
use serde::{Deserialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::Instant;
use sha2::{Sha256, Digest};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

use crate::auth_routes;
use crate::sso::{load_sso_settings, SsoSettings};
use crate::state::{now_str, AppState};

/// Cache global des découvertes OIDC (issuer → endpoints + timestamp).
static OIDC_DISCOVERY_CACHE: once_cell::sync::Lazy<Arc<RwLock<HashMap<String, CachedDiscovery>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

/// Durée de cache pour les endpoints découverts (5 minutes).
const DISCOVERY_CACHE_TTL_SECS: u64 = 300;

#[derive(Debug, Clone)]
struct CachedDiscovery {
    authorization_endpoint: Option<String>,
    token_endpoint: String,
    userinfo_endpoint: String,
    cached_at: Instant,
}

#[derive(Debug, Deserialize)]
pub(crate) struct OidcDiscoveryDocument {
    pub authorization_endpoint: Option<String>,
    pub token_endpoint: Option<String>,
    pub userinfo_endpoint: Option<String>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/auth/sso/authorize", get(authorize))
        .route("/api/v1/auth/sso/callback", get(callback))
}

/// Génère le state CSRF + nonce et redirige vers l'IdP.
async fn authorize(State(state): State<AppState>) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let cfg = load_sso_settings(&state.pool).await;
    
    if !cfg.enable_platform_login() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error": "SSO plateforme non activé"})),
        ));
    }
    
    if !cfg.oidc_configured() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "OIDC non configuré"})),
        ));
    }

    let state_token = generate_state_token();
    let nonce = generate_nonce();
    let code_verifier = generate_code_verifier();
    let code_challenge = compute_code_challenge(&code_verifier);
    
    // Stockage temporaire du state/nonce/verifier (15 min expiration)
    let now = now_str();
    let expires = (Utc::now() + Duration::minutes(15)).to_rfc3339();
    sqlx::query(
        r#"INSERT INTO oidc_states (state, nonce, code_verifier, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(state) DO UPDATE SET nonce = ?, code_verifier = ?, expires_at = ?"#
    )
    .bind(&state_token)
    .bind(&nonce)
    .bind(&code_verifier)
    .bind(&expires)
    .bind(&now)
    .bind(&nonce)
    .bind(&code_verifier)
    .bind(&expires)
    .execute(&state.pool)
    .await
    .map_err(internal)?;

    let redirect_uri = platform_redirect_uri(&state).await?;
    let endpoints = resolve_oidc_endpoints(&cfg).await;
    let auth_url = build_authorization_url(&cfg, &endpoints, &state_token, &nonce, &redirect_uri, &code_challenge);
    
    Ok(Redirect::to(&auth_url))
}

#[derive(Deserialize)]
struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

/// Callback OIDC : échange le code contre un token, extrait l'email, crée/lie un utilisateur DevForge.
async fn callback(
    State(state): State<AppState>,
    Query(query): Query<CallbackQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let cfg = load_sso_settings(&state.pool).await;
    
    if !cfg.enable_platform_login() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error": "SSO plateforme non activé"})),
        ));
    }

    // Gestion des erreurs OIDC
    if let Some(err) = query.error {
        let desc = query.error_description.unwrap_or_else(|| "Erreur OIDC".to_string());
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": format!("OIDC: {} - {}", err, desc)})),
        ));
    }

    let code = query.code.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Code OIDC manquant"})),
        )
    })?;

    let state_param = query.state.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "State manquant"})),
        )
    })?;

    // Vérification du state CSRF
    let nonce_row: Option<(String, String, String)> = sqlx::query_as(
        r#"SELECT nonce, code_verifier, expires_at FROM oidc_states WHERE state = ?"#
    )
    .bind(&state_param)
    .fetch_optional(&state.pool)
    .await
    .map_err(internal)?;

    let (nonce, code_verifier, expires_at) = nonce_row.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "State invalide ou expiré"})),
        )
    })?;

    let now = Utc::now().to_rfc3339();
    if expires_at < now {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "State expiré"})),
        ));
    }

    // Suppression du state après validation
    let _ = sqlx::query("DELETE FROM oidc_states WHERE state = ?")
        .bind(&state_param)
        .execute(&state.pool)
        .await;

    // Échange du code contre un token
    let redirect_uri = platform_redirect_uri(&state).await?;
    let endpoints = resolve_oidc_endpoints(&cfg).await;
    let token_response = exchange_code_for_token(&cfg, &endpoints, &code, &redirect_uri, &code_verifier).await?;
    
    // Récupération des infos utilisateur
    let user_info = fetch_user_info(&cfg, &endpoints, &token_response.access_token, &nonce).await?;
    
    // Mapping de l'utilisateur IdP vers DevForge
    let user_uuid = map_or_create_user(&state, &user_info).await?;
    
    // Création de la session DevForge
    let session_token = auth_routes::create_session(&state, &user_uuid).await?;
    
    // Redirection vers l'application avec le token en paramètre (sera stocké par le frontend)
    let redirect_url = format!("/login?sso_token={}", urlencoding::encode(&session_token));
    Ok(Redirect::to(&redirect_url))
}

fn generate_state_token() -> String {
    // Utilise UUID pour générer des valeurs aléatoires sécurisées
    let uuid1 = uuid::Uuid::new_v4();
    let uuid2 = uuid::Uuid::new_v4();
    format!("{}{}", uuid1.as_simple(), uuid2.as_simple())
}

fn generate_nonce() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Génère un code_verifier PKCE (43-128 caractères, unreserved).
fn generate_code_verifier() -> String {
    let uuid1 = uuid::Uuid::new_v4();
    let uuid2 = uuid::Uuid::new_v4();
    format!("{}{}", uuid1.as_simple(), uuid2.as_simple())
}

/// Calcule le code_challenge S256 : BASE64URL(SHA256(verifier)) sans padding.
pub(crate) fn compute_code_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let hash = hasher.finalize();
    URL_SAFE_NO_PAD.encode(&hash)
}

async fn platform_redirect_uri(state: &AppState) -> Result<String, (StatusCode, Json<Value>)> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT instance_url FROM instance_settings WHERE id = 1"
    )
    .fetch_optional(&state.pool)
    .await
    .map_err(internal)?;
    
    let instance_url = row
        .map(|(url,)| url)
        .filter(|url| !url.trim().is_empty())
        .ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "URL instance non configurée"})),
            )
        })?;
    
    Ok(format!("{}/api/v1/auth/sso/callback", instance_url.trim_end_matches('/')))
}

/// Résout les endpoints OIDC via découverte, avec fallbacks.
pub(crate) async fn resolve_oidc_endpoints(cfg: &SsoSettings) -> OidcEndpoints {
    let issuer = cfg.issuer().to_string();
    
    // Vérifier le cache d'abord
    if let Some(cached) = get_cached_discovery(&issuer) {
        return OidcEndpoints {
            authorization_endpoint: cached.authorization_endpoint.clone(),
            token_endpoint: cached.token_endpoint.clone(),
            userinfo_endpoint: cached.userinfo_endpoint.clone(),
        };
    }
    
    // Tentative de découverte OIDC
    if let Some(discovered) = discover_oidc_endpoints(&issuer).await {
        // Mise en cache
        let cached = CachedDiscovery {
            authorization_endpoint: discovered.authorization_endpoint.clone(),
            token_endpoint: discovered.token_endpoint.clone(),
            userinfo_endpoint: discovered.userinfo_endpoint.clone(),
            cached_at: Instant::now(),
        };
        
        if let Ok(mut cache) = OIDC_DISCOVERY_CACHE.write() {
            cache.insert(issuer.clone(), cached);
        }
        
        return discovered;
    }
    
    // Fallback selon le provider
    if cfg.is_pocket_id() {
        OidcEndpoints {
            authorization_endpoint: Some(format!("{}/authorize", issuer)),
            token_endpoint: format!("{}/api/oidc/token", issuer),
            userinfo_endpoint: format!("{}/api/oidc/userinfo", issuer),
        }
    } else {
        // Fallback OIDC générique
        OidcEndpoints {
            authorization_endpoint: Some(format!("{}/authorize", issuer)),
            token_endpoint: format!("{}/token", issuer),
            userinfo_endpoint: format!("{}/userinfo", issuer),
        }
    }
}

/// Récupère les endpoints depuis le cache si valides.
fn get_cached_discovery(issuer: &str) -> Option<CachedDiscovery> {
    let cache = OIDC_DISCOVERY_CACHE.read().ok()?;
    let cached = cache.get(issuer)?;
    
    // Vérifier la durée de vie
    if cached.cached_at.elapsed().as_secs() < DISCOVERY_CACHE_TTL_SECS {
        Some(cached.clone())
    } else {
        None
    }
}

/// Tente de découvrir les endpoints OIDC via /.well-known/openid-configuration.
async fn discover_oidc_endpoints(issuer: &str) -> Option<OidcEndpoints> {
    let discovery_url = format!("{}/.well-known/openid-configuration", issuer);
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .ok()?;
    
    let response = client.get(&discovery_url).send().await.ok()?;
    
    if !response.status().is_success() {
        return None;
    }
    
    let doc: OidcDiscoveryDocument = response.json().await.ok()?;
    
    // Les endpoints token et userinfo sont requis
    let token_endpoint = doc.token_endpoint?;
    let userinfo_endpoint = doc.userinfo_endpoint?;
    
    Some(OidcEndpoints {
        authorization_endpoint: doc.authorization_endpoint,
        token_endpoint,
        userinfo_endpoint,
    })
}

#[derive(Debug, Clone)]
pub(crate) struct OidcEndpoints {
    pub authorization_endpoint: Option<String>,
    pub token_endpoint: String,
    pub userinfo_endpoint: String,
}

pub(crate) fn build_authorization_url(
    cfg: &SsoSettings,
    endpoints: &OidcEndpoints,
    state: &str,
    nonce: &str,
    redirect_uri: &str,
    code_challenge: &str,
) -> String {
    let issuer = cfg.issuer();
    let client_id = cfg.sso_apps_client_id.trim();
    
    let params = [
        ("response_type", "code"),
        ("client_id", client_id),
        ("redirect_uri", redirect_uri),
        ("scope", "openid email profile"),
        ("state", state),
        ("nonce", nonce),
        ("code_challenge", code_challenge),
        ("code_challenge_method", "S256"),
    ];
    
    let query = params
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");
    
    // Utiliser le endpoint découvert si disponible, sinon fallback
    let default_auth_endpoint = format!("{}/authorize", issuer);
    let auth_endpoint = endpoints
        .authorization_endpoint
        .as_deref()
        .unwrap_or(&default_auth_endpoint);
    
    format!("{}?{}", auth_endpoint, query)
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    id_token: Option<String>,
    token_type: Option<String>,
    expires_in: Option<u64>,
}

async fn exchange_code_for_token(
    cfg: &SsoSettings,
    endpoints: &OidcEndpoints,
    code: &str,
    redirect_uri: &str,
    code_verifier: &str,
) -> Result<TokenResponse, (StatusCode, Json<Value>)> {
    let token_endpoint = &endpoints.token_endpoint;
    
    let params = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("client_id", cfg.sso_apps_client_id.trim()),
        ("client_secret", cfg.sso_apps_client_secret.trim()),
        ("code_verifier", code_verifier),
    ];
    
    let client = reqwest::Client::new();
    let response = client
        .post(token_endpoint)
        .form(&params)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Erreur requête token IdP: {}", e);
            (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Impossible de contacter le serveur d'authentification"})),
            )
        })?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        tracing::error!("Token exchange failed {}: {}", status, text);
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Échec de l'authentification. Vérifie tes identifiants."})),
        ));
    }
    
    response.json::<TokenResponse>().await.map_err(|e| {
        tracing::error!("Erreur parsing token response: {}", e);
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Réponse invalide du serveur d'authentification"})),
        )
    })
}

#[derive(Debug, Deserialize)]
struct UserInfo {
    sub: String,
    email: Option<String>,
    email_verified: Option<bool>,
    name: Option<String>,
    preferred_username: Option<String>,
}

async fn fetch_user_info(
    _cfg: &SsoSettings,
    endpoints: &OidcEndpoints,
    access_token: &str,
    _nonce: &str,
) -> Result<UserInfo, (StatusCode, Json<Value>)> {
    let userinfo_endpoint = &endpoints.userinfo_endpoint;
    
    let client = reqwest::Client::new();
    let response = client
        .get(userinfo_endpoint)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Erreur requête userinfo IdP: {}", e);
            (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Impossible de récupérer tes informations utilisateur"})),
            )
        })?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        tracing::error!("Userinfo failed {}: {}", status, text);
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Impossible de récupérer tes informations utilisateur"})),
        ));
    }
    
    response.json::<UserInfo>().await.map_err(|e| {
        tracing::error!("Erreur parsing userinfo response: {}", e);
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Réponse invalide du serveur d'authentification"})),
        )
    })
}

/// Mapping de l'utilisateur IdP vers DevForge.
/// Stratégie conservatrice : lie par email un utilisateur existant, ou refuse si aucun match.
async fn map_or_create_user(
    state: &AppState,
    user_info: &UserInfo,
) -> Result<String, (StatusCode, Json<Value>)> {
    let email = user_info
        .email
        .as_ref()
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Email manquant dans les claims OIDC"})),
            )
        })?
        .trim()
        .to_lowercase();
    
    if email.is_empty() || !email.contains('@') {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Email invalide"})),
        ));
    }
    
    // Recherche d'un utilisateur existant par email
    let existing: Option<(String,)> = sqlx::query_as(
        "SELECT uuid FROM users WHERE LOWER(email) = ?"
    )
    .bind(&email)
    .fetch_optional(&state.pool)
    .await
    .map_err(internal)?;
    
    if let Some((uuid,)) = existing {
        // Utilisateur existant trouvé : authentification réussie
        return Ok(uuid);
    }
    
    // Politique conservatrice : pas de création automatique sauf si inscription ouverte
    // ou si c'est le premier utilisateur (admin)
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(&state.pool)
        .await
        .map_err(internal)?;
    
    let allow_create = count.0 == 0 || registration_open();
    
    if !allow_create {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Aucun compte DevForge associé à cet email. Demande à un admin de créer ton compte d'abord."
            })),
        ));
    }
    
    // Création d'un nouvel utilisateur
    let user_uuid = uuid::Uuid::new_v4().to_string();
    let name = user_info
        .name
        .as_deref()
        .or(user_info.preferred_username.as_deref())
        .unwrap_or(&email)
        .trim()
        .to_string();
    
    let role = if count.0 == 0 {
        "instance_admin"
    } else {
        "user"
    };
    
    let now = now_str();
    
    // Pas de password hash (authentification SSO uniquement)
    let dummy_hash = "$argon2id$v=19$m=19456,t=2,p=1$SSO_ONLY$SSO_ONLY";
    
    sqlx::query(
        r#"INSERT INTO users (uuid, email, name, password_hash, role, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)"#
    )
    .bind(&user_uuid)
    .bind(&email)
    .bind(&name)
    .bind(dummy_hash)
    .bind(role)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(internal)?;
    
    // Création d'un workspace pour le nouvel utilisateur (sauf admin)
    if role != "instance_admin" {
        let team_uuid = uuid::Uuid::new_v4().to_string();
        let team_name = format!("Workspace · {}", name);
        let team_slug = format!("{}-{}", devforge_auth::slugify(&team_name), &user_uuid[..6]);
        
        sqlx::query(
            r#"INSERT INTO teams (uuid, name, slug, show_boarding, plan, created_at, updated_at)
               VALUES (?, ?, ?, 0, 'free', ?, ?)"#
        )
        .bind(&team_uuid)
        .bind(&team_name)
        .bind(&team_slug)
        .bind(&now)
        .bind(&now)
        .execute(&state.pool)
        .await
        .map_err(internal)?;
        
        sqlx::query(
            r#"INSERT INTO team_members (team_uuid, user_uuid, role, created_at)
               VALUES (?, ?, 'owner', ?)"#
        )
        .bind(&team_uuid)
        .bind(&user_uuid)
        .bind(&now)
        .execute(&state.pool)
        .await
        .map_err(internal)?;
    }
    
    Ok(user_uuid)
}

fn registration_open() -> bool {
    matches!(
        std::env::var("DEVFORGE_ALLOW_REGISTER")
            .unwrap_or_default()
            .to_lowercase()
            .as_str(),
        "1" | "true" | "yes"
    )
}

fn internal(e: impl std::fmt::Display) -> (StatusCode, Json<Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"error": e.to_string()})),
    )
}
