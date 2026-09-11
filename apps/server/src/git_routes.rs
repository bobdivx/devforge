//! Sync GitHub ↔ deploy + état du workdir local (agents / edits).

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::routes::ApiError;
use crate::state::{AppState, Project};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/projects/{uuid}/git", get(git_status))
        .route("/api/v1/projects/{uuid}/git/discard", post(discard_local))
}

fn map_err(e: impl ToString) -> ApiError {
    ApiError::message(e.to_string())
}

async fn auth_project(
    state: &AppState,
    headers: &HeaderMap,
    uuid: &str,
) -> Result<Project, ApiError> {
    let (_user, workspace) = crate::auth_routes::current_workspace(state, headers)
        .await
        .map_err(|(status, Json(v))| ApiError {
            status,
            message: v
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("auth")
                .to_string(),
        })?;
    sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE uuid = ? AND workspace_uuid = ?")
        .bind(uuid)
        .bind(&workspace.uuid)
        .fetch_optional(&state.pool)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("project"))
}

async fn latest_deploy_sha(state: &AppState, project: &Project) -> Option<String> {
    let row: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT git_sha FROM deployments WHERE project_id = ? AND status IN ('ready', 'success', 'running') ORDER BY created_at DESC LIMIT 1",
    )
    .bind(project.id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    row.and_then(|(sha,)| {
        sha.filter(|s| !s.is_empty() && s != "pending" && s != "unknown")
    })
    .or_else(|| {
        // fallback: any latest sha
        None
    })
}

async fn any_deploy_sha(state: &AppState, project: &Project) -> Option<String> {
    if let Some(s) = latest_deploy_sha(state, project).await {
        return Some(s);
    }
    let row: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT git_sha FROM deployments WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(project.id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    row.and_then(|(sha,)| sha.filter(|s| !s.is_empty() && s != "pending" && s != "unknown"))
}

async fn workdir_status(state: &AppState, project: &Project) -> Value {
    let workdir = project.workdir.as_deref().unwrap_or("").trim();
    let server_id = project
        .server_id
        .as_deref()
        .unwrap_or("default")
        .trim();
    if workdir.is_empty() {
        return json!({
            "available": false,
            "reason": "pas de workdir",
            "dirty": false,
            "files": [],
        });
    }
    match state
        .deploy
        .exec(
            server_id,
            workdir,
            "git status --porcelain=v1 && echo '---' && git rev-parse --short HEAD 2>/dev/null || true",
            30,
        )
        .await
    {
        Ok(res) if res.ok => {
            let out = res.output;
            let (status_part, head_part) = out
                .split_once("---")
                .map(|(a, b)| (a.trim(), b.trim()))
                .unwrap_or((out.trim(), ""));
            let files: Vec<Value> = status_part
                .lines()
                .filter(|l| !l.trim().is_empty())
                .map(|line| {
                    let status = line.chars().take(2).collect::<String>();
                    let path = line.chars().skip(3).collect::<String>();
                    json!({ "status": status.trim(), "path": path })
                })
                .collect();
            json!({
                "available": true,
                "dirty": !files.is_empty(),
                "files": files,
                "head": if head_part.is_empty() { Value::Null } else { json!(head_part) },
                "note": if files.is_empty() {
                    Value::Null
                } else {
                    json!("Modifications locales — un déploiement fera reset --hard et les écrasera.")
                },
            })
        }
        Ok(res) => json!({
            "available": false,
            "reason": res.output.chars().take(400).collect::<String>(),
            "dirty": false,
            "files": [],
        }),
        Err(e) => json!({
            "available": false,
            "reason": e.to_string(),
            "dirty": false,
            "files": [],
        }),
    }
}

async fn git_status(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let project = auth_project(&state, &headers, &uuid).await?;
    let Some(repo_url) = project.git_repository.as_deref().filter(|s| !s.is_empty()) else {
        return Ok(Json(json!({
            "ok": true,
            "available": false,
            "reason": "no_github_repo",
            "sync": { "state": "no_git" },
            "workdir": { "available": false, "dirty": false, "files": [] },
        })));
    };
    let Some((owner, repo)) = crate::infra_routes::parse_github_owner_repo(repo_url) else {
        return Ok(Json(json!({
            "ok": true,
            "available": false,
            "reason": "invalid_repo",
            "sync": { "state": "no_git" },
            "workdir": { "available": false, "dirty": false, "files": [] },
        })));
    };
    let branch = project
        .git_branch
        .as_deref()
        .filter(|b| !b.is_empty())
        .unwrap_or("main");

    let deployed = any_deploy_sha(&state, &project).await;
    let workdir = workdir_status(&state, &project).await;

    let mut sync = json!({
        "state": "no_deploy",
        "behind_by": 0,
        "deployed_sha": null,
        "head_sha": null,
        "commits": [],
        "html_url": null,
    });

    if let Some(ref dep_sha) = deployed {
        match state.github.compare(&owner, &repo, dep_sha, branch).await {
            Ok(c) => {
                let state_label = if c.ahead_by == 0 && c.behind_by == 0 {
                    "up_to_date"
                } else if c.ahead_by > 0 {
                    "behind"
                } else {
                    "ahead"
                };
                sync = json!({
                    "state": state_label,
                    "behind_by": c.ahead_by,
                    "ahead_by_remote": c.behind_by,
                    "deployed_sha": c.base_sha,
                    "head_sha": c.head_sha,
                    "commits": c.commits,
                    "html_url": c.html_url,
                });
            }
            Err(e) => {
                sync = json!({
                    "state": "error",
                    "behind_by": 0,
                    "deployed_sha": dep_sha,
                    "head_sha": null,
                    "commits": [],
                    "error": e.to_string(),
                });
            }
        }
    }

    Ok(Json(json!({
        "ok": true,
        "available": true,
        "owner": owner,
        "repo": repo,
        "branch": branch,
        "repo_url": format!("https://github.com/{owner}/{repo}"),
        "sync": sync,
        "workdir": workdir,
    })))
}

#[derive(Deserialize)]
struct DiscardBody {
    /// Confirmation explicite.
    confirm: Option<bool>,
}

/// `git reset --hard` + `git clean -fd` dans le workdir (édits locaux / agents).
async fn discard_local(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(uuid): Path<String>,
    body: Option<Json<DiscardBody>>,
) -> Result<Json<Value>, ApiError> {
    let project = auth_project(&state, &headers, &uuid).await?;
    if !body.and_then(|j| j.0.confirm).unwrap_or(false) {
        return Err(ApiError::message(
            "confirm: true requis pour annuler les changements locaux",
        ));
    }
    let workdir = project.workdir.as_deref().unwrap_or("").trim();
    let server_id = project
        .server_id
        .as_deref()
        .unwrap_or("default")
        .trim();
    if workdir.is_empty() {
        return Err(ApiError::message("pas de workdir"));
    }
    let res = state
        .deploy
        .exec(
            server_id,
            workdir,
            "git reset --hard HEAD && git clean -fd",
            60,
        )
        .await
        .map_err(map_err)?;
    Ok(Json(json!({
        "ok": res.ok,
        "output": res.output.chars().take(2000).collect::<String>(),
        "message": if res.ok {
            "Changements locaux annulés"
        } else {
            "Échec discard"
        },
    })))
}
