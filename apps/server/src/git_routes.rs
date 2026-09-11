//! Sync GitHub ↔ deploy + état du workdir local (agents / edits) + diff in-app.

use axum::{
    extract::{Path, Query, State},
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
        .route("/api/v1/projects/{uuid}/git/diff", get(git_diff))
        .route("/api/v1/projects/{uuid}/git/discard", post(discard_local))
        .route(
            "/api/v1/projects/{uuid}/git/revert-undeployed",
            post(revert_undeployed),
        )
}

fn map_err(e: impl ToString) -> ApiError {
    ApiError::message(e.to_string())
}

fn short_sha(s: &str) -> String {
    s.chars().take(12).collect()
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

fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Découpe un `git diff` unifié en fichiers + patch.
fn parse_unified_diff(raw: &str) -> Vec<Value> {
    let mut files = Vec::new();
    let mut current_path: Option<String> = None;
    let mut current_status = "modified".to_string();
    let mut patch_lines: Vec<String> = Vec::new();
    let mut additions = 0u64;
    let mut deletions = 0u64;

    let flush = |files: &mut Vec<Value>,
                 path: &mut Option<String>,
                 status: &mut String,
                 patch: &mut Vec<String>,
                 add: &mut u64,
                 del: &mut u64| {
        if let Some(p) = path.take() {
            files.push(json!({
                "filename": p,
                "status": status.clone(),
                "additions": *add,
                "deletions": *del,
                "patch": if patch.is_empty() { Value::Null } else { json!(patch.join("\n")) },
                "previous_filename": null,
            }));
        }
        patch.clear();
        *add = 0;
        *del = 0;
        *status = "modified".to_string();
    };

    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            flush(
                &mut files,
                &mut current_path,
                &mut current_status,
                &mut patch_lines,
                &mut additions,
                &mut deletions,
            );
            // "a/path b/path"
            let parts: Vec<&str> = rest.split_whitespace().collect();
            let b = parts
                .iter()
                .find(|p| p.starts_with("b/"))
                .map(|p| p.trim_start_matches("b/").to_string())
                .or_else(|| {
                    parts
                        .last()
                        .map(|p| p.trim_start_matches("b/").to_string())
                });
            current_path = b;
            continue;
        }
        if current_path.is_none() {
            continue;
        }
        if line.starts_with("new file mode") {
            current_status = "added".to_string();
        } else if line.starts_with("deleted file mode") {
            current_status = "removed".to_string();
        } else if line.starts_with("rename from") || line.starts_with("rename to") {
            current_status = "renamed".to_string();
        }
        // Skip index / --- / +++ headers from patch body count but keep in patch for context
        if line.starts_with('+') && !line.starts_with("+++") {
            additions += 1;
        } else if line.starts_with('-') && !line.starts_with("---") {
            deletions += 1;
        }
        if line.starts_with("diff --git") {
            continue;
        }
        // Keep useful patch lines (hunk + content), drop binary markers noise lightly
        if line.starts_with("index ") || line.starts_with("similarity index") {
            continue;
        }
        patch_lines.push(line.to_string());
    }
    flush(
        &mut files,
        &mut current_path,
        &mut current_status,
        &mut patch_lines,
        &mut additions,
        &mut deletions,
    );
    files
}

async fn workdir_status(state: &AppState, project: &Project) -> Value {
    let configured = project.workdir.as_deref().unwrap_or("").trim();
    let server_id = project
        .server_id
        .as_deref()
        .unwrap_or("default")
        .trim();
    if configured.is_empty() {
        return json!({
            "available": false,
            "reason": "Aucun workdir configuré sur le projet.",
            "dirty": false,
            "files": [],
        });
    }
    let workdir = devforge_deploy::resolve_project_workdir(configured, &project.uuid);
    let path = std::path::Path::new(&workdir);
    if !path.is_dir() {
        let remote_hint = configured.starts_with('/')
            || configured.starts_with("/data")
            || configured != workdir;
        return json!({
            "available": false,
            "dirty": false,
            "files": [],
            "configured": configured,
            "path": workdir,
            "reason": if remote_hint {
                "Clone local absent — le dépôt vit sur le serveur de déploiement (NAS). Les edits agents apparaîtront ici après un clone local ou depuis la prod."
            } else {
                "Répertoire introuvable."
            },
        });
    }
    let git_cmd = if cfg!(windows) {
        "git status --porcelain=v1; Write-Output '---'; git rev-parse --short HEAD 2>$null"
    } else {
        "git status --porcelain=v1 && echo '---' && git rev-parse --short HEAD 2>/dev/null || true"
    };
    match state.deploy.exec(server_id, &workdir, git_cmd, 30).await {
        Ok(res) if res.ok || res.output.contains("---") => {
            let out = res.output;
            let (status_part, head_part) = out
                .split_once("---")
                .map(|(a, b)| (a.trim(), b.trim()))
                .unwrap_or((out.trim(), ""));
            // Si pas de .git, git status échoue
            if status_part.to_lowercase().contains("not a git repository")
                || head_part.to_lowercase().contains("not a git repository")
            {
                return json!({
                    "available": false,
                    "dirty": false,
                    "files": [],
                    "configured": configured,
                    "path": workdir,
                    "reason": "Dossier présent mais ce n’est pas un dépôt git.",
                });
            }
            let files: Vec<Value> = status_part
                .lines()
                .filter(|l| !l.trim().is_empty())
                .filter(|l| !l.starts_with("fatal:"))
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
                "configured": configured,
                "path": workdir,
                "head": if head_part.is_empty() || head_part.contains("fatal") {
                    Value::Null
                } else {
                    json!(head_part.lines().next().unwrap_or("").trim())
                },
                "note": if files.is_empty() {
                    Value::Null
                } else {
                    json!("Non poussés — un déploiement écrasera ces changements.")
                },
            })
        }
        Ok(res) => json!({
            "available": false,
            "reason": friendly_exec_reason(&res.output),
            "dirty": false,
            "files": [],
            "configured": configured,
            "path": workdir,
        }),
        Err(e) => json!({
            "available": false,
            "reason": friendly_exec_reason(&e.to_string()),
            "dirty": false,
            "files": [],
            "configured": configured,
            "path": workdir,
        }),
    }
}

fn friendly_exec_reason(raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("introuvable") || lower.contains("os error 267") || lower.contains("directory")
    {
        return "Clone local absent — workdir distant (NAS) non accessible ici.".into();
    }
    raw.chars().take(280).collect()
}

fn project_resolved_workdir(project: &Project) -> Result<String, ApiError> {
    let configured = project.workdir.as_deref().unwrap_or("").trim();
    if configured.is_empty() {
        return Err(ApiError::message("pas de workdir"));
    }
    let workdir = devforge_deploy::resolve_project_workdir(configured, &project.uuid);
    if !std::path::Path::new(&workdir).is_dir() {
        return Err(ApiError::message(
            "Clone local absent — workdir distant non accessible ici",
        ));
    }
    Ok(workdir)
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
        "files_count": 0,
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
                    "deployed_sha": short_sha(&c.base_sha),
                    "deployed_sha_full": c.base_sha,
                    "head_sha": short_sha(&c.head_sha),
                    "head_sha_full": c.head_sha,
                    "commits": c.commits,
                    "html_url": c.html_url,
                    "files_count": c.files.len(),
                });
            }
            Err(e) => {
                sync = json!({
                    "state": "error",
                    "behind_by": 0,
                    "deployed_sha": short_sha(dep_sha),
                    "deployed_sha_full": dep_sha,
                    "head_sha": null,
                    "commits": [],
                    "error": e.to_string(),
                    "files_count": 0,
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
struct DiffQuery {
    /// `sync` = tip GitHub vs deploy ; `workdir` = modifications locales agents.
    #[serde(default = "default_diff_source")]
    source: String,
    /// Fichier unique (optionnel) — filtre le diff workdir.
    path: Option<String>,
}

fn default_diff_source() -> String {
    "sync".into()
}

async fn git_diff(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(uuid): Path<String>,
    Query(q): Query<DiffQuery>,
) -> Result<Json<Value>, ApiError> {
    let project = auth_project(&state, &headers, &uuid).await?;
    let source = q.source.trim().to_lowercase();

    if source == "workdir" {
        let workdir = project_resolved_workdir(&project)?;
        let server_id = project
            .server_id
            .as_deref()
            .unwrap_or("default")
            .trim();
        let cmd = match q.path.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
            Some(path) => {
                if cfg!(windows) {
                    format!(
                        "git diff HEAD --no-color -- {}; git diff HEAD --no-color --cached -- {}",
                        path.replace('\'', "''"),
                        path.replace('\'', "''")
                    )
                } else {
                    format!(
                        "git diff HEAD --no-color -- {} ; git diff HEAD --no-color --cached -- {}",
                        shell_quote(path),
                        shell_quote(path)
                    )
                }
            }
            None => {
                if cfg!(windows) {
                    "git diff HEAD --no-color; Write-Output '===STAGED==='; git diff HEAD --no-color --cached"
                        .to_string()
                } else {
                    "git diff HEAD --no-color ; echo '===STAGED==='; git diff HEAD --no-color --cached"
                        .to_string()
                }
            }
        };
        let res = state
            .deploy
            .exec(server_id, &workdir, &cmd, 60)
            .await
            .map_err(map_err)?;
        if !res.ok && res.output.trim().is_empty() {
            return Err(ApiError::message(
                res.output.chars().take(500).collect::<String>(),
            ));
        }
        let raw = res.output.replace("===STAGED===", "");
        let files = parse_unified_diff(&raw);
        return Ok(Json(json!({
            "ok": true,
            "source": "workdir",
            "base": "HEAD",
            "head": "workdir",
            "title": "Modifications locales",
            "files": files,
        })));
    }

    // sync: deploy … tip branche
    let Some(repo_url) = project.git_repository.as_deref().filter(|s| !s.is_empty()) else {
        return Err(ApiError::message("pas de dépôt GitHub"));
    };
    let Some((owner, repo)) = crate::infra_routes::parse_github_owner_repo(repo_url) else {
        return Err(ApiError::message("URL dépôt invalide"));
    };
    let branch = project
        .git_branch
        .as_deref()
        .filter(|b| !b.is_empty())
        .unwrap_or("main");
    let Some(dep_sha) = any_deploy_sha(&state, &project).await else {
        return Err(ApiError::message("aucun déploiement de référence"));
    };
    let c = state
        .github
        .compare(&owner, &repo, &dep_sha, branch)
        .await
        .map_err(map_err)?;
    let mut files: Vec<Value> = c
        .files
        .into_iter()
        .map(|f| {
            json!({
                "filename": f.filename,
                "status": f.status,
                "additions": f.additions,
                "deletions": f.deletions,
                "patch": f.patch,
                "previous_filename": f.previous_filename,
            })
        })
        .collect();
    if let Some(path) = q.path.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        files.retain(|f| f.get("filename").and_then(|n| n.as_str()) == Some(path));
    }
    Ok(Json(json!({
        "ok": true,
        "source": "sync",
        "base": short_sha(&c.base_sha),
        "base_full": c.base_sha,
        "head": short_sha(&c.head_sha),
        "head_full": c.head_sha,
        "title": format!("Deploy {} → tip {}", short_sha(&c.base_sha), short_sha(&c.head_sha)),
        "commits": c.commits,
        "files": files,
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
    let workdir = project_resolved_workdir(&project)?;
    let server_id = project
        .server_id
        .as_deref()
        .unwrap_or("default")
        .trim();
    let discard_cmd = if cfg!(windows) {
        "git reset --hard HEAD; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; git clean -fd; exit $LASTEXITCODE"
    } else {
        "git reset --hard HEAD && git clean -fd"
    };
    let res = state
        .deploy
        .exec(server_id, &workdir, discard_cmd, 60)
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

#[derive(Deserialize)]
struct RevertBody {
    confirm: Option<bool>,
}

/// Remet la branche GitHub au SHA déployé (force) — annule les commits non déployés
/// (ex. patch Actions « runners DevForge »).
async fn revert_undeployed(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(uuid): Path<String>,
    body: Option<Json<RevertBody>>,
) -> Result<Json<Value>, ApiError> {
    let project = auth_project(&state, &headers, &uuid).await?;
    if !body.and_then(|j| j.0.confirm).unwrap_or(false) {
        return Err(ApiError::message(
            "confirm: true requis pour annuler les commits non déployés",
        ));
    }
    let Some(repo_url) = project.git_repository.as_deref().filter(|s| !s.is_empty()) else {
        return Err(ApiError::message("pas de dépôt GitHub"));
    };
    let Some((owner, repo)) = crate::infra_routes::parse_github_owner_repo(repo_url) else {
        return Err(ApiError::message("URL dépôt invalide"));
    };
    let branch = project
        .git_branch
        .as_deref()
        .filter(|b| !b.is_empty())
        .unwrap_or("main");
    let Some(dep_sha) = any_deploy_sha(&state, &project).await else {
        return Err(ApiError::message("aucun déploiement de référence"));
    };

    let cmp = state
        .github
        .compare(&owner, &repo, &dep_sha, branch)
        .await
        .map_err(map_err)?;
    if cmp.ahead_by == 0 {
        return Ok(Json(json!({
            "ok": true,
            "message": "Rien à annuler — la branche est déjà au tip déployé",
            "sha": short_sha(&cmp.base_sha),
        })));
    }

    let target = cmp.base_sha.clone();
    let cancelled = cmp.ahead_by;
    state
        .github
        .update_ref(&owner, &repo, branch, &target, true)
        .await
        .map_err(map_err)?;

    Ok(Json(json!({
        "ok": true,
        "message": format!(
            "{cancelled} commit(s) retiré(s) de {owner}/{repo}@{branch} — branche à {}",
            short_sha(&target)
        ),
        "owner": owner,
        "repo": repo,
        "branch": branch,
        "sha": short_sha(&target),
        "sha_full": target,
        "cancelled_count": cancelled,
    })))
}
