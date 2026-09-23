//! Self-update DevForge (check / start / status).

use axum::{
    extract::State,
    http::HeaderMap,
    response::Json,
    routing::{get, patch, post},
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
        .route(
            "/api/v1/update/settings",
            get(update_settings).patch(update_patch_settings),
        )
}

/// Boucle leader : si les interrupteurs sont ON, applique une release dispo.
/// Workers d’abord (le leader doit rester joignable pour les déclencher), puis le leader.
pub fn spawn_auto_update(state: AppState) {
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(180)).await;
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(15 * 60));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        interval.tick().await;
        loop {
            if let Err(e) = auto_update_tick(&state).await {
                tracing::warn!(error = %e, "auto-update");
            }
            interval.tick().await;
        }
    });
}

pub async fn update_auto_flags(state: &AppState) -> (bool, bool) {
    let row: Option<(i64, i64)> = sqlx::query_as(
        "SELECT COALESCE(update_auto_leader, 0), COALESCE(update_auto_worker, 0) FROM instance_settings WHERE id = 1",
    )
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    match row {
        Some((leader, worker)) => (leader != 0, worker != 0),
        None => (false, false),
    }
}

async fn auto_update_tick(state: &AppState) -> Result<(), String> {
    let (leader, worker) = update_auto_flags(state).await;
    if !leader && !worker {
        return Ok(());
    }
    if let Some(job) = state.updater.current_job().await {
        if job.status == "running" || job.status == "restarting" {
            return Ok(());
        }
    }
    let check = state.updater.check().await.map_err(|e| e.to_string())?;
    if !check.update_available {
        return Ok(());
    }
    let Some(target) = check.latest.filter(|s| !s.trim().is_empty()) else {
        return Ok(());
    };
    let target = target.trim().trim_start_matches('v').to_string();
    if worker {
        match crate::cluster_routes::push_worker_updates(state, &target).await {
            Ok(results) => {
                let started = results
                    .iter()
                    .filter(|r| r.get("ok").and_then(|v| v.as_bool()) == Some(true))
                    .filter(|r| r.get("skipped").and_then(|v| v.as_bool()) != Some(true))
                    .count();
                tracing::info!(target = %target, started, "auto-update workers");
            }
            Err(e) => tracing::warn!(error = %e, "auto-update workers"),
        }
    }
    if leader && check.can_apply {
        match state.updater.start(Some(target.clone())).await {
            Ok(job) => tracing::info!(target = %target, job = %job.id, "auto-update leader"),
            Err(e) => {
                let msg = e.to_string();
                if !msg.contains("Déjà à jour") {
                    tracing::warn!(error = %msg, "auto-update leader");
                }
            }
        }
    }
    Ok(())
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

async fn update_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let (leader, worker) = update_auto_flags(&state).await;
    Ok(Json(json!({
        "ok": true,
        "update_auto_leader": leader,
        "update_auto_worker": worker,
    })))
}

#[derive(Deserialize)]
struct PatchUpdateSettings {
    #[serde(default)]
    update_auto_leader: Option<bool>,
    #[serde(default)]
    update_auto_worker: Option<bool>,
}

async fn update_patch_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PatchUpdateSettings>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    if body.update_auto_leader.is_none() && body.update_auto_worker.is_none() {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"error": "Rien à modifier"})),
        ));
    }
    let now = chrono::Utc::now().to_rfc3339();
    if let Some(v) = body.update_auto_leader {
        sqlx::query(
            "UPDATE instance_settings SET update_auto_leader = $1, updated_at = $2 WHERE id = 1",
        )
        .bind(if v { 1i64 } else { 0 })
        .bind(&now)
        .execute(&state.pool)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        })?;
    }
    if let Some(v) = body.update_auto_worker {
        sqlx::query(
            "UPDATE instance_settings SET update_auto_worker = $1, updated_at = $2 WHERE id = 1",
        )
        .bind(if v { 1i64 } else { 0 })
        .bind(&now)
        .execute(&state.pool)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        })?;
    }
    let (leader, worker) = update_auto_flags(&state).await;
    Ok(Json(json!({
        "ok": true,
        "update_auto_leader": leader,
        "update_auto_worker": worker,
    })))
}
