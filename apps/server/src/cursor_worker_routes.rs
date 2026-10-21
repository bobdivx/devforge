//! API admin : worker Cursor Self-Hosted (My Machines).

use axum::{
    extract::State,
    http::HeaderMap,
    response::Json,
    routing::{get, patch, post},
    Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::cursor_worker::{self, WorkerSettings};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/cursor-worker/status", get(status))
        .route("/api/v1/cursor-worker/start", post(start))
        .route("/api/v1/cursor-worker/stop", post(stop))
        .route("/api/v1/cursor-worker/restart", post(restart))
        .route(
            "/api/v1/cursor-worker/settings",
            get(get_settings).patch(patch_settings),
        )
}

async fn require_admin(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(), (axum::http::StatusCode, Json<Value>)> {
    let (user, _) = crate::auth_routes::current_workspace(state, headers).await?;
    if user.role != "instance_admin" {
        return Err((
            axum::http::StatusCode::FORBIDDEN,
            Json(json!({"error": "Réservé à l'administrateur d'instance"})),
        ));
    }
    Ok(())
}

fn map_err(e: String) -> (axum::http::StatusCode, Json<Value>) {
    (
        axum::http::StatusCode::BAD_REQUEST,
        Json(json!({"ok": false, "error": e})),
    )
}

async fn status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let v = cursor_worker::status_json(&state.pool)
        .await
        .map_err(map_err)?;
    Ok(Json(v))
}

async fn start(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let settings = cursor_worker::load_settings(&state.pool).await;
    let dirs = cursor_worker::list_project_workdirs(&state.pool)
        .await
        .map_err(map_err)?;
    let paths = cursor_worker::eligible_paths(&dirs, &settings.extra_dirs);
    let v = cursor_worker::start(&settings, &paths).map_err(map_err)?;
    Ok(Json(v))
}

async fn stop(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let v = cursor_worker::stop().map_err(map_err)?;
    Ok(Json(v))
}

async fn restart(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let settings = cursor_worker::load_settings(&state.pool).await;
    let dirs = cursor_worker::list_project_workdirs(&state.pool)
        .await
        .map_err(map_err)?;
    let paths = cursor_worker::eligible_paths(&dirs, &settings.extra_dirs);
    let v = cursor_worker::restart(&settings, &paths).map_err(map_err)?;
    Ok(Json(v))
}

async fn get_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let s = cursor_worker::load_settings(&state.pool).await;
    let plain = cursor_worker::api_key_plain(&s);
    Ok(Json(json!({
        "ok": true,
        "enabled": s.enabled,
        "name": s.name,
        "binary": s.binary,
        "extra_dirs": s.extra_dirs,
        "resolved_name": cursor_worker::resolve_worker_name(&s),
        "api_key_set": !plain.is_empty(),
        "api_key_masked": if plain.is_empty() {
            Value::Null
        } else {
            json!(cursor_worker::mask_key(&plain))
        },
    })))
}

#[derive(Deserialize)]
struct PatchBody {
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    binary: Option<String>,
    #[serde(default)]
    extra_dirs: Option<String>,
    /// Nouvelle clé API (clair). Chaîne vide = effacer. Absent = ne pas toucher.
    #[serde(default)]
    api_key: Option<String>,
}

async fn patch_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PatchBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    if body.enabled.is_none()
        && body.name.is_none()
        && body.binary.is_none()
        && body.extra_dirs.is_none()
        && body.api_key.is_none()
    {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"error": "Rien à modifier"})),
        ));
    }

    let now = chrono::Utc::now().to_rfc3339();
    let current = cursor_worker::load_settings(&state.pool).await;

    let enabled = body.enabled.unwrap_or(current.enabled);
    let name = body
        .name
        .map(|s| s.trim().to_string())
        .unwrap_or(current.name);
    let binary = body
        .binary
        .map(|s| s.trim().to_string())
        .unwrap_or(current.binary);
    let extra_dirs = body.extra_dirs.unwrap_or(current.extra_dirs);

    let api_key_sealed = match body.api_key {
        None => current.api_key_sealed,
        Some(k) => {
            let t = k.trim();
            if t.is_empty() {
                String::new()
            } else {
                crate::secret_box::seal_compat(t)
            }
        }
    };

    sqlx::query(
        r#"UPDATE instance_settings SET
            cursor_worker_enabled = $1,
            cursor_worker_name = $2,
            cursor_worker_api_key = $3,
            cursor_worker_binary = $4,
            cursor_worker_extra_dirs = $5,
            updated_at = $6
           WHERE id = 1"#,
    )
    .bind(if enabled { 1i64 } else { 0 })
    .bind(&name)
    .bind(&api_key_sealed)
    .bind(&binary)
    .bind(&extra_dirs)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    let s = WorkerSettings {
        enabled,
        name,
        api_key_sealed,
        binary,
        extra_dirs,
    };
    let plain = cursor_worker::api_key_plain(&s);
    Ok(Json(json!({
        "ok": true,
        "enabled": s.enabled,
        "name": s.name,
        "binary": s.binary,
        "extra_dirs": s.extra_dirs,
        "resolved_name": cursor_worker::resolve_worker_name(&s),
        "api_key_set": !plain.is_empty(),
        "api_key_masked": if plain.is_empty() {
            Value::Null
        } else {
            json!(cursor_worker::mask_key(&plain))
        },
    })))
}
