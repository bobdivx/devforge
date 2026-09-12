use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::Json,
    routing::{get, post},
    Router,
};
use devforge_cron::{CreateCronRequest, CronService, UpdateCronRequest};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::routes::ApiError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/projects/{uuid}/crons", get(list_crons).post(create_cron))
        .route(
            "/api/v1/projects/{uuid}/crons/{id}",
            get(get_cron).patch(update_cron).delete(delete_cron),
        )
        .route("/api/v1/projects/{uuid}/crons/{id}/enable", post(enable_cron))
        .route("/api/v1/projects/{uuid}/crons/{id}/disable", post(disable_cron))
        .route("/api/v1/projects/{uuid}/crons/{id}/run", post(run_now))
        .route("/api/v1/projects/{uuid}/crons/{id}/runs", get(list_runs))
}

async fn list_crons(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let _ = crate::routes::auth_project(&state, &headers, &uuid).await?;
    let service = CronService::new(state.pool.clone());
    let crons = service
        .list(&uuid)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;
    Ok(Json(json!({"data": crons})))
}

async fn get_cron(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, id)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let _ = crate::routes::auth_project(&state, &headers, &uuid).await?;
    let service = CronService::new(state.pool.clone());
    let cron = service
        .get(&id)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("cron"))?;

    if cron.project_uuid != uuid {
        return Err(ApiError::forbidden("cron appartient à un autre projet"));
    }

    Ok(Json(json!({"data": cron})))
}

async fn create_cron(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<CreateCronRequest>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let _ = crate::routes::auth_project(&state, &headers, &uuid).await?;
    let service = CronService::new(state.pool.clone());
    let cron = service
        .create(&uuid, body)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;
    Ok((axum::http::StatusCode::CREATED, Json(json!({"data": cron}))))
}

async fn update_cron(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, id)): Path<(String, String)>,
    Json(body): Json<UpdateCronRequest>,
) -> Result<Json<Value>, ApiError> {
    let _ = crate::routes::auth_project(&state, &headers, &uuid).await?;
    let service = CronService::new(state.pool.clone());

    let existing = service
        .get(&id)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("cron"))?;

    if existing.project_uuid != uuid {
        return Err(ApiError::forbidden("cron appartient à un autre projet"));
    }

    let cron = service
        .update(&id, body)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;
    Ok(Json(json!({"data": cron})))
}

async fn delete_cron(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, id)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let _ = crate::routes::auth_project(&state, &headers, &uuid).await?;
    let service = CronService::new(state.pool.clone());

    let existing = service
        .get(&id)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("cron"))?;

    if existing.project_uuid != uuid {
        return Err(ApiError::forbidden("cron appartient à un autre projet"));
    }

    let deleted = service
        .delete(&id)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;

    Ok(Json(json!({"ok": deleted})))
}

async fn enable_cron(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, id)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let _ = crate::routes::auth_project(&state, &headers, &uuid).await?;
    let service = CronService::new(state.pool.clone());

    let existing = service
        .get(&id)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("cron"))?;

    if existing.project_uuid != uuid {
        return Err(ApiError::forbidden("cron appartient à un autre projet"));
    }

    let cron = service
        .set_enabled(&id, true)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;
    Ok(Json(json!({"data": cron})))
}

async fn disable_cron(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, id)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let _ = crate::routes::auth_project(&state, &headers, &uuid).await?;
    let service = CronService::new(state.pool.clone());

    let existing = service
        .get(&id)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("cron"))?;

    if existing.project_uuid != uuid {
        return Err(ApiError::forbidden("cron appartient à un autre projet"));
    }

    let cron = service
        .set_enabled(&id, false)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;
    Ok(Json(json!({"data": cron})))
}

async fn run_now(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, id)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let _ = crate::routes::auth_project(&state, &headers, &uuid).await?;
    let service = CronService::new(state.pool.clone());

    let cron = service
        .get(&id)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("cron"))?;

    if cron.project_uuid != uuid {
        return Err(ApiError::forbidden("cron appartient à un autre projet"));
    }

    // Lance l'exécution dans une task async (non bloquante).
    let scheduler = state.cron_scheduler.clone();
    tokio::spawn(async move {
        if let Err(e) = scheduler.run_cron_by_id(&id).await {
            tracing::error!(cron_id = %id, error = %e, "Échec run_now");
        }
    });

    Ok(Json(json!({"ok": true, "message": "Exécution planifiée"})))
}

#[derive(Deserialize)]
struct RunsQuery {
    limit: Option<i64>,
}

async fn list_runs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, id)): Path<(String, String)>,
    Query(q): Query<RunsQuery>,
) -> Result<Json<Value>, ApiError> {
    let _ = crate::routes::auth_project(&state, &headers, &uuid).await?;
    let service = CronService::new(state.pool.clone());

    let cron = service
        .get(&id)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("cron"))?;

    if cron.project_uuid != uuid {
        return Err(ApiError::forbidden("cron appartient à un autre projet"));
    }

    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let runs = service
        .list_runs(&id, limit)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;

    Ok(Json(json!({"data": runs})))
}
