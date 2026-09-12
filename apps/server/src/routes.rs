use axum::{
    extract::{Path, State},
    http::HeaderMap,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Json,
    },
    routing::{get, post},
    Router,
};
use futures_util::stream::{self, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{convert::Infallible, time::Duration};
use std::fs;
use std::path::Path as FsPath;

use crate::state::{new_uuid, now_str, AppState, Deployment, Project};
use devforge_shared::ProjectTestContext;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/projects", get(list_projects).post(create_project))
        .route("/api/v1/projects/scaffold", post(scaffold_project))
        .route("/api/v1/templates", get(list_templates))
        .route(
            "/api/v1/projects/{uuid}",
            get(get_project).patch(update_project).delete(delete_project),
        )
        .route(
            "/api/v1/projects/{uuid}/deployments",
            get(list_deployments).post(create_deployment),
        )
        .route("/api/v1/deployments/{uuid}", get(get_deployment))
        .route("/api/v1/deployments/{uuid}/logs", get(deployment_logs))
        .route("/api/v1/agent/tools", get(agent_tools))
        .route("/api/v1/agent/chat", post(agent_chat))
        .route("/api/v1/agent/tools/{tool}", post(agent_execute_tool))
        .route("/api/v1/projects/{uuid}/publish", post(publish_project))
        .route("/api/v1/databases", post(create_database))
        .route("/api/v1/databases/{uuid}", get(get_database))
        .route(
            "/api/v1/projects/{uuid}/env",
            get(list_env).post(upsert_env),
        )
        .route(
            "/api/v1/projects/{uuid}/env/import",
            post(import_env),
        )
        .route(
            "/api/v1/projects/{uuid}/env/{key}",
            get(get_env).delete(delete_env),
        )
}

async fn health(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "ok": true,
        "service": "devforge-server",
        "version": state.updater.current_version(),
        "backends": {
            "executor": state.backends.executor,
            "github": state.backends.github_mode(),
            "storage": state.backends.storage_mode(),
            "database": state.backends.database,
            "llm": state.backends.llm_mode(),
            "update": state.updater.config().mode.as_str(),
        }
    }))
}

async fn list_projects(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let (_user, workspace) = crate::auth_routes::current_workspace(&state, &headers)
        .await
        .map_err(|(status, Json(v))| ApiError {
            status,
            message: v
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("auth")
                .to_string(),
        })?;
    let mut rows = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects WHERE workspace_uuid = ? ORDER BY updated_at DESC",
    )
    .bind(&workspace.uuid)
    .fetch_all(&state.pool)
    .await
    .map_err(ApiError::from)?;

    let mut out = Vec::with_capacity(rows.len());
    for p in &mut rows {
        p.status = resolve_project_status(&state, p).await?;
        let card = project_list_card(&state, p).await;
        out.push(card);
    }

    Ok(Json(json!({"data": out})))
}

async fn project_list_card(state: &AppState, project: &Project) -> Value {
    let latest: Option<(String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT status, git_sha, git_message FROM deployments WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(project.id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();

    let (dep_status, dep_sha, dep_message) = match &latest {
        Some((s, sha, msg)) => (
            s.clone(),
            sha.clone().unwrap_or_default(),
            msg.clone().unwrap_or_default(),
        ),
        None => (String::new(), String::new(), String::new()),
    };

    let mut sync = json!({
        "state": "no_git",
        "behind_by": 0,
        "deployed_sha": null,
        "head_sha": null,
    });

    if let Some(repo_url) = project.git_repository.as_deref() {
        if let Some((owner, repo)) = crate::infra_routes::parse_github_owner_repo(repo_url) {
            let branch = project
                .git_branch
                .as_deref()
                .filter(|b| !b.is_empty())
                .unwrap_or("main");

            if dep_status == "running" || dep_status == "queued" || dep_status == "building" {
                sync = json!({
                    "state": "deploying",
                    "behind_by": 0,
                    "deployed_sha": if dep_sha.is_empty() { Value::Null } else { json!(dep_sha) },
                    "head_sha": null,
                });
            } else if dep_status == "failed" || dep_status == "error" {
                sync = json!({
                    "state": "error",
                    "behind_by": 0,
                    "deployed_sha": if dep_sha.is_empty() { Value::Null } else { json!(dep_sha) },
                    "head_sha": null,
                    "error": dep_message,
                });
            } else if dep_sha.is_empty()
                || dep_sha == "pending"
                || dep_sha == "unknown"
                || latest.is_none()
            {
                sync = json!({
                    "state": "no_deploy",
                    "behind_by": 0,
                    "deployed_sha": null,
                    "head_sha": null,
                });
            } else if state.github.mode() == "off" {
                sync = json!({
                    "state": "unknown",
                    "behind_by": 0,
                    "deployed_sha": dep_sha,
                    "head_sha": null,
                });
            } else {
                match state
                    .github
                    .compare(&owner, &repo, &dep_sha, branch)
                    .await
                {
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
                            "deployed_sha": c.base_sha,
                            "head_sha": c.head_sha,
                        });
                    }
                    Err(_) => {
                        // Fallback: tip de branche vs sha déployé
                        let tip = state
                            .github
                            .list_branches(&owner, &repo)
                            .await
                            .ok()
                            .and_then(|bs| {
                                bs.into_iter()
                                    .find(|b| b.name == branch)
                                    .map(|b| b.commit_sha)
                            });
                        let behind = tip
                            .as_ref()
                            .map(|t| !dep_sha.starts_with(t) && !t.starts_with(&dep_sha))
                            .unwrap_or(true);
                        sync = json!({
                            "state": if behind { "behind" } else { "up_to_date" },
                            "behind_by": if behind { 1 } else { 0 },
                            "deployed_sha": dep_sha,
                            "head_sha": tip,
                        });
                    }
                }
            }
        }
    }

    json!({
        "uuid": project.uuid,
        "name": project.name,
        "slug": project.slug,
        "status": project.status,
        "git_repository": project.git_repository,
        "git_branch": project.git_branch,
        "build_pack": project.build_pack,
        "port": project.port,
        "production_url": project.production_url,
        "updated_at": project.updated_at,
        "deploy": {
            "status": if dep_status.is_empty() { Value::Null } else { json!(dep_status) },
            "sha": if dep_sha.is_empty() { Value::Null } else { json!(dep_sha) },
            "message": if dep_message.is_empty() { Value::Null } else { json!(dep_message) },
        },
        "sync": sync,
    })
}

#[derive(Deserialize)]
pub struct CreateProject {
    pub name: String,
    pub git_repository: Option<String>,
    pub git_branch: Option<String>,
    pub server_id: Option<String>,
    pub workdir: Option<String>,
    pub test_command: Option<String>,
    pub production_url: Option<String>,
    pub build_pack: Option<String>,
    pub port: Option<u16>,
    pub is_static: Option<bool>,
    pub publish_directory: Option<String>,
    pub base_directory: Option<String>,
    pub docker_compose_location: Option<String>,
}

async fn create_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateProject>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let (_user, workspace) = crate::auth_routes::current_workspace(&state, &headers)
        .await
        .map_err(|(status, Json(v))| ApiError {
            status,
            message: v
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("auth")
                .to_string(),
        })?;
    let uuid = new_uuid();
    let slug = format!(
        "{}-{}",
        slugify(&body.name),
        &uuid.replace('-', "")[..4]
    );
    let now = now_str();
    let build_pack = body
        .build_pack
        .unwrap_or_else(|| "nixpacks".into())
        .to_lowercase();
    let port = i64::from(body.port.unwrap_or(3000));
    let is_static = if body.is_static.unwrap_or(false) {
        1i64
    } else {
        0
    };
    let base_directory = body
        .base_directory
        .unwrap_or_else(|| "/".into());
    let app_host = slugify(&body.name);
    let production_url = if let Some(url) = body.production_url {
        Some(url)
    } else {
        // Derive from instance wildcard: {app}.{wildcard}
        let domain: Option<(String,)> =
            sqlx::query_as("SELECT wildcard_domain FROM instance_settings WHERE id = 1")
                .fetch_optional(&state.pool)
                .await
                .map_err(ApiError::from)?;
        domain.and_then(|(d,)| {
            let d = d.trim().trim_start_matches('.').to_string();
            if d.is_empty() || app_host.is_empty() {
                None
            } else {
                Some(format!("https://{app_host}.{d}"))
            }
        })
    };

    sqlx::query(
        r#"INSERT INTO projects (
            uuid, name, slug, status, git_repository, git_branch,
            server_id, workdir, test_command, production_url, workspace_uuid,
            build_pack, port, is_static, publish_directory, base_directory, docker_compose_location,
            created_at, updated_at
        ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
    )
    .bind(&uuid)
    .bind(&body.name)
    .bind(&slug)
    .bind(&body.git_repository)
    .bind(body.git_branch.clone().unwrap_or_else(|| "main".into()))
    .bind(body.server_id.unwrap_or_else(|| "default".into()))
    .bind(body.workdir.unwrap_or_else(|| {
        format!("/data/devforge/applications/{slug}")
    }))
    .bind(&body.test_command)
    .bind(&production_url)
    .bind(&workspace.uuid)
    .bind(&build_pack)
    .bind(port)
    .bind(is_static)
    .bind(&body.publish_directory)
    .bind(&base_directory)
    .bind(&body.docker_compose_location)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(ApiError::from)?;

    crate::db::seed_required_agents(&state.pool, &uuid)
        .await
        .map_err(ApiError::from)?;

    // Expose port + optional domain like alpha wizard
    let _ = state
        .ports
        .upsert(&uuid, port as u16, None, Some("tcp"), true)
        .await;
    if let Some(ref url) = production_url {
        let _ = ensure_project_primary_domain(&state, &uuid, url, port as u16).await;
    }

    // Re-détecte depuis GitHub (source de vérité framework) pour tous les nouveaux projets
    if let Some(repo_url) = body.git_repository.as_deref() {
        if let Some((owner, repo)) = crate::infra_routes::parse_github_owner_repo(repo_url) {
            let branch = body.git_branch.as_deref().unwrap_or("main");
            if let Ok(detection) = crate::detect_svc::detect_github_repo(
                &state.github,
                &owner,
                &repo,
                Some(branch),
            )
            .await
            {
                let now2 = now_str();
                let _ = sqlx::query(
                    r#"UPDATE projects SET
                        build_pack = ?, port = ?, is_static = ?, publish_directory = ?,
                        base_directory = ?, docker_compose_location = ?,
                        test_command = COALESCE(?, test_command), updated_at = ?
                       WHERE uuid = ?"#,
                )
                .bind(&detection.build_pack)
                .bind(i64::from(detection.port))
                .bind(if detection.is_static { 1i64 } else { 0 })
                .bind(&detection.publish_directory)
                .bind(&detection.base_directory)
                .bind(&detection.docker_compose_location)
                .bind(&detection.test_command)
                .bind(&now2)
                .bind(&uuid)
                .execute(&state.pool)
                .await;
                let _ = state
                    .ports
                    .upsert(&uuid, detection.port, None, Some("tcp"), true)
                    .await;
                if let Some(ref url) = production_url {
                    let _ =
                        ensure_project_primary_domain(&state, &uuid, url, detection.port).await;
                }
            }
        }
    }

    let project = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE uuid = ?")
        .bind(&uuid)
        .fetch_one(&state.pool)
        .await
        .map_err(ApiError::from)?;

    Ok((axum::http::StatusCode::CREATED, Json(json!({"data": project}))))
}

#[derive(Deserialize)]
pub struct ScaffoldProject {
    pub title: String,
    pub prompt: String,
    pub template: Option<String>,
}

async fn scaffold_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ScaffoldProject>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let (_user, workspace) = crate::auth_routes::current_workspace(&state, &headers)
        .await
        .map_err(|(status, Json(v))| ApiError {
            status,
            message: v
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("auth")
                .to_string(),
        })?;

    let uuid = new_uuid();
    let slug = format!(
        "{}-{}",
        slugify(&body.title),
        &uuid.replace('-', "")[..4]
    );
    let now = now_str();

    // Create minimal project
    sqlx::query(
        r#"INSERT INTO projects (
            uuid, name, slug, status, git_repository, git_branch,
            server_id, workdir, test_command, production_url, workspace_uuid,
            build_pack, port, is_static, publish_directory, base_directory, docker_compose_location,
            created_at, updated_at
        ) VALUES (?, ?, ?, 'draft', '', 'main', 'default', ?, '', '', ?, 'nixpacks', 3000, 0, '', '/', '', ?, ?)"#,
    )
    .bind(&uuid)
    .bind(&body.title)
    .bind(&slug)
    .bind(&format!("/data/devforge/applications/{slug}"))
    .bind(&workspace.uuid)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(ApiError::from)?;

    // Seed agents
    crate::db::seed_required_agents(&state.pool, &uuid)
        .await
        .map_err(ApiError::from)?;

    // Get the deploy agent UUID to seed the prompt
    let agent_uuid_row: Option<(String,)> = sqlx::query_as(
        "SELECT uuid FROM project_agents WHERE project_uuid = ? AND role = 'deploy' LIMIT 1",
    )
    .bind(&uuid)
    .fetch_optional(&state.pool)
    .await
    .map_err(ApiError::from)?;

    let agent_uuid = if let Some((uuid,)) = agent_uuid_row {
        uuid
    } else {
        // If no deploy agent found, create one
        let new_id = new_uuid();
        sqlx::query(
            r#"INSERT INTO project_agents (
                uuid, project_uuid, name, role, kind, parent_agent_uuid, status, created_at, updated_at
            ) VALUES (?, ?, 'Builder', 'deploy', 'custom', NULL, 'idle', ?, ?)"#,
        )
        .bind(&new_id)
        .bind(&uuid)
        .bind(&now)
        .bind(&now)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;
        new_id
    };

    // Seed first message with the user prompt
    let msg_uuid = new_uuid();
    
    // Apply template if provided
    let template_name = body.template.as_deref().unwrap_or("astro-preact-sqlite");
    let template_applied = if let Err(e) = apply_template(template_name, &format!("/data/devforge/applications/{slug}")) {
        eprintln!("[scaffold] Erreur lors de l'application du template {} : {}", template_name, e);
        false
    } else {
        true
    };
    
    let seed_content = if template_applied {
        format!(
            "Nouveau projet DevForge : {}\n\nObjectif :\n{}\n\n✅ Template {} déjà appliqué (Astro + Preact + Tailwind + DaisyUI + SQLite).\n\n🎯 TON RÔLE : Prépare une PREVIEW LOCALE testable.\n\n🚨 WORKFLOW OBLIGATOIRE :\n1. Le template est déjà dans le workdir — NE réécris PAS les fichiers\n2. Si des customisations sont demandées : applique-les en local avec write_project_file mode='local'\n3. Lance le serveur dev local (npm run dev ou équivalent) pour que la Preview fonctionne\n\n❌ INTERDIT (l'utilisateur n'a PAS encore validé) :\n- create_github_repo (pas de repo GitHub avant validation utilisateur)\n- sync_workdir_to_github (pas de push avant validation)\n- trigger_deploy (pas de déploiement avant validation)\n\n✅ APRÈS validation utilisateur, il pourra cliquer « Publier » pour déclencher GitHub + deploy.\n\nPour l'instant : preview locale uniquement.",
            body.title, body.prompt, template_name
        )
    } else {
        format!(
            "Nouveau projet DevForge : {}\n\nObjectif :\n{}\n\nScaffold ce projet en LOCAL. Prépare une preview testable. NE crée PAS de repo GitHub avant validation utilisateur.",
            body.title, body.prompt
        )
    };

    sqlx::query(
        r#"INSERT INTO agent_messages (
            uuid, project_uuid, agent_uuid, role, content, tool_calls_json, provider, created_at
        ) VALUES (?, ?, ?, 'user', ?, '[]', 'system', ?)"#,
    )
    .bind(&msg_uuid)
    .bind(&uuid)
    .bind(&agent_uuid)
    .bind(&seed_content)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(ApiError::from)?;

    let project = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE uuid = ?")
        .bind(&uuid)
        .fetch_one(&state.pool)
        .await
        .map_err(ApiError::from)?;

    // Return agent info as simple JSON value
    let agent_info = serde_json::json!({
        "uuid": agent_uuid,
        "project_uuid": uuid,
        "role": "deploy"
    });

    // CHANGEMENT : Ne plus auto-kick l'agent Deploy au scaffold.
    // L'utilisateur teste la preview locale, puis clique explicitement « Publier »
    // pour déclencher create_github_repo + sync + deploy.
    //
    // Workflow local-first :
    // 1. Scaffold → template copié dans workdir
    // 2. Preview locale (serveur dev dans le workdir)
    // 3. Utilisateur valide → appelle publish_to_github tool (nouveau)
    // 4. publish_to_github fait : create_github_repo + sync_workdir_to_github + trigger_deploy

    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "data": { "project": project, "agent": agent_info } })),
    ))
}

async fn get_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (_user, _ws, mut project) = auth_project(&state, &headers, &uuid).await?;
    project.status = resolve_project_status(&state, &project).await?;
    let deployments = sqlx::query_as::<_, Deployment>(
        "SELECT * FROM deployments WHERE project_id = ? ORDER BY created_at DESC LIMIT 10",
    )
    .bind(project.id)
    .fetch_all(&state.pool)
    .await
    .map_err(ApiError::from)?;

    Ok(Json(json!({"data": {"project": project, "deployments": deployments}})))
}

#[derive(Deserialize)]
pub struct UpdateProject {
    pub name: Option<String>,
    pub status: Option<String>,
    pub git_repository: Option<String>,
    pub git_branch: Option<String>,
    pub server_id: Option<String>,
    pub workdir: Option<String>,
    pub test_command: Option<String>,
    pub production_url: Option<String>,
    pub build_pack: Option<String>,
    pub port: Option<u16>,
    pub is_static: Option<bool>,
    /// `auto` (hérite) | `on` | `off`
    pub sso_protection: Option<String>,
    pub has_own_user_system: Option<bool>,
    pub publish_directory: Option<String>,
    pub base_directory: Option<String>,
    pub docker_compose_location: Option<String>,
}

async fn update_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<UpdateProject>,
) -> Result<Json<Value>, ApiError> {
    let (_user, _ws, existing) = auth_project(&state, &headers, &uuid).await?;
    let now = now_str();
    let is_static = body
        .is_static
        .map(|v| if v { 1i64 } else { 0 })
        .unwrap_or(existing.is_static);
    let port = body.port.map(i64::from).unwrap_or(existing.port);

    let is_sso_protected = match body.sso_protection.as_deref().map(str::trim) {
        Some("on") | Some("true") | Some("1") => Some(Some(1i64)),
        Some("off") | Some("false") | Some("0") => Some(Some(0i64)),
        Some("auto") | Some("") => Some(None),
        Some(_) => {
            return Err(ApiError::message("sso_protection must be auto|on|off"));
        }
        None => None,
    };
    let is_sso_protected = match is_sso_protected {
        Some(v) => v,
        None => existing.is_sso_protected,
    };

    let has_own_user_system = match body.has_own_user_system {
        Some(true) => Some(1i64),
        Some(false) => Some(0i64),
        None => existing.has_own_user_system,
    };
    // Own user system force SSO barrier off.
    let is_sso_protected = if has_own_user_system == Some(1) {
        Some(0)
    } else {
        is_sso_protected
    };

    sqlx::query(
        r#"UPDATE projects SET
            name = ?, status = ?, git_repository = ?, git_branch = ?,
            server_id = ?, workdir = ?, test_command = ?, production_url = ?,
            build_pack = ?, port = ?, is_static = ?, publish_directory = ?,
            base_directory = ?, docker_compose_location = ?,
            is_sso_protected = ?, has_own_user_system = ?, updated_at = ?
        WHERE uuid = ?"#,
    )
    .bind(body.name.unwrap_or(existing.name))
    .bind(body.status.unwrap_or(existing.status))
    .bind(body.git_repository.or(existing.git_repository))
    .bind(body.git_branch.or(existing.git_branch))
    .bind(body.server_id.or(existing.server_id))
    .bind(body.workdir.or(existing.workdir))
    .bind(body.test_command.or(existing.test_command))
    .bind(body.production_url.or(existing.production_url))
    .bind(body.build_pack.unwrap_or(existing.build_pack))
    .bind(port)
    .bind(is_static)
    .bind(body.publish_directory.or(existing.publish_directory))
    .bind(body.base_directory.unwrap_or(existing.base_directory))
    .bind(body.docker_compose_location.or(existing.docker_compose_location))
    .bind(is_sso_protected)
    .bind(has_own_user_system)
    .bind(&now)
    .bind(&uuid)
    .execute(&state.pool)
    .await
    .map_err(ApiError::from)?;

    let _ = state
        .ports
        .upsert(&uuid, port as u16, None, Some("tcp"), true)
        .await;

    let (_user, _ws, project) = auth_project(&state, &headers, &uuid).await?;
    if let Some(ref url) = project.production_url {
        let _ = ensure_project_primary_domain(&state, &uuid, url, port as u16).await;
    } else {
        crate::sso::sync_project_proxy(&state, &project).await;
    }
    let _ = crate::sso::ensure_oidc_env(&state.pool, &project).await;
    Ok(Json(json!({"data": project})))
}

async fn delete_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (_user, _ws, project) = auth_project(&state, &headers, &uuid).await?;

    // Best-effort stop container before delete
    let ctx = ProjectTestContext {
        project_uuid: project.uuid.clone(),
        server_id: project.server_id.clone().unwrap_or_else(|| "default".into()),
        workdir: project.workdir.clone().unwrap_or_default(),
        test_command: String::new(),
        timeout: None,
    };
    let _ = state.deploy.stop(&ctx).await;

    sqlx::query("DELETE FROM project_env_vars WHERE project_uuid = ?")
        .bind(&uuid)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;
    sqlx::query("DELETE FROM project_agents WHERE project_uuid = ?")
        .bind(&uuid)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;
    sqlx::query("DELETE FROM project_ports WHERE project_uuid = ?")
        .bind(&uuid)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;
    sqlx::query("DELETE FROM project_domains WHERE project_uuid = ?")
        .bind(&uuid)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;
    sqlx::query("DELETE FROM project_proxy_routes WHERE project_uuid = ?")
        .bind(&uuid)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;
    // deployments cascade via FK on project_id
    let res = sqlx::query("DELETE FROM projects WHERE uuid = ? AND workspace_uuid = ?")
        .bind(&uuid)
        .bind(&project.workspace_uuid)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;
    if res.rows_affected() == 0 {
        return Err(ApiError::not_found("project"));
    }

    Ok(Json(json!({
        "ok": true,
        "deleted": uuid,
    })))
}

async fn list_deployments(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (_user, _ws, project) = auth_project(&state, &headers, &uuid).await?;
    let rows = sqlx::query_as::<_, Deployment>(
        "SELECT * FROM deployments WHERE project_id = ? ORDER BY created_at DESC LIMIT 50",
    )
    .bind(project.id)
    .fetch_all(&state.pool)
    .await
    .map_err(ApiError::from)?;
    Ok(Json(json!({"data": rows})))
}

#[derive(Deserialize)]
pub struct CreateDeployment {
    pub git_sha: Option<String>,
    pub git_message: Option<String>,
}

async fn create_deployment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<CreateDeployment>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let (_user, _ws, project) = auth_project(&state, &headers, &uuid).await?;
    if project
        .git_repository
        .as_deref()
        .unwrap_or("")
        .trim()
        .is_empty()
    {
        return Err(ApiError::message(
            "git_repository manquant — configure le projet ou importe depuis GitHub",
        ));
    }

    // Domaine principal auto : {app}.{wildcard} si manquant
    let production_url = ensure_production_url(&state, &project).await?;
    if let Some(ref url) = production_url {
        let _ = ensure_project_primary_domain(
            &state,
            &project.uuid,
            url,
            project.port.clamp(1, 65535) as u16,
        )
        .await;
    }
    let (_user, _ws, project) = auth_project(&state, &headers, &uuid).await?;

    let dep_uuid = new_uuid();
    let now = now_str();
    let message = body
        .git_message
        .unwrap_or_else(|| "Manual deploy".into());

    // Mark queued first
    sqlx::query(
        r#"INSERT INTO deployments (
            uuid, project_id, status, git_sha, git_message, logs, finished_at, created_at, updated_at
        ) VALUES (?, ?, 'running', ?, ?, ?, NULL, ?, ?)"#,
    )
    .bind(&dep_uuid)
    .bind(project.id)
    .bind(body.git_sha.as_deref().unwrap_or("pending"))
    .bind(&message)
    .bind("[devforge] starting…\n")
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(ApiError::from)?;

    sqlx::query("UPDATE projects SET status = 'deploying', updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(project.id)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;

    let result = run_real_deploy(&state, &project).await;
    let finished = now_str();
    let status = if result.ok { "success" } else { "failed" };
    let sha = result
        .git_sha
        .or(body.git_sha)
        .unwrap_or_else(|| "unknown".into());

    sqlx::query(
        r#"UPDATE deployments SET status = ?, git_sha = ?, logs = ?, finished_at = ?, updated_at = ?
           WHERE uuid = ?"#,
    )
    .bind(status)
    .bind(&sha)
    .bind(&result.logs)
    .bind(&finished)
    .bind(&finished)
    .bind(&dep_uuid)
    .execute(&state.pool)
    .await
    .map_err(ApiError::from)?;

    let project_status = if result.ok { "live" } else { "failed" };
    sqlx::query("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?")
        .bind(project_status)
        .bind(&finished)
        .bind(project.id)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;

    let dep = sqlx::query_as::<_, Deployment>("SELECT * FROM deployments WHERE uuid = ?")
        .bind(&dep_uuid)
        .fetch_one(&state.pool)
        .await
        .map_err(ApiError::from)?;

    Ok((
        if result.ok {
            axum::http::StatusCode::CREATED
        } else {
            axum::http::StatusCode::OK
        },
        Json(json!({"data": dep, "ok": result.ok})),
    ))
}

async fn run_real_deploy(state: &AppState, project: &Project) -> devforge_deploy::DeployResult {
    let token: Option<String> =
        sqlx::query_as::<_, (String,)>("SELECT github_token FROM instance_settings WHERE id = 1")
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten()
            .map(|(t,)| t)
            .filter(|t| !t.trim().is_empty());

    let _ = crate::sso::ensure_oidc_env(&state.pool, project).await;

    let env_vars = state.env.list_public(&project.uuid).await.ok().unwrap_or_default();
    // Need raw values for .env — list from store via upsert path; use facade list that masks.
    // Fetch unmasked from SQLite directly for deploy.
    let env_file = load_env_file_content(&state.pool, &project.uuid).await;

    let _ = env_vars; // public view unused
    let req = devforge_deploy::DeployRequest {
        project_uuid: project.uuid.clone(),
        server_id: project
            .server_id
            .clone()
            .unwrap_or_else(|| "default".into()),
        workdir: project.workdir.clone().unwrap_or_default(),
        git_repository: project.git_repository.clone().unwrap_or_default(),
        git_branch: project
            .git_branch
            .clone()
            .unwrap_or_else(|| "main".into()),
        build_pack: if project.build_pack.is_empty() {
            "nixpacks".into()
        } else {
            project.build_pack.clone()
        },
        port: project.port.clamp(1, 65535) as u16,
        base_directory: if project.base_directory.is_empty() {
            "/".into()
        } else {
            project.base_directory.clone()
        },
        docker_compose_location: project.docker_compose_location.clone(),
        publish_directory: project.publish_directory.clone(),
        is_static: project.is_static != 0,
        github_token: token,
        env_file,
        proxy_labels: proxy_labels_for_project(state, project).await,
    };
    let result = state.deploy.deploy(&req).await;
    if result.ok {
        crate::sso::sync_project_proxy(state, project).await;
    }
    result
}

pub(crate) async fn load_env_file_content(
    pool: &sqlx::SqlitePool,
    project_uuid: &str,
) -> Option<String> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT key, value FROM project_env_vars WHERE project_uuid = ? ORDER BY key",
    )
    .bind(project_uuid)
    .fetch_all(pool)
    .await
    .ok()?;
    if rows.is_empty() {
        return None;
    }
    Some(devforge_env::serialize_docker_env_file(&rows))
}

async fn get_deployment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (_user, _ws, dep) = auth_deployment(&state, &headers, &uuid).await?;
    Ok(Json(json!({"data": dep})))
}

async fn deployment_logs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (_user, _ws, dep) = auth_deployment(&state, &headers, &uuid).await?;
    Ok(Json(json!({
        "data": {
            "uuid": dep.uuid,
            "status": dep.status,
            "logs": dep.logs.unwrap_or_default()
        }
    })))
}

async fn agent_tools(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let _ = require_auth(&state, &headers).await?;
    Ok(Json(json!({"data": state.registry.definitions()})))
}

#[derive(Deserialize)]
pub struct ChatBody {
    pub message: String,
    pub tool: Option<String>,
    pub arguments: Option<Value>,
    pub stream: Option<bool>,
    pub project_uuid: Option<String>,
    pub agent_uuid: Option<String>,
}

struct ProjectAgentBrief {
    text: String,
    git_owner: Option<String>,
    git_repo: Option<String>,
    git_branch: Option<String>,
}

async fn build_project_agent_brief(
    state: &AppState,
    project_uuid: &str,
) -> Result<ProjectAgentBrief, ApiError> {
    let p = sqlx::query_as::<_, crate::state::Project>("SELECT * FROM projects WHERE uuid = ?")
        .bind(project_uuid)
        .fetch_optional(&state.pool)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("project"))?;

    let deps: Vec<(String, String, Option<String>, Option<String>, String)> = sqlx::query_as(
        r#"SELECT uuid, status, git_sha, git_message, created_at
           FROM deployments WHERE project_id = ? ORDER BY id DESC LIMIT 5"#,
    )
    .bind(p.id)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();

    let (git_owner, git_repo) = p
        .git_repository
        .as_deref()
        .and_then(devforge_agent::parse_github_repo)
        .map(|(o, r)| (Some(o), Some(r)))
        .unwrap_or((None, None));
    let git_branch = p.git_branch.clone();

    let mut lines = vec![
        format!("Projet courant (contexte actif) :"),
        format!("- name: {}", p.name),
        format!("- uuid: {}", p.uuid),
        format!("- status: {}", p.status),
        format!("- slug: {}", p.slug),
        format!(
            "- git: {} @ {}",
            p.git_repository.as_deref().unwrap_or("(aucun)"),
            p.git_branch.as_deref().unwrap_or("main")
        ),
        format!(
            "- production_url: {}",
            p.production_url.as_deref().unwrap_or("(aucune)")
        ),
        format!("- build_pack: {} · port: {}", p.build_pack, p.port),
    ];
    if let (Some(o), Some(r)) = (&git_owner, &git_repo) {
        lines.push(format!("- github: {o}/{r}"));
    }
    if deps.is_empty() {
        lines.push("- déploiements: aucun".into());
    } else {
        lines.push("- derniers déploiements:".into());
        for (uuid, status, sha, msg, created) in &deps {
            let sha_s = sha.as_deref().unwrap_or("?");
            let msg_s = msg.as_deref().unwrap_or("").chars().take(80).collect::<String>();
            lines.push(format!(
                "  · {status} · {sha_s} · {msg_s} · {created} ({uuid})"
            ));
        }
    }
    lines.push(
        "Utilise ces infos comme base. Pour approfondir : get_project, github_list_prs, \
         github_workflow_runs, get_deployment_logs, list_env_vars."
            .into(),
    );

    Ok(ProjectAgentBrief {
        text: lines.join("\n"),
        git_owner,
        git_repo,
        git_branch,
    })
}

/// Déclenche un tour d'agent de manière interne (sans requête HTTP).
/// Utilisé après scaffold pour lancer automatiquement l'agent.
async fn trigger_agent_turn(
    state: &AppState,
    project_uuid: &str,
    agent_uuid: &str,
) -> Result<(), String> {
    let mut ctx = devforge_agent::AgentChatContext {
        project_uuid: Some(project_uuid.to_string()),
        agent_uuid: Some(agent_uuid.to_string()),
        agent_role: None,
        agent_name: None,
        project_brief: None,
        git_owner: None,
        git_repo: None,
        git_branch: None,
        history: vec![],
    };

    // Charger les infos de l'agent
    if let Ok(Some((name, role))) = sqlx::query_as::<_, (String, String)>(
        "SELECT name, role FROM project_agents WHERE uuid = ?",
    )
    .bind(agent_uuid)
    .fetch_optional(&state.pool)
    .await
    {
        ctx.agent_name = Some(name);
        ctx.agent_role = Some(role);
    }

    // Charger l'historique (derniers 20 messages)
    if let Ok(rows) = sqlx::query_as::<_, (String, String)>(
        "SELECT role, content FROM agent_messages WHERE agent_uuid = ? ORDER BY id DESC LIMIT 20",
    )
    .bind(agent_uuid)
    .fetch_all(&state.pool)
    .await
    {
        let mut hist = rows;
        hist.reverse();
        ctx.history = hist;
    }

    // Charger le contexte projet
    if let Ok(brief) = build_project_agent_brief(state, project_uuid).await {
        ctx.git_owner = brief.git_owner;
        ctx.git_repo = brief.git_repo;
        ctx.git_branch = brief.git_branch;
        ctx.project_brief = Some(brief.text);
    }

    // Mettre l'agent en statut 'working'
    let now = now_str();
    let _ = sqlx::query(
        "UPDATE project_agents SET status = 'working', updated_at = ? WHERE uuid = ?",
    )
    .bind(&now)
    .bind(agent_uuid)
    .execute(&state.pool)
    .await;

    // Vérifier si l'agent a déjà répondu (éviter les double-runs)
    let has_assistant_reply = sqlx::query_as::<_, (i64,)>(
        "SELECT COUNT(*) FROM agent_messages WHERE agent_uuid = ? AND role = 'assistant'",
    )
    .bind(agent_uuid)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    if has_assistant_reply.0 > 0 {
        // L'agent a déjà répondu, pas besoin de relancer
        return Ok(());
    }

    // Le dernier message utilisateur (seed) est déjà dans agent_messages.
    // On récupère son contenu pour le passer à l'agent.
    let last_user_msg = sqlx::query_as::<_, (String,)>(
        "SELECT content FROM agent_messages WHERE agent_uuid = ? AND role = 'user' ORDER BY id DESC LIMIT 1",
    )
    .bind(agent_uuid)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    let Some((user_message,)) = last_user_msg else {
        return Err("Aucun message utilisateur trouvé pour cet agent".to_string());
    };

    // Exécuter le tour de l'agent
    let result = state
        .agent
        .handle_with_context(&user_message, None, None, ctx)
        .await
        .map_err(|e| e.to_string())?;

    // Sauvegarder la réponse de l'agent
    let now = now_str();
    let tools_json = serde_json::to_string(&result.tool_calls).unwrap_or_else(|_| "[]".into());

    let _ = sqlx::query(
        r#"INSERT INTO agent_messages (uuid, project_uuid, agent_uuid, role, content, tool_calls_json, provider, created_at)
           VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?)"#,
    )
    .bind(new_uuid())
    .bind(project_uuid)
    .bind(agent_uuid)
    .bind(&result.reply)
    .bind(&tools_json)
    .bind(&result.provider)
    .bind(&now)
    .execute(&state.pool)
    .await;

    // Marquer l'agent comme 'idle'
    let _ = sqlx::query(
        "UPDATE project_agents SET status = 'idle', updated_at = ? WHERE uuid = ?",
    )
    .bind(&now)
    .bind(agent_uuid)
    .execute(&state.pool)
    .await;

    Ok(())
}

async fn agent_chat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ChatBody>,
) -> Result<axum::response::Response, ApiError> {
    let (_user, workspace) = require_auth(&state, &headers).await?;
    let mut ctx = devforge_agent::AgentChatContext {
        project_uuid: body.project_uuid.clone().filter(|s| !s.is_empty()),
        agent_uuid: body.agent_uuid.clone().filter(|s| !s.is_empty()),
        agent_role: None,
        agent_name: None,
        project_brief: None,
        git_owner: None,
        git_repo: None,
        git_branch: None,
        history: vec![],
    };

    // Arguments may also carry project/agent (UI historique).
    if ctx.project_uuid.is_none() {
        if let Some(uuid) = body
            .arguments
            .as_ref()
            .and_then(|a| a.get("project_uuid"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            ctx.project_uuid = Some(uuid.to_string());
        }
    }
    if ctx.agent_uuid.is_none() {
        if let Some(uuid) = body
            .arguments
            .as_ref()
            .and_then(|a| a.get("agent_uuid"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            ctx.agent_uuid = Some(uuid.to_string());
        }
    }

    if let Some(agent_uuid) = &ctx.agent_uuid {
        if let Ok(Some((name, role))) = sqlx::query_as::<_, (String, String)>(
            "SELECT name, role FROM project_agents WHERE uuid = ?",
        )
        .bind(agent_uuid)
        .fetch_optional(&state.pool)
        .await
        {
            ctx.agent_name = Some(name);
            ctx.agent_role = Some(role);
        }

        // Last 20 turns for LLM context.
        if let Ok(rows) = sqlx::query_as::<_, (String, String)>(
            "SELECT role, content FROM agent_messages WHERE agent_uuid = ? ORDER BY id DESC LIMIT 20",
        )
        .bind(agent_uuid)
        .fetch_all(&state.pool)
        .await
        {
            let mut hist = rows;
            hist.reverse();
            ctx.history = hist;
        }
    }

    if let Some(project_uuid) = &ctx.project_uuid {
        // Isolation tenant : le projet doit appartenir au workspace.
        let _ = auth_project(&state, &headers, project_uuid).await?;
        if let Ok(brief) = build_project_agent_brief(&state, project_uuid).await {
            ctx.git_owner = brief.git_owner;
            ctx.git_repo = brief.git_repo;
            ctx.git_branch = brief.git_branch;
            ctx.project_brief = Some(brief.text);
        }
    }
    let _ = workspace;

    let project_uuid = ctx.project_uuid.clone();
    let agent_uuid = ctx.agent_uuid.clone();

    let result = state
        .agent
        .handle_with_context(
            &body.message,
            body.tool.as_deref(),
            body.arguments.clone(),
            ctx,
        )
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;

    if let (Some(project_uuid), Some(agent_uuid)) = (project_uuid, agent_uuid) {
        let now = crate::state::now_str();
        let tools_json =
            serde_json::to_string(&result.tool_calls).unwrap_or_else(|_| "[]".into());
        let _ = sqlx::query(
            r#"INSERT INTO agent_messages (uuid, project_uuid, agent_uuid, role, content, tool_calls_json, provider, created_at)
               VALUES (?, ?, ?, 'user', ?, '[]', '', ?)"#,
        )
        .bind(crate::state::new_uuid())
        .bind(&project_uuid)
        .bind(&agent_uuid)
        .bind(&body.message)
        .bind(&now)
        .execute(&state.pool)
        .await;
        let _ = sqlx::query(
            r#"INSERT INTO agent_messages (uuid, project_uuid, agent_uuid, role, content, tool_calls_json, provider, created_at)
               VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?)"#,
        )
        .bind(crate::state::new_uuid())
        .bind(&project_uuid)
        .bind(&agent_uuid)
        .bind(&result.reply)
        .bind(&tools_json)
        .bind(&result.provider)
        .bind(&now)
        .execute(&state.pool)
        .await;
        let _ = sqlx::query(
            "UPDATE project_agents SET status = 'idle', updated_at = ? WHERE uuid = ?",
        )
        .bind(&now)
        .bind(&agent_uuid)
        .execute(&state.pool)
        .await;
    }

    if body.stream.unwrap_or(false) {
        let reply = result.reply.clone();
        let tools = result.tool_calls.clone();
        let provider = result.provider.clone();
        let stream = stream::iter(std::iter::once(Ok::<Event, Infallible>(
            Event::default()
                .event("message")
                .data(
                    json!({"type":"reply","content": reply, "provider": provider}).to_string(),
                ),
        )))
        .chain(stream::iter(tools.into_iter().map(|call| {
            Ok::<Event, Infallible>(
                Event::default()
                    .event("tool")
                    .data(serde_json::to_string(&call).unwrap_or_default()),
            )
        })))
        .chain(stream::iter(std::iter::once(Ok::<Event, Infallible>(
            Event::default().event("done").data("{}"),
        ))));

        return Ok(Sse::new(stream)
            .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
            .into_response());
    }

    Ok(Json(json!({"data": result})).into_response())
}

#[derive(Deserialize)]
pub struct ToolBody {
    pub arguments: Option<Value>,
}

async fn agent_execute_tool(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(tool): Path<String>,
    Json(body): Json<ToolBody>,
) -> Result<Json<Value>, ApiError> {
    let _ = require_auth(&state, &headers).await?;
    if !state.registry.has(&tool) {
        return Err(ApiError::not_found(&format!("tool {tool}")));
    }
    let args = body.arguments.unwrap_or_else(|| json!({}));
    // Si un project_uuid est fourni, vérifier l’appartenance workspace.
    if let Some(uuid) = args
        .get("project_uuid")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        let _ = auth_project(&state, &headers, uuid).await?;
    }
    let result = state
        .registry
        .execute(&tool, args)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;
    Ok(Json(json!({"data": result})))
}

#[derive(Deserialize)]
pub struct CreateDb {
    pub name: String,
    pub engine: Option<String>,
}

async fn create_database(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateDb>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let _ = require_auth(&state, &headers).await?;
    let result = state
        .databases
        .provision(&body.name, body.engine.as_deref());
    let status = if result.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        axum::http::StatusCode::CREATED
    } else {
        axum::http::StatusCode::UNPROCESSABLE_ENTITY
    };
    Ok((status, Json(json!({"data": result}))))
}

async fn get_database(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let _ = require_auth(&state, &headers).await?;
    Ok(Json(json!({"data": state.databases.status(&uuid)})))
}

async fn list_env(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let _ = auth_project(&state, &headers, &uuid).await?;
    let vars = state
        .env
        .list_public(&uuid)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;
    Ok(Json(json!({"data": vars})))
}

async fn get_env(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, key)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let _ = auth_project(&state, &headers, &uuid).await?;
    let var = state
        .env
        .get(&uuid, &key)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?
        .ok_or_else(|| ApiError::not_found("env var"))?;
    // Ne jamais renvoyer la valeur claire d’un secret via GET.
    let value = if var.secret {
        "********".into()
    } else {
        var.value
    };
    Ok(Json(json!({
        "data": {
            "key": var.key,
            "value": value,
            "secret": var.secret,
        }
    })))
}

#[derive(Deserialize)]
pub struct UpsertEnvBody {
    pub key: String,
    pub value: String,
    pub secret: Option<bool>,
}

async fn upsert_env(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<UpsertEnvBody>,
) -> Result<Json<Value>, ApiError> {
    let _ = auth_project(&state, &headers, &uuid).await?;
    let view = state
        .env
        .upsert(
            &uuid,
            devforge_env::EnvVar {
                key: body.key,
                value: body.value,
                secret: body.secret.unwrap_or(true),
            },
        )
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;
    Ok(Json(json!({"data": view})))
}

async fn delete_env(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, key)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let _ = auth_project(&state, &headers, &uuid).await?;
    let deleted = state
        .env
        .delete(&uuid, &key)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;
    Ok(Json(json!({"ok": deleted})))
}

#[derive(Deserialize)]
pub struct ImportEnvBody {
    pub content: String,
    pub overwrite: Option<bool>,
}

async fn import_env(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<ImportEnvBody>,
) -> Result<Json<Value>, ApiError> {
    let _ = auth_project(&state, &headers, &uuid).await?;
    let result = state
        .env
        .import_dotenv(&uuid, &body.content, body.overwrite.unwrap_or(true))
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;
    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct PublishProjectBody {
    pub repo_name: Option<String>,
    pub description: Option<String>,
    pub private: Option<bool>,
}

/// POST /api/v1/projects/{uuid}/publish
/// Workflow complet validé par l'utilisateur : create repo GitHub + sync workdir + optionnel deploy.
async fn publish_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<PublishProjectBody>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let (_user, _ws, project) = auth_project(&state, &headers, &uuid).await?;

    // Dériver repo_name depuis le slug si non fourni
    let repo_name = body.repo_name.unwrap_or_else(|| {
        // Nettoyer le slug : retirer le suffixe -xxxx
        let slug = &project.slug;
        if let Some(idx) = slug.rfind('-') {
            if slug[idx + 1..].len() == 4 && slug[idx + 1..].chars().all(|c| c.is_ascii_alphanumeric()) {
                return slug[..idx].to_string();
            }
        }
        slug.clone()
    });

    let description = body.description.unwrap_or_else(|| {
        format!("Application {} générée par DevForge", project.name)
    });
    let private = body.private.unwrap_or(true);

    // Vérifier si déjà publié
    if let Some(ref repo_url) = project.git_repository {
        if !repo_url.trim().is_empty() {
            return Ok((
                axum::http::StatusCode::OK,
                Json(json!({
                    "ok": true,
                    "already_published": true,
                    "git_repository": repo_url,
                    "message": "Le projet est déjà publié sur GitHub."
                })),
            ));
        }
    }

    // Appeler le tool publish_to_github via l'agent registry
    let args = json!({
        "project_uuid": uuid,
        "repo_name": repo_name,
        "description": description,
        "private": private
    });

    let result = state
        .registry
        .execute("publish_to_github", args)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;

    let ok = result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
    let status_code = if ok {
        axum::http::StatusCode::OK
    } else {
        axum::http::StatusCode::UNPROCESSABLE_ENTITY
    };

    Ok((status_code, Json(json!({ "data": result }))))
}

#[allow(dead_code)]
async fn fetch_project(state: &AppState, uuid: &str) -> Result<Project, ApiError> {
    sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE uuid = ?")
        .bind(uuid)
        .fetch_optional(&state.pool)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("project"))
}

/// Auth + projet appartenant au workspace de l’utilisateur.
pub(crate) async fn auth_project(
    state: &AppState,
    headers: &HeaderMap,
    uuid: &str,
) -> Result<(crate::auth_routes::UserRow, crate::auth_routes::TeamRow, Project), ApiError> {
    let (user, workspace) = crate::auth_routes::current_workspace(state, headers)
        .await
        .map_err(ApiError::from_auth)?;
    let project = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects WHERE uuid = ? AND workspace_uuid = ?",
    )
    .bind(uuid)
    .bind(&workspace.uuid)
    .fetch_optional(&state.pool)
    .await
    .map_err(ApiError::from)?
    .ok_or_else(|| ApiError::not_found("project"))?;
    Ok((user, workspace, project))
}

async fn require_auth(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(crate::auth_routes::UserRow, crate::auth_routes::TeamRow), ApiError> {
    crate::auth_routes::current_workspace(state, headers)
        .await
        .map_err(ApiError::from_auth)
}

async fn auth_deployment(
    state: &AppState,
    headers: &HeaderMap,
    dep_uuid: &str,
) -> Result<(crate::auth_routes::UserRow, crate::auth_routes::TeamRow, Deployment), ApiError> {
    let (user, workspace) = require_auth(state, headers).await?;
    let dep = sqlx::query_as::<_, Deployment>(
        r#"SELECT d.* FROM deployments d
           JOIN projects p ON p.id = d.project_id
           WHERE d.uuid = ? AND p.workspace_uuid = ?"#,
    )
    .bind(dep_uuid)
    .bind(&workspace.uuid)
    .fetch_optional(&state.pool)
    .await
    .map_err(ApiError::from)?
    .ok_or_else(|| ApiError::not_found("deployment"))?;
    Ok((user, workspace, dep))
}

/// Statut réel : basé sur le dernier déploiement, pas sur le flag « ready » à la création.
async fn resolve_project_status(state: &AppState, project: &Project) -> Result<String, ApiError> {
    let latest: Option<(String,)> = sqlx::query_as(
        "SELECT status FROM deployments WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(project.id)
    .fetch_optional(&state.pool)
    .await
    .map_err(ApiError::from)?;

    let derived = match latest.as_ref().map(|(s,)| s.as_str()) {
        Some("running") | Some("queued") | Some("building") => "deploying",
        Some("failed") | Some("error") => "failed",
        Some("ready") | Some("success") | Some("completed") | Some("live") => "live",
        None => {
            if project.status == "ready" || project.status == "live" {
                "draft"
            } else if project.status.is_empty() {
                "draft"
            } else {
                project.status.as_str()
            }
        }
        Some(_) => project.status.as_str(),
    }
    .to_string();

    if derived != project.status
        && matches!(
            derived.as_str(),
            "draft" | "live" | "failed" | "deploying" | "stopped"
        )
    {
        let _ = sqlx::query("UPDATE projects SET status = ? WHERE id = ?")
            .bind(&derived)
            .bind(project.id)
            .execute(&state.pool)
            .await;
    }

    Ok(derived)
}

async fn list_templates() -> Json<Value> {
    Json(json!({
        "data": [
            {
                "id": "astro-preact-sqlite",
                "name": "Astro + Preact + DaisyUI + SQLite",
                "description": "Application Astro SSR avec Preact, Tailwind CSS, DaisyUI et base SQLite locale",
                "stack": ["Astro", "Preact", "Tailwind CSS", "DaisyUI", "SQLite"]
            }
        ]
    }))
}

fn apply_template(template_id: &str, dest_dir: &str) -> Result<(), Box<dyn std::error::Error>> {
    // Résolution runtime du répertoire templates
    let templates_root = if let Ok(env_dir) = std::env::var("DEVFORGE_TEMPLATES_DIR") {
        // Production: env var définie dans Dockerfile
        FsPath::new(&env_dir).to_path_buf()
    } else {
        // Dev local: fallback relatif au CARGO_MANIFEST_DIR
        FsPath::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../crates/templates")
    };
    
    let template_base = templates_root.join(template_id);
    
    if !template_base.exists() {
        return Err(format!("Template {} not found at {:?}", template_id, template_base).into());
    }
    
    let dest_path = FsPath::new(dest_dir);
    fs::create_dir_all(dest_path)?;
    
    copy_dir_recursive(&template_base, dest_path)?;
    
    Ok(())
}

fn copy_dir_recursive(src: &FsPath, dst: &FsPath) -> Result<(), Box<dyn std::error::Error>> {
    if !dst.exists() {
        fs::create_dir_all(dst)?;
    }
    
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let file_name = entry.file_name();
        let dest_path = dst.join(&file_name);
        
        if path.is_dir() {
            copy_dir_recursive(&path, &dest_path)?;
        } else {
            fs::copy(&path, &dest_path)?;
        }
    }
    
    Ok(())
}

fn slugify(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn fqdn_from_url(url: &str) -> Option<String> {
    url.strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .map(|s| s.split('/').next().unwrap_or(s).trim().to_lowercase())
        .filter(|s| s.contains('.'))
}

async fn wildcard_domain(state: &AppState) -> Result<String, ApiError> {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT wildcard_domain FROM instance_settings WHERE id = 1")
            .fetch_optional(&state.pool)
            .await
            .map_err(ApiError::from)?;
    Ok(row
        .map(|(d,)| d.trim().trim_start_matches('.').to_lowercase())
        .unwrap_or_default())
}

pub(crate) async fn ensure_project_primary_domain(
    state: &AppState,
    project_uuid: &str,
    production_url: &str,
    port: u16,
) -> Result<(), ApiError> {
    let Some(fqdn) = fqdn_from_url(production_url) else {
        return Ok(());
    };
    let existing = state
        .domains
        .list(project_uuid)
        .await
        .ok()
        .and_then(|v| {
            v.get("domains")
                .and_then(|d| d.as_array())
                .map(|arr| {
                    arr.iter().any(|d| {
                        d.get("fqdn")
                            .and_then(|f| f.as_str())
                            .map(|f| f.eq_ignore_ascii_case(&fqdn))
                            .unwrap_or(false)
                    })
                })
        })
        .unwrap_or(false);
    if !existing {
        let _ = state.domains.attach(project_uuid, &fqdn, true).await;
    }
    // Primary + tous les alias : chaque domaine du projet doit avoir une route Traefik.
    ensure_all_domain_proxy_routes(state, project_uuid, &fqdn, port.max(1)).await;
    if let Ok(project) = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE uuid = ?")
        .bind(project_uuid)
        .fetch_one(&state.pool)
        .await
    {
        crate::sso::sync_project_proxy(state, &project).await;
    } else {
        let _ = state.proxy.sync(project_uuid).await;
    }
    Ok(())
}

fn proxy_route_id(project_uuid: &str, fqdn: &str, is_primary: bool) -> String {
    if is_primary {
        format!("primary-{project_uuid}")
    } else {
        format!(
            "alias-{}-{}",
            &project_uuid[..8.min(project_uuid.len())],
            fqdn.replace('.', "-")
        )
    }
}

/// Assure une route proxy Traefik pour **chaque** domaine du projet (primary + alias).
pub(crate) async fn ensure_all_domain_proxy_routes(
    state: &AppState,
    project_uuid: &str,
    primary_fqdn: &str,
    port: u16,
) {
    let port = port.max(1);
    let mut hosts: Vec<(String, bool)> = Vec::new();
    let primary = primary_fqdn.trim().to_lowercase();
    if !primary.is_empty() && primary.contains('.') {
        hosts.push((primary.clone(), true));
    }

    if let Ok(listed) = state.domains.list(project_uuid).await {
        if let Some(arr) = listed.get("domains").and_then(|d| d.as_array()) {
            for d in arr {
                let Some(fqdn) = d.get("fqdn").and_then(|f| f.as_str()) else {
                    continue;
                };
                let fqdn = fqdn.to_lowercase();
                if fqdn.is_empty() || !fqdn.contains('.') {
                    continue;
                }
                if hosts.iter().any(|(h, _)| h == &fqdn) {
                    continue;
                }
                let is_primary = !primary.is_empty() && fqdn == primary;
                hosts.push((fqdn, is_primary));
            }
        }
    }

    // Retirer les routes orphelines (host plus dans la liste domaines)
    if let Ok(existing) = state.proxy.list(project_uuid).await {
        if let Some(arr) = existing.get("routes").and_then(|r| r.as_array()) {
            for r in arr {
                let Some(host) = r.get("host").and_then(|h| h.as_str()) else {
                    continue;
                };
                let Some(id) = r.get("id").and_then(|i| i.as_str()) else {
                    continue;
                };
                if !hosts
                    .iter()
                    .any(|(h, _)| h.eq_ignore_ascii_case(host))
                {
                    let _ = state.proxy.delete(project_uuid, id).await;
                }
            }
        }
    }

    for (fqdn, is_primary) in hosts {
        let _ = state
            .proxy
            .upsert(devforge_proxy::ProxyRoute {
                id: proxy_route_id(project_uuid, &fqdn, is_primary),
                project_uuid: project_uuid.into(),
                host: fqdn,
                path_prefix: "/".into(),
                target_port: port,
                https_redirect: true,
            })
            .await;
    }
}

/// Labels Traefik pour le deploy (`docker run`), couvrant tous les hosts proxy.
pub(crate) async fn proxy_labels_for_project(
    state: &AppState,
    project: &Project,
) -> Option<serde_json::Value> {
    let uuid = &project.uuid;
    let port = project.port.clamp(1, 65535) as u16;
    if let Some(url) = project.production_url.as_deref().and_then(fqdn_from_url) {
        ensure_all_domain_proxy_routes(state, uuid, &url, port).await;
    }
    let listed = state.proxy.list(uuid).await.ok()?;
    let routes = listed.get("routes")?.as_array()?;
    if routes.is_empty() {
        return None;
    }
    let settings = crate::sso::load_sso_settings(&state.pool).await;
    let fwd = if crate::sso::should_protect_project(&settings, project) {
        settings.effective_forward_auth_address()
    } else {
        None
    };
    let mut map = serde_json::Map::new();
    map.insert("traefik.enable".into(), serde_json::json!("true"));
    for r in routes {
        let Some(host) = r.get("host").and_then(|h| h.as_str()) else {
            continue;
        };
        let path = r
            .get("path_prefix")
            .and_then(|p| p.as_str())
            .unwrap_or("/");
        let target = r
            .get("target_port")
            .and_then(|p| p.as_u64())
            .unwrap_or(port as u64) as u16;
        let piece = devforge_deploy::docker::traefik_labels(
            uuid,
            host,
            path,
            target.max(1),
            fwd.as_deref(),
        );
        if let Some(obj) = piece.as_object() {
            for (k, v) in obj {
                if k == "traefik.enable" {
                    continue;
                }
                map.insert(k.clone(), v.clone());
            }
        }
    }
    Some(serde_json::Value::Object(map))
}

pub(crate) async fn ensure_production_url(
    state: &AppState,
    project: &Project,
) -> Result<Option<String>, ApiError> {
    if let Some(ref url) = project.production_url {
        if !url.trim().is_empty() {
            return Ok(Some(url.clone()));
        }
    }
    let domain = wildcard_domain(state).await?;
    if domain.is_empty() {
        return Ok(None);
    }
    let host = slugify(&project.name);
    if host.is_empty() {
        return Ok(None);
    }
    let url = format!("https://{host}.{domain}");
    let now = now_str();
    sqlx::query("UPDATE projects SET production_url = ?, updated_at = ? WHERE id = ?")
        .bind(&url)
        .bind(&now)
        .bind(project.id)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;
    Ok(Some(url))
}

pub struct ApiError {
    pub status: axum::http::StatusCode,
    pub message: String,
}

impl ApiError {
    pub fn from(e: sqlx::Error) -> Self {
        Self {
            status: axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            message: e.to_string(),
        }
    }
    pub fn not_found(what: &str) -> Self {
        Self {
            status: axum::http::StatusCode::NOT_FOUND,
            message: format!("{what} not found"),
        }
    }
    pub fn message(msg: impl Into<String>) -> Self {
        Self {
            status: axum::http::StatusCode::BAD_REQUEST,
            message: msg.into(),
        }
    }
    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self {
            status: axum::http::StatusCode::FORBIDDEN,
            message: msg.into(),
        }
    }
    pub fn from_auth((status, Json(v)): (axum::http::StatusCode, Json<Value>)) -> Self {
        Self {
            status,
            message: v
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("unauthorized")
                .to_string(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        (
            self.status,
            Json(json!({"ok": false, "error": self.message})),
        )
            .into_response()
    }
}
