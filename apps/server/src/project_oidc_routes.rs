//! Routes API pour le provisionnement de clients OIDC dédiés par projet.

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::project_oidc;
use crate::sso;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/projects/{uuid}/oidc", get(get_project_oidc_status))
        .route(
            "/api/v1/projects/{uuid}/oidc/provision",
            post(provision_project_oidc),
        )
}

async fn require_workspace_access(
    state: &AppState,
    headers: &HeaderMap,
    project_uuid: &str,
) -> Result<crate::state::Project, (StatusCode, Json<Value>)> {
    let (_user, workspace) = crate::auth_routes::current_workspace(state, headers).await?;

    let project = sqlx::query_as::<_, crate::state::Project>(
        "SELECT * FROM projects WHERE uuid = $1 AND workspace_uuid = $2",
    )
    .bind(project_uuid)
    .bind(&workspace.uuid)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    project.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Projet introuvable"})),
        )
    })
}

async fn get_project_oidc_status(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let project = require_workspace_access(&state, &headers, &uuid).await?;

    let settings = sso::load_sso_settings(&state.pool).await;

    if !settings.is_pocket_id() {
        return Ok(Json(json!({
            "ok": true,
            "provider": settings.provider(),
            "has_dedicated_client": false,
            "message": "Le provisionnement automatique nécessite Pocket ID"
        })));
    }

    let client = project_oidc::load_project_oidc_client(&state.pool, &project.uuid).await;

    let derived_client_id = project_oidc::derive_client_id(&project.slug);
    let callbacks = project_oidc::all_callback_urls(&state.pool, &project).await;

    Ok(Json(json!({
        "ok": true,
        "provider": "pocket_id",
        "has_dedicated_client": client.is_some(),
        "client_id": client.as_ref().map(|c| &c.client_id),
        "derived_client_id": derived_client_id,
        "callbacks": callbacks,
        "ready_to_provision": !callbacks.is_empty() && !settings.sso_pocket_id_api_token.trim().is_empty(),
        "production_url": project.production_url,
    })))
}

#[derive(Deserialize)]
struct ProvisionBody {
    force_new_secret: Option<bool>,
}

async fn provision_project_oidc(
    State(state): State<AppState>,
    Path(uuid): Path<String>,
    headers: HeaderMap,
    Json(body): Json<ProvisionBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let project = require_workspace_access(&state, &headers, &uuid).await?;

    let settings = sso::load_sso_settings(&state.pool).await;

    if !settings.is_pocket_id() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Le provider OIDC doit être pocket_id"})),
        ));
    }

    if project_oidc::all_callback_urls(&state.pool, &project)
        .await
        .is_empty()
    {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "URL de production ou domaine wildcard requis pour provisionner un client OIDC",
                "hint": "Configure l'URL de production du projet, ou le domaine wildcard de l'instance"
            })),
        ));
    }

    let force_new_secret = body.force_new_secret.unwrap_or(false);

    let result =
        project_oidc::provision_project_oidc_client(&state.pool, &project, force_new_secret)
            .await
            .map_err(|e| {
                (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({
                        "error": e.message,
                        "pocket_id_status": e.status,
                    })),
                )
            })?;

    let updated_count = sso::ensure_oidc_env(&state.pool, &project).await;

    Ok(Json(json!({
        "ok": true,
        "client_id": result.client_id,
        "created_client": result.created_client,
        "created_secret": result.created_secret,
        "callbacks": result.callbacks,
        "env_vars_updated": updated_count,
        "message": if result.created_client {
            "Client OIDC créé avec succès"
        } else {
            "Client OIDC mis à jour"
        }
    })))
}
