use crate::auth_routes::current_workspace;
use crate::routes::ApiError;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use devforge_runner::{CreateRunnerRequest, RunnerEvent};
use futures_util::stream::{self, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use std::convert::Infallible;
use std::time::Duration;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/runners", get(list_runners).post(create_runner))
        .route("/api/v1/runners/events", get(runner_events))
        .route("/api/v1/runners/sync", post(sync_runners))
        .route(
            "/api/v1/runners/{id}",
            get(get_runner).delete(delete_runner),
        )
        .route("/api/v1/runners/{id}/logs", get(runner_logs))
        .route("/api/v1/runners/{id}/jobs", get(runner_jobs))
        .route("/api/v1/runners/{id}/{action}", post(runner_action))
}

async fn require_ws(state: &AppState, headers: &HeaderMap) -> Result<(), ApiError> {
    let _ = current_workspace(state, headers)
        .await
        .map_err(|(status, Json(v))| ApiError {
            status,
            message: v
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("auth")
                .to_string(),
        })?;
    Ok(())
}

fn map_df(e: devforge_shared::DevForgeError) -> ApiError {
    match e {
        devforge_shared::DevForgeError::NotFound(m) => ApiError::not_found(&m),
        other => ApiError::message(other.to_string()),
    }
}

async fn list_runners(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    require_ws(&state, &headers).await?;
    let v = state.runners.list().await.map_err(map_df)?;
    Ok(Json(v))
}

async fn get_runner(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_ws(&state, &headers).await?;
    let v = state.runners.get(&id).await.map_err(map_df)?;
    Ok(Json(v))
}

async fn create_runner(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateRunnerRequest>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    require_ws(&state, &headers).await?;
    let v = state.runners.create_async(body).await.map_err(map_df)?;
    Ok((axum::http::StatusCode::ACCEPTED, Json(v)))
}

async fn delete_runner(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_ws(&state, &headers).await?;
    let v = state.runners.destroy(&id).await.map_err(map_df)?;
    Ok(Json(v))
}

async fn runner_action(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((id, action)): Path<(String, String)>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    require_ws(&state, &headers).await?;
    let v = state.runners.action(&id, &action).await.map_err(map_df)?;
    let status = if v.get("accepted").and_then(|a| a.as_bool()).unwrap_or(false) {
        axum::http::StatusCode::ACCEPTED
    } else {
        axum::http::StatusCode::OK
    };
    Ok((status, Json(v)))
}

#[derive(Deserialize)]
struct LogsQuery {
    lines: Option<usize>,
}

async fn runner_logs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(q): Query<LogsQuery>,
) -> Result<Json<Value>, ApiError> {
    require_ws(&state, &headers).await?;
    let lines = q.lines.unwrap_or(200);
    let v = state.runners.logs(&id, lines).await.map_err(map_df)?;
    Ok(Json(v))
}

async fn runner_jobs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    require_ws(&state, &headers).await?;
    let v = state.runners.jobs(&id).await.map_err(map_df)?;
    Ok(Json(v))
}

async fn sync_runners(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    require_ws(&state, &headers).await?;
    let v = state.runners.sync_now().await.map_err(map_df)?;
    Ok(Json(v))
}

fn event_from_runner(ev: RunnerEvent) -> Event {
    let (name, data) = match &ev {
        RunnerEvent::Updated { .. } => ("runner.updated", json!(ev)),
        RunnerEvent::Removed { .. } => ("runner.removed", json!(ev)),
        RunnerEvent::SyncDone { .. } => ("runner.sync", json!(ev)),
        RunnerEvent::Error { .. } => ("runner.error", json!(ev)),
    };
    Event::default().event(name).data(data.to_string())
}

async fn runner_events(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<EventsQuery>,
) -> Result<impl IntoResponse, ApiError> {
    // EventSource cannot set Authorization — accept access_token query.
    let mut headers = headers;
    if bearer_missing(&headers) {
        if let Some(tok) = q.access_token.as_deref().filter(|t| !t.is_empty()) {
            if let Ok(val) = axum::http::HeaderValue::from_str(&format!("Bearer {tok}")) {
                headers.insert(axum::http::header::AUTHORIZATION, val);
            }
        }
    }
    require_ws(&state, &headers).await?;
    let rx = state.runners.bus().subscribe();

    let ready = stream::once(async {
        Ok::<Event, Infallible>(Event::default().event("ready").data("{}"))
    });

    let events = stream::unfold(rx, |mut rx| async move {
        match rx.recv().await {
            Ok(ev) => Some((Ok::<Event, Infallible>(event_from_runner(ev)), rx)),
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => Some((
                Ok(Event::default().event("runner.lagged").data("{}")),
                rx,
            )),
            Err(tokio::sync::broadcast::error::RecvError::Closed) => None,
        }
    });

    Ok(Sse::new(ready.chain(events)).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))))
}

#[derive(Deserialize)]
struct EventsQuery {
    access_token: Option<String>,
}

fn bearer_missing(headers: &HeaderMap) -> bool {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| !s.starts_with("Bearer ") || s.len() < 10)
        .unwrap_or(true)
}
