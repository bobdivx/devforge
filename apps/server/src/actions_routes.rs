//! Project GitHub Actions: detect workflows, track runs, ensure runner, patch runs-on.

use crate::infra_routes::parse_github_owner_repo;
use crate::routes::ApiError;
use crate::state::{AppState, Project};
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{Json, Router};
use devforge_runner::{CreateRunnerRequest, DEFAULT_LABELS};
use serde::Deserialize;
use serde_json::{json, Value};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/projects/{uuid}/actions", get(actions_summary))
        .route(
            "/api/v1/projects/{uuid}/actions/workflows",
            get(list_workflows),
        )
        .route("/api/v1/projects/{uuid}/actions/runs", get(list_runs))
        .route(
            "/api/v1/projects/{uuid}/actions/ensure-runner",
            post(ensure_runner),
        )
        .route(
            "/api/v1/projects/{uuid}/actions/use-devforge-runners",
            post(patch_workflows),
        )
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

fn project_repo(project: &Project) -> Result<(String, String, String), ApiError> {
    let url = project
        .git_repository
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| ApiError::message("Ce projet n’a pas de dépôt GitHub"))?;
    let (owner, repo) = parse_github_owner_repo(url)
        .ok_or_else(|| ApiError::message("URL GitHub invalide — attendu owner/repo"))?;
    let branch = project
        .git_branch
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "main".into());
    Ok((owner, repo, branch))
}

fn map_gh(e: devforge_shared::DevForgeError) -> ApiError {
    ApiError::message(e.to_string())
}

#[derive(Deserialize)]
struct RunsQuery {
    branch: Option<String>,
}

async fn list_workflow_files(
    state: &AppState,
    owner: &str,
    repo: &str,
    branch: &str,
) -> Result<Vec<WorkflowInfo>, ApiError> {
    let entries = state
        .github
        .list_dir(owner, repo, ".github/workflows", Some(branch))
        .await
        .unwrap_or_default();

    let mut out = Vec::new();
    for (name, is_file) in entries {
        if !is_file {
            continue;
        }
        let lower = name.to_lowercase();
        if !(lower.ends_with(".yml") || lower.ends_with(".yaml")) {
            continue;
        }
        let path = format!(".github/workflows/{name}");
        let file = state
            .github
            .get_file(owner, repo, &path, Some(branch))
            .await
            .map_err(map_gh)?;
        let (uses_devforge, runs_on, skipped) = if let Some(ref f) = file {
            analyze_runs_on(&f.content)
        } else {
            (false, vec![], false)
        };
        out.push(WorkflowInfo {
            name,
            path,
            uses_devforge,
            runs_on,
            skipped_dynamic: skipped,
            sha: file.map(|f| f.sha),
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[derive(serde::Serialize)]
struct WorkflowInfo {
    name: String,
    path: String,
    uses_devforge: bool,
    runs_on: Vec<String>,
    skipped_dynamic: bool,
    sha: Option<String>,
}

/// Returns (uses_devforge_label, collected runs-on values, has_dynamic_runs_on).
fn analyze_runs_on(yaml: &str) -> (bool, Vec<String>, bool) {
    let mut values = Vec::new();
    let mut uses = false;
    let mut dynamic = false;
    for line in yaml.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            continue;
        }
        let Some(rest) = trimmed
            .strip_prefix("runs-on:")
            .or_else(|| trimmed.strip_prefix("runs_on:"))
        else {
            continue;
        };
        let rest = rest.trim();
        if rest.contains("${{") {
            dynamic = true;
            continue;
        }
        values.push(rest.to_string());
        let lower = rest.to_lowercase();
        if lower.contains("devforge") || (lower.contains("self-hosted") && lower.contains("devforge"))
        {
            uses = true;
        }
        if lower.contains("devforge") {
            uses = true;
        }
    }
    (uses, values, dynamic)
}

/// Rewrite static `runs-on:` to `[self-hosted, linux, x64, devforge]`.
pub fn patch_runs_on_yaml(yaml: &str) -> (String, usize) {
    let target = "[self-hosted, linux, x64, devforge]";
    let mut changed = 0usize;
    let mut out = Vec::new();
    for line in yaml.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            out.push(line.to_string());
            continue;
        }
        let Some(idx) = line.find("runs-on:").or_else(|| line.find("runs_on:")) else {
            out.push(line.to_string());
            continue;
        };
        let key_len = if line[idx..].starts_with("runs-on:") {
            "runs-on:".len()
        } else {
            "runs_on:".len()
        };
        let value = line[idx + key_len..].trim();
        if value.contains("${{") {
            out.push(line.to_string());
            continue;
        }
        let lower = value.to_lowercase();
        if lower.contains("devforge") && lower.contains("self-hosted") {
            out.push(line.to_string());
            continue;
        }
        let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
        out.push(format!("{indent}runs-on: {target}"));
        changed += 1;
    }
    // Preserve trailing newline if original had one
    let mut joined = out.join("\n");
    if yaml.ends_with('\n') {
        joined.push('\n');
    }
    (joined, changed)
}

async fn caller_is_admin(state: &AppState, headers: &HeaderMap) -> Result<bool, ApiError> {
    let (user, _) = crate::auth_routes::current_workspace(state, headers)
        .await
        .map_err(ApiError::from_auth)?;
    Ok(user.role == "instance_admin")
}

async fn actions_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let project = auth_project(&state, &headers, &uuid).await?;
    let is_admin = caller_is_admin(&state, &headers).await?;
    let Ok((owner, repo, branch)) = project_repo(&project) else {
        return Ok(Json(json!({
            "ok": true,
            "available": false,
            "reason": "no_github_repo",
            "workflows": [],
            "runs": [],
            "runners": [],
        })));
    };

    let workflows = list_workflow_files(&state, &owner, &repo, &branch).await?;
    let runs = state
        .github
        .list_workflow_runs(&owner, &repo, Some(&branch))
        .await
        .unwrap_or_default();
    let runners = if is_admin {
        let all_runners = state.runners.list().await.map_err(map_gh)?;
        all_runners
            .get("runners")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|r| {
                let pu = r.get("project_uuid").and_then(|x| x.as_str());
                let o = r.get("owner").and_then(|x| x.as_str()).unwrap_or("");
                let rp = r.get("repo").and_then(|x| x.as_str()).unwrap_or("");
                pu == Some(uuid.as_str())
                    || (o.eq_ignore_ascii_case(&owner) && rp.eq_ignore_ascii_case(&repo))
            })
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    let needs_patch = workflows.iter().any(|w| !w.uses_devforge && !w.skipped_dynamic);
    let has_workflows = !workflows.is_empty();

    Ok(Json(json!({
        "ok": true,
        "available": true,
        "owner": owner,
        "repo": repo,
        "branch": branch,
        "has_workflows": has_workflows,
        "needs_patch": needs_patch,
        "workflows": workflows,
        "runs": runs,
        "runners": runners,
    })))
}

async fn list_workflows(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let project = auth_project(&state, &headers, &uuid).await?;
    let (owner, repo, branch) = project_repo(&project)?;
    let workflows = list_workflow_files(&state, &owner, &repo, &branch).await?;
    Ok(Json(json!({
        "ok": true,
        "owner": owner,
        "repo": repo,
        "branch": branch,
        "workflows": workflows,
    })))
}

async fn list_runs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Query(q): Query<RunsQuery>,
) -> Result<Json<Value>, ApiError> {
    let project = auth_project(&state, &headers, &uuid).await?;
    let (owner, repo, branch) = project_repo(&project)?;
    let br = q.branch.as_deref().unwrap_or(&branch);
    let runs = state
        .github
        .list_workflow_runs(&owner, &repo, Some(br))
        .await
        .map_err(map_gh)?;
    Ok(Json(json!({
        "ok": true,
        "owner": owner,
        "repo": repo,
        "branch": br,
        "runs": runs,
    })))
}

#[derive(Deserialize)]
struct EnsureRunnerBody {
    runner_name: Option<String>,
    image: Option<String>,
    labels: Option<String>,
}

async fn ensure_runner(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    body: Option<Json<EnsureRunnerBody>>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    if !caller_is_admin(&state, &headers).await? {
        return Err(ApiError::forbidden("Réservé à l’admin instance"));
    }
    let project = auth_project(&state, &headers, &uuid).await?;
    let (owner, repo, _branch) = project_repo(&project)?;
    let body = body.map(|j| j.0).unwrap_or(EnsureRunnerBody {
        runner_name: None,
        image: None,
        labels: None,
    });

    // Reuse existing runner for this project/repo if any.
    let listed = state.runners.list().await.map_err(map_gh)?;
    if let Some(arr) = listed.get("runners").and_then(|v| v.as_array()) {
        for r in arr {
            let o = r.get("owner").and_then(|x| x.as_str()).unwrap_or("");
            let rp = r.get("repo").and_then(|x| x.as_str()).unwrap_or("");
            let pu = r.get("project_uuid").and_then(|x| x.as_str());
            if pu == Some(uuid.as_str())
                || (o.eq_ignore_ascii_case(&owner) && rp.eq_ignore_ascii_case(&repo))
            {
                return Ok((
                    axum::http::StatusCode::OK,
                    Json(json!({
                        "ok": true,
                        "created": false,
                        "message": "Runner déjà présent pour ce repo",
                        "runner": r,
                    })),
                ));
            }
        }
    }

    let slug = project.slug.clone();
    let runner_name = body
        .runner_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("{slug}-runner"));

    let req = CreateRunnerRequest {
        owner,
        repo,
        runner_name,
        container_name: None,
        server_id: None,
        labels: Some(body.labels.unwrap_or_else(|| DEFAULT_LABELS.into())),
        image: body.image,
        network_mode: None,
        timezone: None,
        replace_existing: Some(true),
        pull_image: Some(true),
        volumes: None,
        extra_env: None,
        auth_mode: None,
        project_uuid: Some(uuid),
    };

    let v = state.runners.create_async(req).await.map_err(map_gh)?;
    Ok((
        axum::http::StatusCode::ACCEPTED,
        Json(json!({
            "ok": true,
            "created": true,
            "message": "Création du runner démarrée",
            "runner": v.get("runner"),
        })),
    ))
}

#[derive(Deserialize)]
struct PatchBody {
    /// If true, only report what would change.
    dry_run: Option<bool>,
}

async fn patch_workflows(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    body: Option<Json<PatchBody>>,
) -> Result<Json<Value>, ApiError> {
    if !caller_is_admin(&state, &headers).await? {
        return Err(ApiError::forbidden("Réservé à l’admin instance"));
    }
    let project = auth_project(&state, &headers, &uuid).await?;
    let (owner, repo, branch) = project_repo(&project)?;
    let dry = body.and_then(|j| j.0.dry_run).unwrap_or(false);

    let workflows = list_workflow_files(&state, &owner, &repo, &branch).await?;
    if workflows.is_empty() {
        return Ok(Json(json!({
            "ok": true,
            "message": "Aucun workflow dans .github/workflows",
            "patched": [],
            "skipped": [],
        })));
    }

    let mut patched = Vec::new();
    let mut skipped = Vec::new();

    for wf in workflows {
        if wf.skipped_dynamic {
            skipped.push(json!({
                "path": wf.path,
                "reason": "runs-on dynamique (${{ }}) — à adapter manuellement",
            }));
            continue;
        }
        if wf.uses_devforge {
            skipped.push(json!({
                "path": wf.path,
                "reason": "déjà configuré pour DevForge",
            }));
            continue;
        }

        let file = state
            .github
            .get_file(&owner, &repo, &wf.path, Some(&branch))
            .await
            .map_err(map_gh)?
            .ok_or_else(|| ApiError::message(format!("fichier manquant: {}", wf.path)))?;

        let (new_content, n) = patch_runs_on_yaml(&file.content);
        if n == 0 {
            skipped.push(json!({
                "path": wf.path,
                "reason": "aucune ligne runs-on modifiable",
            }));
            continue;
        }

        if dry {
            patched.push(json!({
                "path": wf.path,
                "changes": n,
                "dry_run": true,
            }));
            continue;
        }

        let msg = format!("chore(ci): use DevForge self-hosted runners ({})", wf.name);
        let written = state
            .github
            .write_file(
                &owner,
                &repo,
                &wf.path,
                &new_content,
                &msg,
                Some(&branch),
                Some(&file.sha),
            )
            .await
            .map_err(map_gh)?;

        patched.push(json!({
            "path": wf.path,
            "changes": n,
            "sha": written.sha,
            "commit_sha": written.commit_sha,
            "html_url": written.html_url,
            "dry_run": false,
        }));
    }

    let commit_urls: Vec<String> = patched
        .iter()
        .filter_map(|p| p.get("html_url").and_then(|u| u.as_str()).map(str::to_string))
        .collect();

    Ok(Json(json!({
        "ok": true,
        "dry_run": dry,
        "branch": branch,
        "owner": owner,
        "repo": repo,
        "patched": patched,
        "skipped": skipped,
        "commit_urls": commit_urls,
        "next_step": if dry || patched.is_empty() {
            Value::Null
        } else {
            json!("Les workflows ont été commités sur GitHub. Déploie depuis l’onglet Git pour appliquer en production.")
        },
        "message": if dry {
            "Simulation — aucun commit"
        } else if patched.is_empty() {
            "Rien à modifier"
        } else {
            "Workflows mis à jour pour utiliser les runners DevForge (commit sur GitHub)"
        },
    })))
}

#[cfg(test)]
mod tests {
    use super::patch_runs_on_yaml;

    #[test]
    fn patches_ubuntu_latest() {
        let yaml = "jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n";
        let (out, n) = patch_runs_on_yaml(yaml);
        assert_eq!(n, 1);
        assert!(out.contains("runs-on: [self-hosted, linux, x64, devforge]"));
        assert!(!out.contains("ubuntu-latest"));
    }

    #[test]
    fn skips_expression() {
        let yaml = "jobs:\n  build:\n    runs-on: ${{ matrix.os }}\n";
        let (out, n) = patch_runs_on_yaml(yaml);
        assert_eq!(n, 0);
        assert!(out.contains("${{ matrix.os }}"));
    }
}
