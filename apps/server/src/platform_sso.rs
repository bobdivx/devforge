//! SSO OIDC pour connexion à la plateforme DevForge elle-même (distinct du SSO des apps déployées).

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Redirect},
    routing::get,
    Json, Router,
};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::auth_routes;
use crate::sso::{load_sso_settings, SsoSettings};
use crate::state::{now_str, AppState};

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
    
    // Stockage temporaire du state/nonce (15 min expiration)
    let now = now_str();
    let expires = (Utc::now() + Duration::minutes(15)).to_rfc3339();
    sqlx::query(
        r#"INSERT INTO oidc_states (state, nonce, expires_at, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(state) DO UPDATE SET nonce = ?, expires_at = ?"#
    )
    .bind(&state_token)
    .bind(&nonce)
    .bind(&expires)
    .bind(&now)
    .bind(&nonce)
    .bind(&expires)
    .execute(&state.pool)
    .await
    .map_err(internal)?;

    let redirect_uri = platform_redirect_uri(&state).await?;
    let auth_url = build_authorization_url(&cfg, &state_token, &nonce, &redirect_uri);
    
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
    let nonce_row: Option<(String, String)> = sqlx::query_as(
        r#"SELECT nonce, expires_at FROM oidc_states WHERE state = ?"#
    )
    .bind(&state_param)
    .fetch_optional(&state.pool)
    .await
    .map_err(internal)?;

    let (nonce, expires_at) = nonce_row.ok_or_else(|| {
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
    let token_response = exchange_code_for_token(&cfg, &code, &redirect_uri).await?;
    
    // Récupération des infos utilisateur
    let user_info = fetch_user_info(&cfg, &token_response.access_token, &nonce).await?;
    
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

fn build_authorization_url(cfg: &SsoSettings, state: &str, nonce: &str, redirect_uri: &str) -> String {
    let issuer = cfg.issuer();
    let client_id = cfg.sso_apps_client_id.trim();
    
    let params = [
        ("response_type", "code"),
        ("client_id", client_id),
        ("redirect_uri", redirect_uri),
        ("scope", "openid email profile"),
        ("state", state),
        ("nonce", nonce),
    ];
    
    let query = params
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");
    
    format!("{}/authorize?{}", issuer, query)
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
    code: &str,
    redirect_uri: &str,
) -> Result<TokenResponse, (StatusCode, Json<Value>)> {
    let issuer = cfg.issuer();
    let token_endpoint = format!("{}/token", issuer);
    
    let params = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("client_id", cfg.sso_apps_client_id.trim()),
        ("client_secret", cfg.sso_apps_client_secret.trim()),
    ];
    
    let client = reqwest::Client::new();
    let response = client
        .post(&token_endpoint)
        .form(&params)
        .send()
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error": format!("Erreur IdP token: {}", e)})),
            )
        })?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("IdP token error {}: {}", status, text)})),
        ));
    }
    
    response.json::<TokenResponse>().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Erreur parsing token: {}", e)})),
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
    cfg: &SsoSettings,
    access_token: &str,
    _nonce: &str,
) -> Result<UserInfo, (StatusCode, Json<Value>)> {
    let issuer = cfg.issuer();
    let userinfo_endpoint = format!("{}/userinfo", issuer);
    
    let client = reqwest::Client::new();
    let response = client
        .get(&userinfo_endpoint)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error": format!("Erreur IdP userinfo: {}", e)})),
            )
        })?;
    
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("IdP userinfo error {}: {}", status, text)})),
        ));
    }
    
    response.json::<UserInfo>().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": format!("Erreur parsing userinfo: {}", e)})),
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
