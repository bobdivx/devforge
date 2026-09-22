//! Settings SSO instance (OIDC générique / Pocket ID + ForwardAuth).

use axum::{extract::State, http::HeaderMap, routing::get, Json, Router};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::pocket_id;
use crate::sso::{self, SsoSettings, PROVIDER_POCKET_ID};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/v1/settings/sso", get(get_sso).put(put_sso))
}

async fn require_admin(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(), (axum::http::StatusCode, Json<Value>)> {
    let (user, _) = crate::auth_routes::current_workspace(state, headers).await?;
    if user.role != "instance_admin" {
        return Err((
            axum::http::StatusCode::FORBIDDEN,
            Json(json!({"error": "admin requis"})),
        ));
    }
    Ok(())
}

fn view(cfg: &SsoSettings) -> Value {
    let issuer = cfg.issuer();
    json!({
        "provider": cfg.provider(),
        "issuer_url": issuer,
        "protect_apps_by_default": cfg.protect_by_default(),
        "forward_auth_address": cfg.sso_forward_auth_address,
        "hide_local_login": cfg.hide_local_login(),
        "enable_platform_login": cfg.enable_platform_login(),
        "pocket_id_url": cfg.sso_pocket_id_url,
        "oauth2_proxy_url": cfg.sso_oauth2_proxy_url,
        "apps_client_id": cfg.sso_apps_client_id,
        "apps_client_secret_set": !cfg.sso_apps_client_secret.trim().is_empty(),
        "pocket_id_api_token_set": !cfg.sso_pocket_id_api_token.trim().is_empty(),
        "forward_auth_configured": cfg.forward_auth_configured() || cfg.effective_forward_auth_address().is_some(),
        "oidc_configured": cfg.oidc_configured(),
        "middleware_name": sso::MIDDLEWARE_NAME,
    })
}

async fn load_instance_urls(pool: &sqlx::PgPool) -> (String, String) {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT COALESCE(wildcard_domain,''), COALESCE(instance_url,'') FROM instance_settings WHERE id = 1",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    row.unwrap_or_default()
}

async fn get_sso(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let cfg = sso::load_sso_settings(&state.pool).await;
    Ok(Json(json!({ "ok": true, "config": view(&cfg) })))
}

#[derive(Deserialize)]
pub struct PutSsoBody {
    /// `generic` | `pocket_id`
    pub provider: Option<String>,
    /// Alias préféré de l'issuer OIDC (sinon `pocket_id_url`).
    pub issuer_url: Option<String>,
    pub protect_apps_by_default: Option<bool>,
    pub forward_auth_address: Option<String>,
    pub hide_local_login: Option<bool>,
    pub enable_platform_login: Option<bool>,
    pub pocket_id_url: Option<String>,
    pub oauth2_proxy_url: Option<String>,
    pub apps_client_id: Option<String>,
    /// Omit or empty to keep existing secret.
    pub apps_client_secret: Option<String>,
    /// Omit or empty to keep existing API token.
    pub pocket_id_api_token: Option<String>,
    /// Uniquement pour `provider=pocket_id` : crée/maj le client via l'API Pocket ID.
    pub provision: Option<bool>,
    /// Force la génération d'un nouveau client secret côté Pocket ID.
    pub rotate_secret: Option<bool>,
    /// Override logo client OIDC (sinon `{instance_url}/favicon.svg`).
    pub logo_url: Option<String>,
    /// Fond login Pocket ID (URL publique téléchargeable).
    pub background_url: Option<String>,
}

async fn put_sso(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PutSsoBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let current = sso::load_sso_settings(&state.pool).await;

    let provider = body
        .provider
        .as_deref()
        .map(sso::normalize_provider)
        .unwrap_or_else(|| current.provider().to_string());

    let protect = body
        .protect_apps_by_default
        .map(|v| if v { 1i64 } else { 0 })
        .unwrap_or(current.sso_protect_apps_by_default);
    let hide = body
        .hide_local_login
        .map(|v| if v { 1i64 } else { 0 })
        .unwrap_or(current.sso_hide_local_login);
    let enable_platform = if provider == crate::sso::PROVIDER_POCKET_ID {
        1
    } else {
        body.enable_platform_login
            .map(|v| if v { 1i64 } else { 0 })
            .unwrap_or(current.sso_enable_platform_login)
    };
    let forward = body
        .forward_auth_address
        .map(|s| s.trim().to_string())
        .unwrap_or(current.sso_forward_auth_address);
    let issuer = body
        .issuer_url
        .or(body.pocket_id_url)
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .unwrap_or(current.sso_pocket_id_url);
    let proxy_url = body
        .oauth2_proxy_url
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .unwrap_or(current.sso_oauth2_proxy_url);
    let mut client_id = body
        .apps_client_id
        .map(|s| s.trim().to_string())
        .unwrap_or(current.sso_apps_client_id.clone());
    let mut client_secret = match body.apps_client_secret {
        Some(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => current.sso_apps_client_secret.clone(),
    };
    let api_token = match body.pocket_id_api_token {
        Some(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => current.sso_pocket_id_api_token.clone(),
    };

    let is_pocket = provider == PROVIDER_POCKET_ID;
    let token_available = !api_token.trim().is_empty();
    let should_provision = is_pocket
        && body
            .provision
            .unwrap_or(token_available && !issuer.trim().is_empty());
    let rotate_secret = body.rotate_secret.unwrap_or(false);

    let mut provision_meta = json!(null);
    if should_provision {
        if issuer.trim().is_empty() {
            return Err((
                axum::http::StatusCode::BAD_REQUEST,
                Json(json!({"error": "URL issuer Pocket ID requise pour le provisionnement"})),
            ));
        }
        if !token_available {
            return Err((
                axum::http::StatusCode::BAD_REQUEST,
                Json(json!({"error": "Token API Pocket ID requis pour le provisionnement"})),
            ));
        }

        let (wildcard, instance_url) = load_instance_urls(&state.pool).await;
        let callbacks = pocket_id::default_callback_urls(&wildcard, &instance_url);
        let launch = {
            let u = instance_url.trim();
            if u.is_empty() {
                None
            } else {
                Some(u.trim_end_matches('/').to_string())
            }
        };
        let logo_override = body
            .logo_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let logo = logo_override.or_else(|| pocket_id::default_logo_url(&instance_url));
        let background = body
            .background_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let branding = pocket_id::BrandingUrls {
            logo_url: logo.clone(),
            dark_logo_url: logo.clone(),
            background_url: background.clone(),
            email_logo_url: logo.clone(),
            default_profile_picture_url: logo,
        };
        let target_id = if client_id.trim().is_empty() {
            pocket_id::DEFAULT_CLIENT_ID.to_string()
        } else {
            client_id.trim().to_string()
        };
        let need_secret = rotate_secret || client_secret.trim().is_empty();

        match pocket_id::provision_oidc_client(
            &issuer,
            &api_token,
            &target_id,
            "DevForge",
            "Client OIDC provisionné par DevForge",
            &callbacks,
            launch.as_deref(),
            need_secret,
            &branding,
            true,
        )
        .await
        {
            Ok(r) => {
                client_id = r.client_id;
                if let Some(secret) = r.client_secret {
                    client_secret = secret;
                }
                provision_meta = json!({
                    "ok": true,
                    "created_client": r.created_client,
                    "created_secret": r.created_secret,
                    "logo_set": r.logo_set,
                    "logo_light_uploaded": r.logo_light_uploaded,
                    "logo_dark_uploaded": r.logo_dark_uploaded,
                    "favicon_uploaded": r.favicon_uploaded,
                    "background_uploaded": r.background_uploaded,
                    "email_logo_uploaded": r.email_logo_uploaded,
                    "profile_picture_uploaded": r.profile_picture_uploaded,
                    "branding_warnings": r.branding_warnings,
                    "callback_urls": callbacks,
                });
            }
            Err(e) => {
                return Err((
                    axum::http::StatusCode::BAD_GATEWAY,
                    Json(json!({
                        "error": e.message,
                        "pocket_id_status": e.status,
                    })),
                ));
            }
        }
    }

    let now = Utc::now().to_rfc3339();
    sqlx::query(
        r#"UPDATE instance_settings SET
            sso_protect_apps_by_default = $1,
            sso_forward_auth_address = $2,
            sso_hide_local_login = $3,
            sso_enable_platform_login = $4,
            sso_pocket_id_url = $5,
            sso_oauth2_proxy_url = $6,
            sso_apps_client_id = $7,
            sso_apps_client_secret = $8,
            sso_pocket_id_api_token = $9,
            sso_oidc_provider = $10,
            updated_at = $11
         WHERE id = 1"#,
    )
    .bind(protect)
    .bind(&forward)
    .bind(hide)
    .bind(enable_platform)
    .bind(&issuer)
    .bind(&proxy_url)
    .bind(&client_id)
    .bind(&client_secret)
    .bind(&api_token)
    .bind(&provider)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    let cfg = sso::load_sso_settings(&state.pool).await;
    Ok(Json(json!({
        "ok": true,
        "config": view(&cfg),
        "provision": provision_meta,
    })))
}
