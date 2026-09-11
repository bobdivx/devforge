//! Settings SSO instance (Pocket ID / OIDC externe + ForwardAuth).

use axum::{
    extract::State,
    http::HeaderMap,
    routing::get,
    Json, Router,
};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::sso::{self, SsoSettings};
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
    json!({
        "protect_apps_by_default": cfg.protect_by_default(),
        "forward_auth_address": cfg.sso_forward_auth_address,
        "hide_local_login": cfg.hide_local_login(),
        "pocket_id_url": cfg.sso_pocket_id_url,
        "oauth2_proxy_url": cfg.sso_oauth2_proxy_url,
        "apps_client_id": cfg.sso_apps_client_id,
        "apps_client_secret_set": !cfg.sso_apps_client_secret.trim().is_empty(),
        "forward_auth_configured": cfg.forward_auth_configured() || cfg.effective_forward_auth_address().is_some(),
        "oidc_configured": cfg.oidc_configured(),
        "middleware_name": sso::MIDDLEWARE_NAME,
    })
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
    pub protect_apps_by_default: Option<bool>,
    pub forward_auth_address: Option<String>,
    pub hide_local_login: Option<bool>,
    pub pocket_id_url: Option<String>,
    pub oauth2_proxy_url: Option<String>,
    pub apps_client_id: Option<String>,
    /// Omit or empty to keep existing secret.
    pub apps_client_secret: Option<String>,
}

async fn put_sso(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PutSsoBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let current = sso::load_sso_settings(&state.pool).await;

    let protect = body
        .protect_apps_by_default
        .map(|v| if v { 1i64 } else { 0 })
        .unwrap_or(current.sso_protect_apps_by_default);
    let hide = body
        .hide_local_login
        .map(|v| if v { 1i64 } else { 0 })
        .unwrap_or(current.sso_hide_local_login);
    let forward = body
        .forward_auth_address
        .map(|s| s.trim().to_string())
        .unwrap_or(current.sso_forward_auth_address);
    let pocket = body
        .pocket_id_url
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .unwrap_or(current.sso_pocket_id_url);
    let proxy_url = body
        .oauth2_proxy_url
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .unwrap_or(current.sso_oauth2_proxy_url);
    let client_id = body
        .apps_client_id
        .map(|s| s.trim().to_string())
        .unwrap_or(current.sso_apps_client_id);
    let client_secret = match body.apps_client_secret {
        Some(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => current.sso_apps_client_secret,
    };

    let now = Utc::now().to_rfc3339();
    sqlx::query(
        r#"UPDATE instance_settings SET
            sso_protect_apps_by_default = ?,
            sso_forward_auth_address = ?,
            sso_hide_local_login = ?,
            sso_pocket_id_url = ?,
            sso_oauth2_proxy_url = ?,
            sso_apps_client_id = ?,
            sso_apps_client_secret = ?,
            updated_at = ?
         WHERE id = 1"#,
    )
    .bind(protect)
    .bind(&forward)
    .bind(hide)
    .bind(&pocket)
    .bind(&proxy_url)
    .bind(&client_id)
    .bind(&client_secret)
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
    Ok(Json(json!({ "ok": true, "config": view(&cfg) })))
}
