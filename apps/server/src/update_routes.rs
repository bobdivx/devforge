//! Self-update DevForge (check / start / status).

use axum::{
    extract::State,
    http::HeaderMap,
    response::Json,
    routing::{get, post},
    Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/update/check", get(update_check))
        .route("/api/v1/update/status", get(update_status))
        .route("/api/v1/update/start", post(update_start))
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

async fn update_check(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let check = state.updater.check().await.map_err(|e| {
        (
            axum::http::StatusCode::BAD_GATEWAY,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    Ok(Json(json!({
        "data": check,
        "job": state.updater.current_job().await,
    })))
}

async fn update_status(State(state): State<AppState>) -> Json<Value> {
    // Public: la page d'attente poll pendant le redémarrage (auth peut être HS).
    Json(json!({
        "data": state.updater.current_job().await,
        "version": state.updater.current_version(),
        "mode": state.updater.config().mode.as_str(),
    }))
}

#[derive(Deserialize)]
pub struct StartBody {
    pub target_version: Option<String>,
}

async fn update_start(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<StartBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let job = state
        .updater
        .start(body.target_version)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::BAD_REQUEST,
                Json(json!({"error": e.to_string()})),
            )
        })?;
    Ok(Json(json!({
        "data": job,
        "ok": true,
    })))
}
