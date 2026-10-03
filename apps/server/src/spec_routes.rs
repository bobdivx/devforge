use axum::{
    extract::{Path, State},
    http::HeaderMap,
    response::Json,
    routing::{get, post},
    Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;

use crate::routes::ApiError;
use crate::state::{new_uuid, now_str, AppState};
use devforge_agent::sdd::{self, FeatureStatus};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/projects/{uuid}/specs",
            get(list_specs).post(create_spec),
        )
        .route(
            "/api/v1/projects/{uuid}/specs/{slug}/decision",
            post(decide_spec),
        )
        .route(
            "/api/v1/projects/{uuid}/specs/{slug}/converge",
            post(converge_spec),
        )
        .route(
            "/api/v1/projects/{uuid}/specs/{slug}/retry",
            post(retry_spec),
        )
        .route(
            "/api/v1/projects/{uuid}/specs/{slug}/dismiss",
            post(dismiss_spec),
        )
}

fn workdir_of(project_uuid: &str, raw: Option<&str>) -> PathBuf {
    let raw = raw.unwrap_or("").trim();
    let resolved = if raw.is_empty() {
        devforge_deploy::resolve_project_workdir(
            &format!("/data/devforge/applications/{project_uuid}"),
            project_uuid,
        )
    } else {
        devforge_deploy::resolve_project_workdir(raw, project_uuid)
    };
    PathBuf::from(resolved)
}

async fn project_root(state: &AppState, project_uuid: &str) -> Result<PathBuf, ApiError> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT workdir FROM projects WHERE uuid = $1")
            .bind(project_uuid)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| ApiError::message(e.to_string()))?;
    let Some((raw,)) = row else {
        return Err(ApiError::not_found("project"));
    };
    let root = workdir_of(project_uuid, raw.as_deref());
    std::fs::create_dir_all(&root).map_err(|e| ApiError::message(e.to_string()))?;
    if raw.as_deref().unwrap_or("").trim().is_empty() {
        let _ = sqlx::query(
            "UPDATE projects SET workdir = $1, updated_at = $2 WHERE uuid = $3 AND (workdir IS NULL OR workdir = '')",
        )
        .bind(root.to_string_lossy().as_ref())
        .bind(now_str())
        .bind(project_uuid)
        .execute(&state.pool)
        .await;
    }
    Ok(root)
}

async fn list_specs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let _ = crate::routes::auth_project(&state, &headers, &uuid).await?;
    let root = project_root(&state, &uuid).await?;
    let features = sdd::list_features(&root).map_err(ApiError::message)?;
    Ok(Json(json!({"data": features})))
}

#[derive(Deserialize)]
struct CreateSpec {
    title: String,
    description: String,
}

async fn create_spec(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<CreateSpec>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let _ = crate::routes::auth_project(&state, &headers, &uuid).await?;
    let root = project_root(&state, &uuid).await?;
    let status = sdd::specify(&root, &body.title, &body.description).map_err(ApiError::message)?;
    let marker = format!("SDD-SPECIFY:{}:{}", status.slug, now_str());
    let content = format!(
        "La spec « {title} » est écrite dans specs/{slug}/spec.md (constitution dans specs/constitution.md si elle manquait).\n\
         ARRÊT. Pas de code, pas de plan, pas de worker, pas de dépôt distant.\n\
         L'utilisateur doit valider explicitement cette spec avant la suite. « oui » et « go » ne suffisent pas.",
        title = status.title,
        slug = status.slug
    );
    wake_coordinator_later(state, uuid, marker, content);
    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({"data": status})),
    ))
}

#[derive(Deserialize)]
struct Decision {
    decision: String,
    #[serde(default)]
    note: String,
}

async fn decide_spec(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, slug)): Path<(String, String)>,
    Json(body): Json<Decision>,
) -> Result<Json<Value>, ApiError> {
    let _ = crate::routes::auth_project(&state, &headers, &uuid).await?;
    let root = project_root(&state, &uuid).await?;
    match body.decision.trim() {
        "approve" => {
            let mut status = sdd::approve(&root, &slug).map_err(ApiError::message)?;
            if !spec_worker_ready(&state, &uuid).await {
                status = sdd::block_no_tool_provider(&status);
                sdd::write_status(&root, &status).map_err(ApiError::message)?;
                let marker = format!("SDD-FAILED:{slug}:{}", now_str());
                wake_coordinator_later(state, uuid, marker, status.note.clone());
                return Ok(Json(json!({"data": status})));
            }
            let worker = spawn_worker(&state, &uuid, &status).await?;
            status.worker_uuid = worker.clone();
            status.note = sdd::NOTE_IN_PROGRESS.into();
            status.blocker.clear();
            sdd::write_status(&root, &status).map_err(ApiError::message)?;
            let marker = format!("SDD-APPROVED:{slug}:{}", now_str());
            let content = format!(
                "Spec « {title} » validée. plan.md et tasks.md sont écrits.\n\
                 Worker déjà lancé : {worker}. N'en crée pas un second.\n\
                 Reste en local. Pas de dépôt, pas de pull request, pas de déploiement.",
                title = status.title
            );
            wake_coordinator_later(state, uuid, marker, content);
            Ok(Json(json!({"data": status})))
        }
        "reject" => {
            let status = sdd::reject(&root, &slug, &body.note).map_err(ApiError::message)?;
            let marker = format!("SDD-REJECT:{slug}:{}", now_str());
            let content = format!(
                "Spec « {title} » rejetée. Pas de code.\n{}",
                status.note,
                title = status.title
            );
            wake_coordinator_later(state, uuid, marker, content);
            Ok(Json(json!({"data": status})))
        }
        _ => Err(ApiError::message("decision doit être approve ou reject")),
    }
}

async fn retry_spec(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, slug)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let _ = crate::routes::auth_project(&state, &headers, &uuid).await?;
    let root = project_root(&state, &uuid).await?;
    let mut status = sdd::reopen_for_retry(&root, &slug).map_err(ApiError::message)?;
    if !spec_worker_ready(&state, &uuid).await {
        status = sdd::block_no_tool_provider(&status);
        sdd::write_status(&root, &status).map_err(ApiError::message)?;
        return Ok(Json(json!({"data": status})));
    }
    let worker = spawn_worker(&state, &uuid, &status).await?;
    status.worker_uuid = worker;
    status.note = sdd::NOTE_IN_PROGRESS.into();
    sdd::write_status(&root, &status).map_err(ApiError::message)?;
    Ok(Json(json!({"data": status})))
}

async fn dismiss_spec(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, slug)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let _ = crate::routes::auth_project(&state, &headers, &uuid).await?;
    let root = project_root(&state, &uuid).await?;
    let status = sdd::dismiss(&root, &slug).map_err(ApiError::message)?;
    Ok(Json(json!({"data": status})))
}

async fn converge_spec(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, slug)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let _ = crate::routes::auth_project(&state, &headers, &uuid).await?;
    let root = project_root(&state, &uuid).await?;
    let status = advance(&state, &uuid, &root, &slug, None, None).await?;
    Ok(Json(json!({"data": status})))
}

async fn spawn_worker(
    state: &AppState,
    project_uuid: &str,
    status: &FeatureStatus,
) -> Result<String, ApiError> {
    let parent = crate::db::ensure_coordinator_agent(&state.pool, project_uuid)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?
        .ok_or_else(|| ApiError::message("coordinateur introuvable"))?;
    let agent_uuid = new_uuid();
    let now = now_str();
    let name = format!("Worker {}", status.slug);
    let name: String = name.chars().take(80).collect();
    sqlx::query(
        r#"INSERT INTO project_agents (
            uuid, project_uuid, name, role, kind, parent_agent_uuid, status, created_at, updated_at
        ) VALUES ($1, $2, $3, 'worker', 'subagent', $4, 'idle', $5, $6)"#,
    )
    .bind(&agent_uuid)
    .bind(project_uuid)
    .bind(&name)
    .bind(&parent)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(|e| ApiError::message(e.to_string()))?;

    let prompt = sdd::implement_prompt(&status.slug, &status.title, status.attempts);
    crate::agent_runs::record_user_turn(&state.pool, project_uuid, &agent_uuid, &prompt)
        .await
        .map_err(ApiError::message)?;
    let state = state.clone();
    let project_uuid = project_uuid.to_string();
    let agent_uuid_run = agent_uuid.clone();
    tokio::spawn(async move {
        if let Err(e) =
            crate::routes::trigger_agent_turn(&state, &project_uuid, &agent_uuid_run).await
        {
            tracing::warn!(error = %e, agent_uuid = %agent_uuid_run, "démarrage worker spec");
        }
    });
    Ok(agent_uuid)
}

/// Démarre le tour du worker que `sdd_loop` approve vient d'enfiler.
/// Le projet est celui de l'instance (uuid), pas le workspace par défaut du jeton.
pub fn schedule_started_worker(state: AppState, result: &Value) {
    let Some((project_uuid, agent_uuid)) = sdd::queued_worker(result) else {
        return;
    };
    tokio::spawn(async move {
        if let Err(e) = crate::routes::trigger_agent_turn(&state, &project_uuid, &agent_uuid).await
        {
            tracing::warn!(error = %e, agent_uuid, "démarrage worker spec");
        }
    });
}

fn wake_coordinator_later(state: AppState, project_uuid: String, marker: String, content: String) {
    tokio::spawn(async move {
        if let Err(e) =
            crate::routes::wake_coordinator(&state, &project_uuid, &marker, &content).await
        {
            tracing::warn!(error = %e, "réveil coordinateur spec");
        }
    });
}

/// Après le tour d'un worker marqué SDD-IMPLEMENT, compare le résultat à la spec.
pub async fn block_spec_no_provider(state: &AppState, project_uuid: &str, content: &str) {
    let Some(slug) = content
        .split("SDD-IMPLEMENT:")
        .nth(1)
        .and_then(|rest| rest.split([':', ' ', '\n']).next())
        .map(|s| s.to_string())
    else {
        return;
    };
    if !sdd::is_slug(&slug) {
        return;
    }
    let Ok(root) = project_root(state, project_uuid).await else {
        return;
    };
    let Ok(Some(current)) = sdd::read_status(&root, &slug) else {
        return;
    };
    if current.blocker == "no_provider" {
        return;
    }
    if current.phase != sdd::PHASE_IMPLEMENT && current.phase != sdd::PHASE_FAILED {
        return;
    }
    let next = sdd::block_no_tool_provider(&current);
    let _ = sdd::write_status(&root, &next);
}

async fn spec_worker_ready(state: &AppState, project_uuid: &str) -> bool {
    let Some(owner) = project_owner(state, project_uuid).await else {
        return false;
    };
    state.llm_for_spec_worker(&owner).await.is_some()
}

async fn project_owner(state: &AppState, project_uuid: &str) -> Option<String> {
    let ws: Option<(String,)> =
        sqlx::query_as("SELECT workspace_uuid FROM projects WHERE uuid = $1")
            .bind(project_uuid)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
    let (ws,) = ws?;
    crate::user_prefs::workspace_owner(&state.pool, &ws).await
}

pub fn schedule_after_implement(
    state: AppState,
    project_uuid: String,
    agent_uuid: String,
    content: String,
    reply: String,
    tools_json: String,
    provider: String,
) {
    if !content.contains("SDD-IMPLEMENT:") {
        return;
    }
    let Some(slug) = content
        .split("SDD-IMPLEMENT:")
        .nth(1)
        .and_then(|rest| rest.split([':', ' ', '\n']).next())
        .map(|s| s.to_string())
    else {
        return;
    };
    if !sdd::is_slug(&slug) {
        return;
    }
    tokio::spawn(async move {
        match project_root(&state, &project_uuid).await {
            Ok(root) => {
                if let Err(e) = advance(
                    &state,
                    &project_uuid,
                    &root,
                    &slug,
                    Some(&agent_uuid),
                    Some(sdd::TurnReport {
                        reply,
                        write_paths: sdd::write_paths_from_tools(&tools_json),
                        provider,
                    }),
                )
                .await
                {
                    tracing::warn!(error = %e.message, slug, "convergence spec");
                }
            }
            Err(e) => tracing::warn!(error = %e.message, "workdir spec"),
        }
    });
}

async fn advance(
    state: &AppState,
    project_uuid: &str,
    root: &std::path::Path,
    slug: &str,
    worker_hint: Option<&str>,
    turn: Option<sdd::TurnReport>,
) -> Result<FeatureStatus, ApiError> {
    let Some(current) = sdd::read_status(root, slug).map_err(ApiError::message)? else {
        return Err(ApiError::not_found("spec"));
    };
    if current.phase != sdd::PHASE_IMPLEMENT {
        return Ok(current);
    }
    let verdict = sdd::read_verdict(root, slug).map_err(ApiError::message)?;
    if turn.is_none() && matches!(verdict, sdd::Verdict::Missing) {
        let worker = if !current.worker_uuid.is_empty() {
            current.worker_uuid.clone()
        } else {
            worker_hint.unwrap_or("").to_string()
        };
        if !worker.is_empty() {
            let st: Option<(String,)> = sqlx::query_as(
                "SELECT status FROM project_agents WHERE uuid = $1 AND project_uuid = $2",
            )
            .bind(&worker)
            .bind(project_uuid)
            .fetch_optional(&state.pool)
            .await
            .map_err(|e| ApiError::message(e.to_string()))?;
            if st.as_ref().map(|(s,)| s.as_str()) == Some("working") {
                return Ok(current);
            }
        }
    }
    let report = turn.unwrap_or_default();
    let mut next =
        sdd::apply_implement_turn(&current, verdict, &report).map_err(ApiError::message)?;
    if next.worker_uuid.is_empty() {
        if let Some(hint) = worker_hint {
            next.worker_uuid = hint.to_string();
        }
    }
    sdd::write_status(root, &next).map_err(ApiError::message)?;

    if next.phase == sdd::PHASE_IMPLEMENT && next.attempts > current.attempts {
        let prompt = sdd::implement_prompt(&next.slug, &next.title, next.attempts);
        let agent = if !next.worker_uuid.is_empty() {
            next.worker_uuid.clone()
        } else {
            return Err(ApiError::message("worker introuvable pour relancer"));
        };
        crate::agent_runs::record_user_turn(&state.pool, project_uuid, &agent, &prompt)
            .await
            .map_err(ApiError::message)?;
        let state = state.clone();
        let project_uuid = project_uuid.to_string();
        tokio::spawn(async move {
            if let Err(e) = crate::routes::trigger_agent_turn(&state, &project_uuid, &agent).await {
                tracing::warn!(error = %e, "relance worker spec");
            }
        });
        return Ok(next);
    }

    if next.phase == sdd::PHASE_CONVERGED || next.phase == sdd::PHASE_FAILED {
        let marker_kind = if next.phase == sdd::PHASE_CONVERGED {
            "SDD-CONVERGED"
        } else {
            "SDD-FAILED"
        };
        let marker = format!("{marker_kind}:{slug}:{}", now_str());
        let content = format!(
            "{marker_kind}:{slug}\n\nFonctionnalité « {title} » : {note}\nPas de publication tant qu'elle n'est pas demandée explicitement.",
            title = next.title,
            note = next.note
        );
        wake_coordinator_later(state.clone(), project_uuid.to_string(), marker, content);
    }
    Ok(next)
}
