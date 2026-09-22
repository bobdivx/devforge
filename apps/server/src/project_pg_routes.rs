//! Routes : une instance PostgreSQL par base de projet.

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{delete, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::project_pg;
use crate::routes::ApiError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/projects/{uuid}/databases", post(create_postgres))
        .route(
            "/api/v1/projects/{uuid}/databases/{id}",
            delete(delete_postgres),
        )
}

#[derive(Deserialize)]
struct CreateBody {
    name: String,
    #[serde(default = "default_migrate")]
    migrate_sqlite: bool,
}

fn default_migrate() -> bool {
    true
}

async fn load_project(
    state: &AppState,
    headers: &HeaderMap,
    uuid: &str,
) -> Result<crate::state::Project, ApiError> {
    crate::routes::auth_project(state, headers, uuid)
        .await
        .map(|(_, _, project)| project)
}

async fn create_postgres(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<CreateBody>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let project = load_project(&state, &headers, &uuid).await?;
    if body.name.trim().is_empty() {
        return Err(ApiError::message("nom requis"));
    }
    match project_pg::provision_project_postgres(
        &state,
        &project,
        body.name.trim(),
        body.migrate_sqlite,
    )
    .await
    {
        Ok(data) => Ok((StatusCode::CREATED, Json(json!({ "data": data })))),
        Err(error) => Err(ApiError {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            message: error,
        }),
    }
}

async fn delete_postgres(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, id)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let project = load_project(&state, &headers, &uuid).await?;
    match project_pg::destroy_project_postgres(&state, &project, &id).await {
        Ok(data) => Ok(Json(data)),
        Err(error) => Err(ApiError {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            message: error,
        }),
    }
}
