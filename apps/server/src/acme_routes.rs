//! Email de contact ACME (Let's Encrypt) du reverse proxy.
//!
//! Ordre : `DEVFORGE_ACME_EMAIL` > réglage d’instance `acme_email` > email du premier
//! admin d’instance. Une adresse invalide (ex. domaine `.local`) n’est jamais passée à
//! Traefik : Let's Encrypt la rejette et Traefik retentait l’inscription à chaque
//! rechargement de configuration.

use axum::{extract::State, http::HeaderMap, routing::get, Json, Router};
use chrono::Utc;
use devforge_deploy::docker::{acme_email, is_valid_acme_email, set_acme_email};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/v1/settings/acme", get(get_acme).put(put_acme))
}

type ApiErr = (axum::http::StatusCode, Json<Value>);

async fn require_admin(state: &AppState, headers: &HeaderMap) -> Result<(), ApiErr> {
    let (user, _) = crate::auth_routes::current_workspace(state, headers).await?;
    if user.role != "instance_admin" {
        return Err((
            axum::http::StatusCode::FORBIDDEN,
            Json(json!({"error": "admin requis"})),
        ));
    }
    Ok(())
}

async fn setting(pool: &sqlx::PgPool) -> String {
    sqlx::query_as::<_, (String,)>(
        "SELECT COALESCE(acme_email, '') FROM instance_settings WHERE id = 1",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .map(|r| r.0)
    .unwrap_or_default()
}

async fn admin_email(pool: &sqlx::PgPool) -> Option<String> {
    sqlx::query_as::<_, (String,)>(
        "SELECT email FROM users WHERE role = 'instance_admin' ORDER BY id LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .map(|r| r.0)
    .filter(|e| is_valid_acme_email(e))
}

/// Recalcule l’email ACME d’instance (à appeler avant toute (re)création du proxy).
pub async fn refresh(pool: &sqlx::PgPool) -> Option<String> {
    let s = setting(pool).await;
    let chosen = if is_valid_acme_email(&s) {
        Some(s)
    } else {
        admin_email(pool).await
    };
    set_acme_email(chosen);
    acme_email()
}

fn source(setting: &str) -> &'static str {
    if std::env::var("DEVFORGE_ACME_EMAIL")
        .map(|v| is_valid_acme_email(&v))
        .unwrap_or(false)
    {
        "env"
    } else if is_valid_acme_email(setting) {
        "setting"
    } else if acme_email().is_some() {
        "admin_user"
    } else {
        "none"
    }
}

async fn get_acme(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiErr> {
    require_admin(&state, &headers).await?;
    let s = setting(&state.pool).await;
    Ok(Json(json!({
        "ok": true,
        "acme_email": s,
        "effective": acme_email(),
        "source": source(&s),
    })))
}

#[derive(Deserialize)]
struct PutAcme {
    #[serde(default)]
    acme_email: String,
}

async fn put_acme(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PutAcme>,
) -> Result<Json<Value>, ApiErr> {
    require_admin(&state, &headers).await?;
    let email = body.acme_email.trim().to_string();
    if !email.is_empty() && !is_valid_acme_email(&email) {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"error": "email ACME invalide (domaine public requis, pas .local)"})),
        ));
    }
    sqlx::query("UPDATE instance_settings SET acme_email = $1, updated_at = $2 WHERE id = 1")
        .bind(&email)
        .bind(Utc::now().to_rfc3339())
        .execute(&state.pool)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        })?;
    let effective = refresh(&state.pool).await;
    // Applique tout de suite (remplacement sûr du proxy si la configuration change).
    let proxy = match state.proxy.ensure_traefik().await {
        Ok(v) => v,
        Err(e) => json!({"ok": false, "error": e.to_string()}),
    };
    Ok(Json(json!({
        "ok": true,
        "acme_email": email,
        "effective": effective,
        "source": source(&email),
        "proxy": proxy,
    })))
}
