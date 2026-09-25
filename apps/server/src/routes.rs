use axum::{
    extract::{Path, Query, State},
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
use std::fs;
use std::path::Path as FsPath;
use std::{convert::Infallible, time::Duration};

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
            get(get_project)
                .patch(update_project)
                .delete(delete_project),
        )
        .route(
            "/api/v1/projects/{uuid}/rules",
            get(get_project_rules).put(update_project_rules),
        )
        .route(
            "/api/v1/projects/{uuid}/deployments",
            get(list_deployments).post(create_deployment),
        )
        .route("/api/v1/projects/{uuid}/trace", get(project_trace))
        .route("/api/v1/deployments/{uuid}", get(get_deployment))
        .route("/api/v1/deployments/{uuid}/logs", get(deployment_logs))
        .route(
            "/api/v1/deployments/{uuid}/request-repair",
            post(request_repair),
        )
        .route(
            "/api/v1/deployments/{uuid}/cancel",
            post(cancel_deployment),
        )
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
        .route("/api/v1/projects/{uuid}/env/import", post(import_env))
        .route(
            "/api/v1/projects/{uuid}/env/sync-workdir",
            post(sync_env_from_workdir),
        )
        .route(
            "/api/v1/projects/{uuid}/env/{key}",
            get(get_env).delete(delete_env),
        )
}

async fn health(State(state): State<AppState>, headers: HeaderMap) -> Json<Value> {
    let is_admin = crate::auth_routes::current_workspace(&state, &headers)
        .await
        .ok()
        .is_some_and(|(user, _)| user.role == "instance_admin");
    // `node_id` : permet à un leader intérimaire de savoir qui sert le hostname public.
    let node_id = state
        .cluster
        .local()
        .await
        .map(|l| l.node_id)
        .unwrap_or_default();
    if !is_admin {
        return Json(json!({
            "ok": true,
            "service": "devforge-server",
            "version": state.updater.current_version(),
            "node_id": node_id,
        }));
    }
    let cluster = state.cluster.summary().await.ok();
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
            "cluster": {
                "role": cluster.as_ref().map(|s| s.role),
                "nodes": cluster.as_ref().map(|s| s.nodes).unwrap_or(0),
                "online": cluster.as_ref().map(|s| s.online).unwrap_or(0),
            },
            "docker": devforge_deploy::docker::probe_engine(),
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
        "SELECT * FROM projects WHERE workspace_uuid = $1 ORDER BY updated_at DESC",
    )
    .bind(&workspace.uuid)
    .fetch_all(&state.pool)
    .await
    .map_err(ApiError::from)?;

    let mut out = Vec::with_capacity(rows.len());
    for p in &mut rows {
        // Liste : Postgres seul (pas de probe HTTP/Docker ni compare GitHub).
        p.status = resolve_project_status_db(&state, p).await?;
        let card = project_list_card(&state, p, false).await;
        out.push(card);
    }

    Ok(Json(json!({"data": out})))
}

async fn project_list_card(state: &AppState, project: &Project, github_sync: bool) -> Value {
    let latest: Option<(String, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT status, git_sha, git_message FROM deployments WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1",
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
            } else if github_sync {
                let gh = project_github(state, &project.workspace_uuid).await;
                if gh.mode() == "off" {
                    sync = json!({
                        "state": "unknown",
                        "behind_by": 0,
                        "deployed_sha": dep_sha,
                        "head_sha": null,
                    });
                } else {
                    match gh.compare(&owner, &repo, &dep_sha, branch).await {
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
                            let tip = gh.list_branches(&owner, &repo).await.ok().and_then(|bs| {
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
            } else {
                // Lecture Postgres seule : sync GitHub via GET /git ou ?live=1
                sync = json!({
                    "state": "unknown",
                    "behind_by": 0,
                    "deployed_sha": dep_sha,
                    "head_sha": null,
                });
            }
        }
    }

    let mut card = json!({
        "uuid": project.uuid,
        "name": project.name,
        "slug": project.slug,
        "status": project.status,
        "git_repository": project.git_repository,
        "git_branch": project.git_branch,
        "build_pack": project.build_pack,
        "port": project.port,
        "production_url": project.production_url,
        "auto_deploy": project.auto_deploy != 0,
        "updated_at": project.updated_at,
        "deploy": {
            "status": if dep_status.is_empty() { Value::Null } else { json!(dep_status) },
            "sha": if dep_sha.is_empty() { Value::Null } else { json!(dep_sha) },
            "message": if dep_message.is_empty() { Value::Null } else { json!(dep_message) },
        },
        "sync": sync,
    });
    if let Some(obj) = card.as_object_mut() {
        let membership = crate::group_routes::membership(&state.pool, &project.uuid).await;
        crate::group_routes::write_group_fields(obj, membership.as_ref());
    }
    card
}

fn empty_to_none(v: Option<String>) -> Option<String> {
    v.and_then(|s| {
        let t = s.trim().to_string();
        if t.is_empty() { None } else { Some(t) }
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
    let (user, workspace) = crate::auth_routes::current_workspace(&state, &headers)
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
    let slug = format!("{}-{}", slugify(&body.name), &uuid.replace('-', "")[..4]);
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
    let base_directory = body.base_directory.unwrap_or_else(|| "/".into());
    let app_host = slugify(&body.name);
    let production_url = if let Some(url) = body.production_url {
        Some(url)
    } else {
        // Derive from instance wildcard: {app}.{wildcard}
        let d = crate::user_prefs::effective_wildcard_for_user(&state.pool, &user.uuid).await;
        let domain = if d.is_empty() { None } else { Some(d) };
        domain.and_then(|d| {
            if d.is_empty() || app_host.is_empty() {
                None
            } else {
                Some(format!("https://{app_host}.{d}"))
            }
        })
    };

    let requested_server = if user.role == "instance_admin" {
        body.server_id.as_deref()
    } else {
        None
    };
    let server_id = crate::cluster_routes::resolve_server_id(&state, requested_server).await;

    sqlx::query(
        r#"INSERT INTO projects (
            uuid, name, slug, status, git_repository, git_branch,
            server_id, workdir, test_command, production_url, workspace_uuid,
            build_pack, port, is_static, publish_directory, base_directory, docker_compose_location,
            created_at, updated_at
        ) VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)"#,
    )
    .bind(&uuid)
    .bind(&body.name)
    .bind(&slug)
    .bind(&body.git_repository)
    .bind(body.git_branch.clone().unwrap_or_else(|| "main".into()))
    .bind(&server_id)
    .bind(body.workdir.unwrap_or_else(|| {
        // UUID isolé : évite collision / leftover `.env` entre projets au même nom.
        format!("/data/devforge/applications/{uuid}")
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
            let token = crate::user_prefs::github_token(&state.pool, &user.uuid).await;
            let gh = AppState::github_from_token(&token);
            if let Ok(detection) =
                crate::detect_svc::detect_github_repo(&gh, &owner, &repo, Some(branch)).await
            {
                let now2 = now_str();
                let _ = sqlx::query(
                    r#"UPDATE projects SET
                        build_pack = $1, port = $2, is_static = $3, publish_directory = $4,
                        base_directory = $5, docker_compose_location = $6,
                        test_command = COALESCE($7, test_command), updated_at = $8
                       WHERE uuid = $9"#,
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
                    let _ = ensure_project_primary_domain(&state, &uuid, url, detection.port).await;
                }
            }
        }
    }

    let project = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE uuid = $1")
        .bind(&uuid)
        .fetch_one(&state.pool)
        .await
        .map_err(ApiError::from)?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({"data": project})),
    ))
}

#[derive(Deserialize)]
pub struct ScaffoldProject {
    pub title: String,
    pub prompt: String,
    pub template: Option<String>,
    pub server_id: Option<String>,
}

async fn scaffold_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ScaffoldProject>,
) -> Result<(axum::http::StatusCode, Json<Value>), ApiError> {
    let (user, workspace) = crate::auth_routes::current_workspace(&state, &headers)
        .await
        .map_err(|(status, Json(v))| ApiError {
            status,
            message: v
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("auth")
                .to_string(),
        })?;
    let (_workspace_beta, agent_builder) = crate::auth_routes::load_beta_features(&state).await;
    if !agent_builder {
        return Err(ApiError::forbidden(
            "La création d’application par agent est désactivée",
        ));
    }

    let uuid = new_uuid();
    let slug = format!("{}-{}", slugify(&body.title), &uuid.replace('-', "")[..4]);
    let now = now_str();

    let requested_server = if user.role == "instance_admin" {
        body.server_id.as_deref()
    } else {
        None
    };
    let server_id = crate::cluster_routes::resolve_server_id(&state, requested_server).await;

    // Create minimal project
    sqlx::query(
        r#"INSERT INTO projects (
            uuid, name, slug, status, git_repository, git_branch,
            server_id, workdir, test_command, production_url, workspace_uuid,
            build_pack, port, is_static, publish_directory, base_directory, docker_compose_location,
            created_at, updated_at
        ) VALUES ($1, $2, $3, 'draft', '', 'main', $4, $5, '', '', $6, 'nixpacks', 3000, 0, '', '/', '', $7, $8)"#,
    )
    .bind(&uuid)
    .bind(&body.title)
    .bind(&slug)
    .bind(server_id)
    .bind(&format!("/data/devforge/applications/{uuid}"))
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
        "SELECT uuid FROM project_agents WHERE project_uuid = $1 AND role = 'deploy' LIMIT 1",
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
            ) VALUES ($1, $2, 'Builder', 'deploy', 'custom', NULL, 'idle', $3, $4)"#,
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
    let template_applied = if let Err(e) = apply_template(
        template_name,
        &format!("/data/devforge/applications/{uuid}"),
    ) {
        eprintln!(
            "[scaffold] Erreur lors de l'application du template {} : {}",
            template_name, e
        );
        false
    } else {
        true
    };

    let seed_content = if template_applied {
        format!(
            "Nouveau projet DevForge : {}\n\nObjectif :\n{}\n\n✅ Template {} déjà appliqué (Astro + Preact + Tailwind + DaisyUI + SQLite).\nLa connexion Pocket ID est déjà dans le template (`/api/auth/login`, callback `/api/auth/callback/pocket-id`). Ne supprime pas ces routes : un compte Pocket ID doit pouvoir entrer dans l'app.\n\n🎯 TON RÔLE : Prépare une preview atelier testable.\n\n🚨 WORKFLOW OBLIGATOIRE :\n1. Le template est déjà dans le workdir — NE réécris PAS les fichiers de base\n2. Customisations : write_project_file mode='local'\n3. Appelle TOUJOURS start_local_preview (outil) pour exposer https://dev-…. Ne lance PAS npm à la main.\n\n❌ INTERDIT (l'utilisateur n'a PAS encore validé) :\n- create_github_repo / sync_workdir_to_github / trigger_deploy\n\n✅ APRÈS validation utilisateur : publication GitHub + deploy via le bouton Publier.",
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
        ) VALUES ($1, $2, $3, 'user', $4, '[]', 'system', $5)"#,
    )
    .bind(&msg_uuid)
    .bind(&uuid)
    .bind(&agent_uuid)
    .bind(&seed_content)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(ApiError::from)?;

    let project = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE uuid = $1")
        .bind(&uuid)
        .fetch_one(&state.pool)
        .await
        .map_err(ApiError::from)?;

    if let Err(e) = attach_project_sqlite(&state, &project).await {
        eprintln!("[scaffold] SQLite projet : {e}");
    }

    // Return agent info as simple JSON value
    let agent_info = serde_json::json!({
        "uuid": agent_uuid,
        "project_uuid": uuid,
        "role": "deploy"
    });

    // Preview atelier : démarre en arrière-plan (workdir déjà scaffoldé).
    // L’utilisateur n’a pas à demander à l’agent de le faire.
    {
        let registry = state.registry.clone();
        let project_uuid = uuid.clone();
        tokio::spawn(async move {
            let _ = registry
                .execute(
                    "start_local_preview",
                    json!({ "project_uuid": project_uuid }),
                )
                .await;
        });
    }

    // Le prompt est déjà en base : le tour part tout de suite (fichiers locaux + preview).
    sqlx::query("UPDATE project_agents SET status = 'working', updated_at = $1 WHERE uuid = $2")
        .bind(&now)
        .bind(&agent_uuid)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;
    {
        let state_clone = state.clone();
        let project_uuid = uuid.clone();
        let agent_uuid_clone = agent_uuid.clone();
        tokio::spawn(async move {
            if let Err(e) = trigger_agent_turn(&state_clone, &project_uuid, &agent_uuid_clone).await
            {
                eprintln!("[scaffold] tour agent : {e}");
                let now = now_str();
                let _ = sqlx::query(
                    "UPDATE project_agents SET status = 'idle', updated_at = $1 WHERE uuid = $2 AND status = 'working'",
                )
                .bind(&now)
                .bind(&agent_uuid_clone)
                .execute(&state_clone.pool)
                .await;
            }
        });
    }

    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({ "data": { "project": project, "agent": agent_info } })),
    ))
}

#[derive(Deserialize, Default)]
struct GetProjectQuery {
    /// Si true : probe HTTP/Docker + compare GitHub (lent). Défaut : Postgres seul.
    #[serde(default)]
    live: bool,
}

async fn get_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Query(q): Query<GetProjectQuery>,
) -> Result<Json<Value>, ApiError> {
    let (_user, _ws, mut project) = auth_project(&state, &headers, &uuid).await?;
    project.status = if q.live {
        resolve_project_status_live(&state, &project).await?
    } else {
        resolve_project_status_db(&state, &project).await?
    };
    // Logs historiques omis (volumineux) ; en cours inclus pour le poll live.
    let deployments = sqlx::query_as::<_, Deployment>(
        r#"SELECT id, uuid, project_id, status, git_sha, git_message,
                  CASE
                    WHEN status IN ('queued', 'running', 'building', 'pending', 'deploying') THEN logs
                    ELSE NULL
                  END AS logs,
                  error_summary, error_hint, live_revision_sha,
                  finished_at, created_at, updated_at
           FROM deployments WHERE project_id = $1 ORDER BY created_at DESC LIMIT 10"#,
    )
    .bind(project.id)
    .fetch_all(&state.pool)
    .await
    .map_err(ApiError::from)?;

    // Sync GitHub uniquement si ?live=1 ; sinon placeholder Postgres (rafraîchi via /git).
    let card = project_list_card(&state, &project, q.live).await;
    let mut project_json = serde_json::to_value(&project).unwrap_or_else(|_| json!({}));
    if let Some(obj) = project_json.as_object_mut() {
        if let Some(sync) = card.get("sync") {
            obj.insert("sync".into(), sync.clone());
        }
        if let Some(deploy) = card.get("deploy") {
            obj.insert("deploy".into(), deploy.clone());
        }
        let membership = crate::group_routes::membership(&state.pool, &project.uuid).await;
        crate::group_routes::write_group_fields(obj, membership.as_ref());
    }

    Ok(Json(
        json!({"data": {"project": project_json, "deployments": deployments}}),
    ))
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
    /// Zone de cette app. Chaîne vide = hériter du groupe, puis du domaine principal.
    pub domain_apex: Option<String>,
    pub build_pack: Option<String>,
    pub port: Option<u16>,
    pub is_static: Option<bool>,
    /// `auto` (hérite) | `on` | `off`
    pub sso_protection: Option<String>,
    pub has_own_user_system: Option<bool>,
    pub publish_directory: Option<String>,
    pub base_directory: Option<String>,
    pub docker_compose_location: Option<String>,
    pub dockerfile_path: Option<String>,
    pub docker_build_context: Option<String>,
    pub auto_deploy: Option<bool>,
    pub gpu_nvidia: Option<bool>,
    pub gpu_dri: Option<bool>,
    /// Remplace la liste. `source:cible` ou `source:cible:ro`.
    pub volumes: Option<Vec<String>>,
    pub runtime: Option<devforge_deploy::RuntimeSpec>,
}

async fn update_project(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<UpdateProject>,
) -> Result<Json<Value>, ApiError> {
    let (user, _ws, existing) = auth_project(&state, &headers, &uuid).await?;
    let previous_production_url = existing.production_url.clone();
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

    let auto_deploy = body
        .auto_deploy
        .map(|v| if v { 1i64 } else { 0 })
        .unwrap_or(existing.auto_deploy);
    let gpu_nvidia = body
        .gpu_nvidia
        .map(|v| if v { 1i64 } else { 0 })
        .unwrap_or(existing.gpu_nvidia);
    let gpu_dri = body
        .gpu_dri
        .map(|v| if v { 1i64 } else { 0 })
        .unwrap_or(existing.gpu_dri);
    let volumes_json = match &body.volumes {
        Some(volumes) => serde_json::to_string(
            &devforge_deploy::docker::normalize_volume_mounts(volumes)
                .map_err(ApiError::message)?,
        )
        .unwrap_or_else(|_| "[]".into()),
        None => existing.volumes_json.clone(),
    };
    let runtime_json = match body.runtime {
        Some(mut spec) => {
            spec.normalize().map_err(ApiError::message)?;
            serde_json::to_string(&spec).unwrap_or_else(|_| "{}".into())
        }
        None => existing.runtime_json.clone(),
    };

    let domain_apex = match &body.domain_apex {
        Some(raw) if raw.trim().is_empty() => String::new(),
        Some(raw) => {
            let apex = crate::domain_catalog::normalize_apex(raw).map_err(ApiError::message)?;
            if !crate::domain_catalog::contains(&state.pool, &apex).await {
                return Err(ApiError::message(
                    "ajoute d'abord ce domaine dans les domaines de l'instance",
                ));
            }
            apex
        }
        None => existing.domain_apex.clone(),
    };
    let slug = if existing.slug.trim().is_empty() {
        slugify(&body.name.clone().unwrap_or(existing.name.clone()))
    } else {
        existing.slug.clone()
    };
    let production_url = if body
        .domain_apex
        .as_ref()
        .is_some_and(|v| !v.trim().is_empty())
    {
        let current = body
            .production_url
            .clone()
            .or(existing.production_url.clone())
            .unwrap_or_default();
        Some(crate::domain_catalog::url_for_zone(
            &current,
            &slug,
            &domain_apex,
        ))
    } else {
        body.production_url
            .clone()
            .or(existing.production_url.clone())
    };

    let next_server = if user.role == "instance_admin" {
        body.server_id.clone().or(existing.server_id.clone())
    } else {
        existing.server_id.clone()
    };
    let norm = |id: &Option<String>| {
        id.as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("default")
            .to_string()
    };
    if norm(&next_server) != norm(&existing.server_id) {
        crate::group_routes::ensure_same_node(&state.pool, &uuid, next_server.as_deref()).await?;
    }

    sqlx::query(
        r#"UPDATE projects SET
            name = $1, status = $2, git_repository = $3, git_branch = $4,
            server_id = $5, workdir = $6, test_command = $7, production_url = $8,
            build_pack = $9, port = $10, is_static = $11, publish_directory = $12,
            base_directory = $13, docker_compose_location = $14,
            dockerfile_path = $15, docker_build_context = $16,
            is_sso_protected = $17, has_own_user_system = $18, auto_deploy = $19,
            gpu_nvidia = $20, gpu_dri = $21, volumes_json = $22, runtime_json = $23,
            domain_apex = $24, updated_at = $25
        WHERE uuid = $26"#,
    )
    .bind(body.name.unwrap_or(existing.name))
    .bind(body.status.unwrap_or(existing.status))
    .bind(body.git_repository.or(existing.git_repository))
    .bind(body.git_branch.or(existing.git_branch))
    .bind(next_server)
    .bind(body.workdir.or(existing.workdir))
    .bind(body.test_command.or(existing.test_command))
    .bind(production_url)
    .bind(body.build_pack.unwrap_or(existing.build_pack))
    .bind(port)
    .bind(is_static)
    .bind(body.publish_directory.or(existing.publish_directory))
    .bind(body.base_directory.unwrap_or(existing.base_directory))
    .bind(
        body.docker_compose_location
            .or(existing.docker_compose_location),
    )
    .bind(empty_to_none(body.dockerfile_path.or(existing.dockerfile_path)))
    .bind(empty_to_none(body.docker_build_context.or(existing.docker_build_context)))
    .bind(is_sso_protected)
    .bind(has_own_user_system)
    .bind(auto_deploy)
    .bind(gpu_nvidia)
    .bind(gpu_dri)
    .bind(&volumes_json)
    .bind(&runtime_json)
    .bind(&domain_apex)
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
    let url_changed = previous_production_url != project.production_url;
    match crate::project_oidc::sync_project_oidc_client(&state.pool, &project, url_changed).await {
        Ok(true) => tracing::info!(project = %project.uuid, "client OIDC Pocket ID synchronisé"),
        Ok(false) => {}
        Err(e) => tracing::warn!(project = %project.uuid, error = %e, "sync client OIDC Pocket ID"),
    }
    let _ = crate::sso::ensure_oidc_env(&state.pool, &project).await;

    // Quand auto-deploy s'active (ou reste on), tenter d'enregistrer le webhook GitHub.
    if project.auto_deploy != 0 {
        let state_wh = state.clone();
        let project_wh = project.clone();
        tokio::spawn(async move {
            let _ = crate::auto_deploy::ensure_project_webhook(&state_wh, &project_wh).await;
        });
    }

    let mut data = serde_json::to_value(&project).unwrap_or_else(|_| json!({}));
    if let Some(obj) = data.as_object_mut() {
        let membership = crate::group_routes::membership(&state.pool, &project.uuid).await;
        crate::group_routes::write_group_fields(obj, membership.as_ref());
    }
    Ok(Json(json!({"data": data})))
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
        server_id: project
            .server_id
            .clone()
            .unwrap_or_else(|| "default".into()),
        workdir: project.workdir.clone().unwrap_or_default(),
        test_command: String::new(),
        timeout: None,
    };
    let _ = state.deploy.stop(&ctx).await;

    sqlx::query("DELETE FROM project_env_vars WHERE project_uuid = $1")
        .bind(&uuid)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;
    sqlx::query("DELETE FROM project_agents WHERE project_uuid = $1")
        .bind(&uuid)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;
    sqlx::query("DELETE FROM project_ports WHERE project_uuid = $1")
        .bind(&uuid)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;
    sqlx::query("DELETE FROM project_domains WHERE project_uuid = $1")
        .bind(&uuid)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;
    sqlx::query("DELETE FROM project_proxy_routes WHERE project_uuid = $1")
        .bind(&uuid)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;

    // Purge le `.env` workdir pour éviter qu’un futur projet hérite des secrets.
    if let Some(raw) = project
        .workdir
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let workdir = devforge_deploy::resolve_project_workdir(raw, &project.uuid);
        let env_path = std::path::Path::new(&workdir).join(".env");
        let _ = fs::remove_file(&env_path);
    }

    // deployments cascade via FK on project_id
    let res = sqlx::query("DELETE FROM projects WHERE uuid = $1 AND workspace_uuid = $2")
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

fn default_project_rules_template(project_name: &str) -> String {
    format!(
        r#"# Directives Projet & Agent — {project_name}

## Development

When starting the dev server, use background mode:

```bash
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Architecture & Framework
- Front : Astro + Preact
- Styles : Tailwind CSS
- Always test changes locally via local preview before committing or opening a PR.

## Documentation & References
Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:
- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
"#
    )
}

fn resolve_project_agents_md_path(project: &Project) -> Option<std::path::PathBuf> {
    let raw_workdir = project.workdir.as_deref().unwrap_or("").trim();
    if raw_workdir.is_empty() {
        return None;
    }
    let workdir = devforge_deploy::resolve_project_workdir(raw_workdir, &project.uuid);
    let path = std::path::Path::new(&workdir).join("AGENTS.md");
    Some(path)
}

/// GET /api/v1/projects/{uuid}/rules
/// Retourne le contenu de AGENTS.md du projet ou le template par défaut s'il n'existe pas encore.
async fn get_project_rules(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (_user, _ws, project) = auth_project(&state, &headers, &uuid).await?;

    let path_opt = resolve_project_agents_md_path(&project);
    let (content, exists) = match path_opt {
        Some(ref p) if p.is_file() => {
            let s = fs::read_to_string(p)
                .unwrap_or_else(|_| default_project_rules_template(&project.name));
            (s, true)
        }
        _ => (default_project_rules_template(&project.name), false),
    };

    Ok(Json(json!({
        "data": {
            "project_uuid": project.uuid,
            "rules": content,
            "exists": exists,
            "file": "AGENTS.md"
        }
    })))
}

#[derive(Deserialize)]
pub struct UpdateRulesBody {
    pub rules: String,
}

/// PUT /api/v1/projects/{uuid}/rules
/// Enregistre le contenu de AGENTS.md directement dans le workdir du projet.
async fn update_project_rules(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<UpdateRulesBody>,
) -> Result<Json<Value>, ApiError> {
    let (_user, _ws, mut project) = auth_project(&state, &headers, &uuid).await?;

    let mut raw_workdir = project.workdir.as_deref().unwrap_or("").trim().to_string();
    if raw_workdir.is_empty() {
        raw_workdir = format!("/data/devforge/applications/{}", project.uuid);
        let _ = sqlx::query(
            "UPDATE projects SET workdir = $1, updated_at = to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE uuid = $2",
        )
        .bind(&raw_workdir)
        .bind(&project.uuid)
        .execute(&state.pool)
        .await;
        project.workdir = Some(raw_workdir.clone());
    }

    let workdir = devforge_deploy::resolve_project_workdir(&raw_workdir, &project.uuid);
    let workdir_path = std::path::Path::new(&workdir);
    if !workdir_path.exists() {
        fs::create_dir_all(workdir_path).map_err(|e| {
            ApiError::message(format!("Impossible de créer le workdir {workdir} : {e}"))
        })?;
    }

    let file_path = workdir_path.join("AGENTS.md");
    fs::write(&file_path, &body.rules)
        .map_err(|e| ApiError::message(format!("Impossible d'écrire AGENTS.md : {e}")))?;

    Ok(Json(json!({
        "ok": true,
        "message": "Directives AGENTS.md mises à jour avec succès",
        "data": {
            "project_uuid": project.uuid,
            "rules": body.rules,
            "exists": true,
            "file": "AGENTS.md"
        }
    })))
}

async fn list_deployments(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (_user, _ws, project) = auth_project(&state, &headers, &uuid).await?;
    // Logs seulement pour déploiements en cours ; historique via GET /deployments/{uuid}.
    let rows = sqlx::query_as::<_, Deployment>(
        r#"SELECT id, uuid, project_id, status, git_sha, git_message,
                  CASE
                    WHEN status IN ('queued', 'running', 'building', 'pending', 'deploying') THEN logs
                    ELSE NULL
                  END AS logs,
                  error_summary, error_hint, live_revision_sha,
                  finished_at, created_at, updated_at
           FROM deployments WHERE project_id = $1
           ORDER BY CASE
             WHEN status IN ('queued', 'running', 'building', 'pending', 'deploying') THEN 0
             ELSE 1
           END,
           created_at DESC
           LIMIT 50"#,
    )
    .bind(project.id)
    .fetch_all(&state.pool)
    .await
    .map_err(ApiError::from)?;
    Ok(Json(json!({"data": rows})))
}

async fn project_trace(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (_user, _ws, _project) = auth_project(&state, &headers, &uuid).await?;
    let rows: Vec<(i64, String, String, Option<String>, String, String)> = sqlx::query_as(
        r#"SELECT id, kind, status, ref_id, detail, created_at
           FROM builder_events WHERE project_uuid = $1 ORDER BY id DESC LIMIT 40"#,
    )
    .bind(&uuid)
    .fetch_all(&state.pool)
    .await
    .map_err(ApiError::from)?;
    let data: Vec<Value> = rows
        .into_iter()
        .map(|(id, kind, status, ref_id, detail, created_at)| {
            json!({
                "id": id,
                "kind": kind,
                "status": status,
                "ref_id": ref_id,
                "detail": detail,
                "created_at": created_at,
            })
        })
        .collect();
    Ok(Json(json!({"data": data})))
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
    let message = body.git_message.unwrap_or_else(|| "Manual deploy".into());

    // Mark queued first
    sqlx::query(
        r#"INSERT INTO deployments (
            uuid, project_id, status, git_sha, git_message, logs, finished_at, created_at, updated_at
        ) VALUES ($1, $2, 'queued', $3, $4, $5, NULL, $6, $7)"#,
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

    sqlx::query("UPDATE projects SET status = 'deploying', updated_at = $1 WHERE id = $2")
        .bind(&now)
        .bind(project.id)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;

    // Charger le SHA de la révision actuellement en production avant le deploy
    let live_revision_sha: Option<String> = sqlx::query_as(
        "SELECT git_sha FROM deployments WHERE project_id = $1 AND status = 'success' ORDER BY created_at DESC LIMIT 1",
    )
    .bind(project.id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten()
    .map(|(sha,)| sha);

    let outcome = run_real_deploy(&state, &project, &dep_uuid).await;
    let finished = now_str();
    let result = &outcome.result;
    let sha = result
        .git_sha
        .clone()
        .or(body.git_sha)
        .unwrap_or_else(|| "unknown".into());

    if outcome.cancelled {
        // Statut déjà `cancelled` via supersede (ou on le pose si self-abort).
        let _ = crate::deploy_queue::finalize_if_active(
            &state.pool,
            &dep_uuid,
            "cancelled",
            &sha,
            &result.logs,
            Some("Annulé : un déploiement plus récent a été lancé"),
            None,
            live_revision_sha.as_deref(),
        )
        .await;
        let dep = sqlx::query_as::<_, Deployment>("SELECT * FROM deployments WHERE uuid = $1")
            .bind(&dep_uuid)
            .fetch_one(&state.pool)
            .await
            .map_err(ApiError::from)?;
        return Ok((
            axum::http::StatusCode::OK,
            Json(json!({"data": dep, "ok": false, "cancelled": true})),
        ));
    }

    let status = if result.ok { "success" } else { "failed" };

    // Parse error if deploy failed
    let (error_summary, error_hint) = if !result.ok {
        let parsed = devforge_deploy::parse_deploy_error_fr(&result.logs);
        match parsed {
            Some(err) => (Some(err.summary), err.hint),
            None => (Some("Échec du déploiement".into()), None),
        }
    } else {
        (None, None)
    };

    let _ = crate::deploy_queue::finalize_if_active(
        &state.pool,
        &dep_uuid,
        status,
        &sha,
        &result.logs,
        error_summary.as_deref(),
        error_hint.as_deref(),
        live_revision_sha.as_deref(),
    )
    .await;

    let project_status = if result.ok { "live" } else { "failed" };
    sqlx::query("UPDATE projects SET status = $1, updated_at = $2 WHERE id = $3")
        .bind(project_status)
        .bind(&finished)
        .bind(project.id)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;

    let dep = sqlx::query_as::<_, Deployment>("SELECT * FROM deployments WHERE uuid = $1")
        .bind(&dep_uuid)
        .fetch_one(&state.pool)
        .await
        .map_err(ApiError::from)?;

    // CRITICAL: Ensure Traefik is running after every successful deploy (fix for recurring disappearance)
    if result.ok {
        if let Err(e) = state.proxy.ensure_traefik().await {
            tracing::error!(error = %e, project_uuid = %project.uuid, "Failed to ensure Traefik after deploy");
        } else {
            tracing::info!(project_uuid = %project.uuid, "Traefik verified after successful deploy");
        }
    }

    // Auto-repair on failure (default ON)
    if !result.ok {
        let auto_repair_enabled = std::env::var("DEVFORGE_AUTO_REPAIR")
            .ok()
            .and_then(|v| v.parse::<bool>().ok())
            .unwrap_or(true); // Default ON

        if auto_repair_enabled {
            // Trigger repair async (don't block response)
            let state_clone = state.clone();
            let dep_uuid_clone = dep_uuid.clone();
            tokio::spawn(async move {
                let _ = auto_trigger_repair(&state_clone, &dep_uuid_clone).await;
            });
        }
        // Wake coordinateur (fil permanent) — dédupliqué par uuid de déploiement
        {
            let state_clone = state.clone();
            let project_uuid = project.uuid.clone();
            let dep_uuid_clone = dep_uuid.clone();
            let summary = dep
                .error_summary
                .clone()
                .unwrap_or_else(|| "Échec du déploiement".into());
            let hint = dep.error_hint.clone().unwrap_or_default();
            tokio::spawn(async move {
                let _ = wake_coordinator_deploy_fail(
                    &state_clone,
                    &project_uuid,
                    &dep_uuid_clone,
                    &summary,
                    &hint,
                )
                .await;
            });
        }
    }

    Ok((
        if result.ok {
            axum::http::StatusCode::CREATED
        } else {
            axum::http::StatusCode::OK
        },
        Json(json!({"data": dep, "ok": result.ok})),
    ))
}

/// Résultat d'un run : succès/échec build, ou annulé (supersede).
#[derive(Debug, Clone)]
pub(crate) struct DeployRunOutcome {
    pub result: devforge_deploy::DeployResult,
    pub cancelled: bool,
}

impl DeployRunOutcome {
    pub fn ok(&self) -> bool {
        !self.cancelled && self.result.ok
    }
}

pub(crate) async fn run_real_deploy(
    state: &AppState,
    project: &Project,
    deployment_uuid: &str,
) -> DeployRunOutcome {
    {
        let _start = state.deploy_queue.lock_project_start(project.id).await;
        let _cancel_rx = state.deploy_queue.register_cancel(deployment_uuid).await;
        let superseded = crate::deploy_queue::supersede_in_progress(
            &state.deploy_queue,
            &state.pool,
            project.id,
            deployment_uuid,
        )
        .await;
        if !superseded.is_empty() {
            let server = project.server_id.as_deref().unwrap_or("default");
            state
                .deploy
                .abort_in_flight_swap(&project.uuid, server)
                .await;
        }
    }

    let token: Option<String> =
        sqlx::query_as::<_, (String,)>("SELECT github_token FROM instance_settings WHERE id = 1")
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten()
            .map(|(t,)| t)
            .filter(|t| !t.trim().is_empty());

    match crate::project_oidc::sync_project_oidc_client(&state.pool, project, true).await {
        Ok(true) => {
            tracing::info!(project = %project.uuid, "client OIDC Pocket ID synchronisé avant deploy")
        }
        Ok(false) => {}
        Err(e) => tracing::warn!(project = %project.uuid, error = %e, "sync client OIDC Pocket ID"),
    }
    let _ = crate::sso::ensure_oidc_env(&state.pool, project).await;

    let env_vars = state
        .env
        .list_public(&project.uuid)
        .await
        .ok()
        .unwrap_or_default();
    // Need raw values for .env — list from store via upsert path; use facade list that masks.
    // Fetch unmasked from SQLite directly for deploy.
    let env_file = load_env_file_content(&state.pool, &project.uuid).await;
    let (env_file, group_network, group_alias) =
        crate::group_routes::prepare_deploy_link(&state.pool, &project.uuid, env_file).await;

    let current = project
        .server_id
        .clone()
        .unwrap_or_else(|| "default".into());
    let server_id = crate::cluster_routes::ensure_live_server_id(state, &current).await;
    if server_id != crate::cluster_routes::normalize_server_id(&current) {
        let now = now_str();
        let _ = sqlx::query("UPDATE projects SET server_id = $1, updated_at = $2 WHERE uuid = $3")
            .bind(&server_id)
            .bind(&now)
            .bind(&project.uuid)
            .execute(&state.pool)
            .await;
        tracing::info!(
            project = %project.uuid,
            from = %current,
            to = %server_id,
            "placement : nœud réassigné avant deploy"
        );
    }

    let _ = env_vars; // public view unused
    let req = devforge_deploy::DeployRequest {
        project_uuid: project.uuid.clone(),
        server_id: server_id.clone(),
        workdir: project.workdir.clone().unwrap_or_default(),
        git_repository: project.git_repository.clone().unwrap_or_default(),
        git_branch: project.git_branch.clone().unwrap_or_else(|| "main".into()),
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
        dockerfile_path: project.dockerfile_path.clone(),
        docker_build_context: project.docker_build_context.clone(),
        publish_directory: project.publish_directory.clone(),
        is_static: project.is_static != 0,
        github_token: token,
        env_file,
        proxy_labels: proxy_labels_for_project(state, project).await,
        gpu_nvidia: project.gpu_nvidia != 0,
        gpu_dri: project.gpu_dri != 0,
        group_network,
        group_alias,
        volumes: devforge_deploy::docker::decode_volume_mounts(&project.volumes_json),
        runtime: devforge_deploy::RuntimeSpec::from_json(&project.runtime_json).unwrap_or_default(),
    };
    let deploy = state.deploy.clone();
    let slot_server = server_id.clone();
    let outcome = crate::deploy_queue::run_in_node_slot(
        &state.deploy_queue,
        &state.pool,
        &slot_server,
        deployment_uuid,
        move || {
            let deploy = deploy.clone();
            async move { deploy.deploy(&req).await }
        },
    )
    .await;
    state.deploy_queue.unregister_cancel(deployment_uuid).await;

    match outcome {
        crate::deploy_queue::SlotOutcome::Cancelled => {
            crate::deploy_queue::record_event(
                &state.pool,
                &project.uuid,
                "deploy",
                "cancelled",
                deployment_uuid,
                "superseded",
            )
            .await;
            // Best-effort cleanup if we were mid blue-green.
            state
                .deploy
                .abort_in_flight_swap(&project.uuid, &slot_server)
                .await;
            DeployRunOutcome {
                result: devforge_deploy::DeployResult {
                    ok: false,
                    git_sha: None,
                    logs: "[devforge] Déploiement annulé : remplacé par un déploiement plus récent\n".into(),
                },
                cancelled: true,
            }
        }
        crate::deploy_queue::SlotOutcome::Completed(result) => {
            crate::deploy_queue::record_event(
                &state.pool,
                &project.uuid,
                "deploy",
                if result.ok { "success" } else { "failed" },
                deployment_uuid,
                result.git_sha.as_deref().unwrap_or(""),
            )
            .await;
            if result.ok {
                crate::sso::sync_project_proxy(state, project).await;
                crate::dns::sync_project(state, &project.uuid).await;
            }
            DeployRunOutcome {
                result,
                cancelled: false,
            }
        }
    }
}

pub(crate) async fn load_env_file_content(
    pool: &sqlx::PgPool,
    project_uuid: &str,
) -> Option<String> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT key, value FROM project_env_vars WHERE project_uuid = $1 ORDER BY key",
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

/// Clone les env du projet vers `{workdir}/.env` (ou purge si vide).
pub(crate) async fn materialize_project_env_to_workdir(
    pool: &sqlx::PgPool,
    project: &Project,
) -> Result<String, ApiError> {
    let raw = project.workdir.as_deref().unwrap_or("").trim();
    let raw = if raw.is_empty() {
        format!("/data/devforge/applications/{}", project.uuid)
    } else {
        raw.to_string()
    };
    let workdir = devforge_deploy::resolve_project_workdir(&raw, &project.uuid);
    let path = std::path::Path::new(&workdir);
    if !path.exists() {
        fs::create_dir_all(path).map_err(|e| {
            ApiError::message(format!("Impossible de créer le workdir {workdir} : {e}"))
        })?;
    }
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT key, value FROM project_env_vars WHERE project_uuid = $1 ORDER BY key",
    )
    .bind(&project.uuid)
    .fetch_all(pool)
    .await
    .map_err(ApiError::from)?;
    let outcome = devforge_env::materialize_dotenv_file(path, &rows)
        .map_err(|e| ApiError::message(format!("materialize .env dans {workdir} : {e}")))?;
    Ok(match outcome {
        devforge_env::MaterializeOutcome::Written => {
            format!("cloned {} keys → {workdir}/.env", rows.len())
        }
        devforge_env::MaterializeOutcome::Removed => format!("cleared stale .env in {workdir}"),
        devforge_env::MaterializeOutcome::Absent => format!("no .env (empty env) in {workdir}"),
    })
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
            "logs": dep.logs.unwrap_or_default(),
            "error_summary": dep.error_summary,
            "error_hint": dep.error_hint,
            "live_revision_sha": dep.live_revision_sha,
        }
    })))
}

fn extract_meaningful_error_logs(raw_logs: &str, max_lines: usize, max_chars: usize) -> String {
    let lines: Vec<&str> = raw_logs.lines().collect();
    if lines.len() <= max_lines {
        let joined = lines.join("\n");
        if joined.len() > max_chars {
            joined
                .chars()
                .rev()
                .take(max_chars)
                .collect::<String>()
                .chars()
                .rev()
                .collect()
        } else {
            joined
        }
    } else {
        let tail_lines = &lines[lines.len() - max_lines..];
        let joined = tail_lines.join("\n");
        if joined.len() > max_chars {
            joined
                .chars()
                .rev()
                .take(max_chars)
                .collect::<String>()
                .chars()
                .rev()
                .collect()
        } else {
            joined
        }
    }
}

fn build_repair_prompt(dep_uuid: &str, summary: &str, hint: &str, raw_logs: &str) -> String {
    let logs_tail = extract_meaningful_error_logs(raw_logs, 100, 6000);
    format!(
        "🔧 AUTO-RÉPARATION DÉPLOIEMENT (PLAYBOOK)\n\n\
        Le déploiement {dep_uuid} a échoué.\n\n\
        **Diagnostic rapide** : {summary}\n\
        **Indice de remédiation** : {}\n\n\
        **Dernières lignes de logs & Stack Trace (tail extract)** :\n```\n{logs_tail}\n```\n\n\
        📋 **PLAYBOOK D'AUTO-RÉPARATION DÉTERMINISTE** :\n\
        Suis rigoureusement ces 4 étapes dans cet ordre précis :\n\
        1. **Diagnostiquer** : Identifie la cause racine exacte dans la stack trace ou le message d'erreur.\n\
        2. **Inspecter** : Utilise `read_project_file` pour examiner le code source ou la configuration défaillante.\n\
        3. **Corriger** : Utilise `write_project_file` pour appliquer la correction minimale nécessaire (ou `create_github_fix` / git tools si repo distant).\n\
        4. **Relancer & Valider** : Appelle le tool `trigger_deploy` pour relancer immédiatement le déploiement et confirmer la résolution, puis résume tes actions à l'utilisateur.",
        if hint.is_empty() { "Aucun indice spécifique" } else { hint }
    )
}

/// POST /api/v1/deployments/{uuid}/cancel
/// Annule un déploiement encore en cours. N’arrête pas le conteneur de production :
/// seul le token cancel + le conteneur temporaire blue-green (`-new`) sont touchés.
async fn cancel_deployment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (_user, _ws, dep) = auth_deployment(&state, &headers, &uuid).await?;

    let in_progress = matches!(
        dep.status.as_str(),
        "queued" | "running" | "building" | "pending" | "deploying"
    );
    if !in_progress {
        return Err(ApiError::message(
            "Ce déploiement n’est plus en cours — annulation impossible",
        ));
    }

    let project = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE id = $1")
        .bind(dep.project_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("project"))?;

    let cancelled = crate::deploy_queue::cancel_one_deployment(
        &state.deploy_queue,
        &state.pool,
        &uuid,
    )
    .await
    .map_err(ApiError::from)?;

    if !cancelled {
        return Err(ApiError::message(
            "Ce déploiement n’est plus en cours — annulation impossible",
        ));
    }

    let server = project.server_id.as_deref().unwrap_or("default");
    state
        .deploy
        .abort_in_flight_swap(&project.uuid, server)
        .await;

    crate::deploy_queue::record_event(
        &state.pool,
        &project.uuid,
        "deploy",
        "cancelled",
        &uuid,
        "user_cancel",
    )
    .await;

    let dep = sqlx::query_as::<_, Deployment>("SELECT * FROM deployments WHERE uuid = $1")
        .bind(&uuid)
        .fetch_one(&state.pool)
        .await
        .map_err(ApiError::from)?;

    Ok(Json(json!({
        "data": dep,
        "ok": true,
        "cancelled": true,
    })))
}

/// POST /api/v1/deployments/{uuid}/request-repair
/// Déclenche un agent de réparation pour un déploiement échoué.
async fn request_repair(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (_user, _ws, dep) = auth_deployment(&state, &headers, &uuid).await?;

    if dep.status != "failed" {
        return Err(ApiError::message(
            "Seuls les déploiements 'failed' peuvent être réparés",
        ));
    }

    // Trouver le projet
    let project = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE id = $1")
        .bind(dep.project_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("project"))?;

    // Trouver l'agent deploy du projet
    let agent_uuid: Option<(String,)> = sqlx::query_as(
        "SELECT uuid FROM project_agents WHERE project_uuid = $1 AND role = 'deploy' LIMIT 1",
    )
    .bind(&project.uuid)
    .fetch_optional(&state.pool)
    .await
    .map_err(ApiError::from)?;

    let Some((agent_uuid,)) = agent_uuid else {
        return Err(ApiError::message(
            "Aucun agent deploy trouvé pour ce projet",
        ));
    };

    let summary = dep
        .error_summary
        .as_deref()
        .unwrap_or("Échec du déploiement");
    let hint = dep.error_hint.as_deref().unwrap_or("");
    let repair_prompt =
        build_repair_prompt(&dep.uuid, summary, hint, dep.logs.as_deref().unwrap_or(""));

    let now = now_str();
    let msg_uuid = new_uuid();

    sqlx::query(
        r#"INSERT INTO agent_messages (uuid, project_uuid, agent_uuid, role, content, tool_calls_json, provider, created_at)
           VALUES ($1, $2, $3, 'user', $4, '[]', 'system', $5)"#,
    )
    .bind(&msg_uuid)
    .bind(&project.uuid)
    .bind(&agent_uuid)
    .bind(&repair_prompt)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(ApiError::from)?;

    // Marquer l'agent comme working
    sqlx::query("UPDATE project_agents SET status = 'working', updated_at = $1 WHERE uuid = $2")
        .bind(&now)
        .bind(&agent_uuid)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;

    // Kick the agent asynchronously
    let state_clone = state.clone();
    let project_uuid = project.uuid.clone();
    let agent_uuid_clone = agent_uuid.clone();
    tokio::spawn(async move {
        let _ = trigger_agent_turn(&state_clone, &project_uuid, &agent_uuid_clone).await;
    });

    Ok(Json(json!({
        "ok": true,
        "message": "Agent de réparation lancé",
        "agent_uuid": agent_uuid,
        "deployment_uuid": dep.uuid
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
    let p = sqlx::query_as::<_, crate::state::Project>("SELECT * FROM projects WHERE uuid = $1")
        .bind(project_uuid)
        .fetch_optional(&state.pool)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("project"))?;

    let deps: Vec<(String, String, Option<String>, Option<String>, String)> = sqlx::query_as(
        r#"SELECT uuid, status, git_sha, git_message, created_at
           FROM deployments WHERE project_id = $1 ORDER BY id DESC LIMIT 5"#,
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
            let msg_s = msg
                .as_deref()
                .unwrap_or("")
                .chars()
                .take(80)
                .collect::<String>();
            lines.push(format!(
                "  · {status} · {sha_s} · {msg_s} · {created} ({uuid})"
            ));
        }
    }
    // Charger les règles AGENTS.md (fichier à la racine ou fallback)
    let agents_md_path = resolve_project_agents_md_path(&p);
    let rules_content = match agents_md_path {
        Some(ref path) if path.is_file() => fs::read_to_string(path).ok(),
        _ => None,
    };

    if let Some(rules) = rules_content {
        lines.push("\n--- RÈGLES & DIRECTIVES DU PROJET (AGENTS.md) ---".into());
        lines.push(rules);
        lines.push("--- FIN DES RÈGLES PROJET ---\n".into());
    } else {
        lines.push(format!(
            "\n--- DIRECTIVES PAR DÉFAUT ---\n{}\n--- FIN DIRECTIVES ---\n",
            default_project_rules_template(&p.name)
        ));
    }

    lines.push(
        "Utilise ces infos comme base. Respecte impérativement les règles du projet énoncées ci-dessus. \
         Pour approfondir : get_project, github_list_prs, github_workflow_runs, get_deployment_logs, list_env_vars."
            .into(),
    );

    Ok(ProjectAgentBrief {
        text: lines.join("\n"),
        git_owner,
        git_repo,
        git_branch,
    })
}

/// Réveille un agent projet : message système + tour (dédupe optionnelle par marqueur).
pub(crate) async fn wake_project_agent(
    state: &AppState,
    project_uuid: &str,
    agent_uuid: &str,
    marker: &str,
    content: &str,
) -> Result<(), String> {
    if !marker.is_empty() {
        let already: Option<(i64,)> = sqlx::query_as(
            "SELECT COUNT(*) FROM agent_messages WHERE project_uuid = $1 AND agent_uuid = $2 AND content LIKE $3",
        )
        .bind(project_uuid)
        .bind(agent_uuid)
        .bind(format!("%{marker}%"))
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();
        if let Some((count,)) = already {
            if count > 0 {
                tracing::info!(project_uuid, agent_uuid, marker, "wake agent déjà envoyé, skip");
                return Ok(());
            }
        }
    }

    let enabled: Option<(i64,)> = sqlx::query_as(
        "SELECT COALESCE(enabled, 1) FROM project_agents WHERE uuid = $1 AND project_uuid = $2",
    )
    .bind(agent_uuid)
    .bind(project_uuid)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| e.to_string())?;
    let Some((enabled,)) = enabled else {
        return Err("agent introuvable".into());
    };
    if enabled == 0 {
        tracing::info!(project_uuid, agent_uuid, "wake agent skip (désactivé)");
        return Ok(());
    }

    let now = now_str();
    let msg_uuid = new_uuid();
    let body = if marker.is_empty() {
        content.to_string()
    } else {
        format!("{marker}\n\n{content}")
    };
    sqlx::query(
        r#"INSERT INTO agent_messages (uuid, project_uuid, agent_uuid, role, content, tool_calls_json, provider, created_at)
           VALUES ($1, $2, $3, 'user', $4, '[]', 'system', $5)"#,
    )
    .bind(&msg_uuid)
    .bind(project_uuid)
    .bind(agent_uuid)
    .bind(&body)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query(
        r#"UPDATE project_agents SET status = 'working', last_run_at = $1, updated_at = $1 WHERE uuid = $2"#,
    )
    .bind(&now)
    .bind(agent_uuid)
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    let _ = trigger_agent_turn(state, project_uuid, agent_uuid).await;
    tracing::info!(project_uuid, agent_uuid, marker, "wake agent lancé");
    Ok(())
}

/// Poste un message dans le fil coordinateur et enqueue un tour (dédupe par marqueur).
async fn wake_coordinator(
    state: &AppState,
    project_uuid: &str,
    marker: &str,
    content: &str,
) -> Result<(), String> {
    let Some(agent_uuid) = crate::db::ensure_coordinator_agent(&state.pool, project_uuid)
        .await
        .map_err(|e| e.to_string())?
    else {
        return Err("Aucun agent coordinateur".into());
    };
    wake_project_agent(state, project_uuid, &agent_uuid, marker, content).await
}

/// Réveille tous les agents autonomes abonnés à un type d'événement (hors coordinateur).
pub(crate) async fn wake_event_agents(
    state: &AppState,
    project_uuid: &str,
    event: &str,
    marker: &str,
    content: &str,
) -> Result<(), String> {
    let _ = crate::db::seed_required_agents(&state.pool, project_uuid)
        .await
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, String)> = sqlx::query_as(
        r#"SELECT uuid, COALESCE(instructions, '')
           FROM project_agents
           WHERE project_uuid = $1
             AND COALESCE(enabled, 1) = 1
             AND kind != 'subagent'
             AND role != 'coordinator'
             AND trigger_type = 'event'
             AND trigger_config LIKE $2"#,
    )
    .bind(project_uuid)
    .bind(format!("%\"event\":\"{event}\"%"))
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    for (agent_uuid, instructions) in rows {
        let body = if instructions.trim().is_empty() {
            content.to_string()
        } else {
            format!("{content}\n\nInstructions agent :\n{instructions}")
        };
        if let Err(e) = wake_project_agent(state, project_uuid, &agent_uuid, marker, &body).await {
            tracing::warn!(project_uuid, agent_uuid, error = %e, "wake event agent échoué");
        }
    }
    Ok(())
}

/// Boucle : agents à trigger cron dus → wake + recalcul next_run_at.
pub async fn agent_cron_loop(state: AppState) {
    tracing::info!("Démarrage scheduler agents cron");
    loop {
        if let Err(e) = agent_cron_tick(&state).await {
            tracing::error!(error = %e, "Erreur cycle agents cron");
        }
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
    }
}

async fn agent_cron_tick(state: &AppState) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let due: Vec<(String, String, String, String)> = sqlx::query_as(
        r#"SELECT uuid, project_uuid, COALESCE(trigger_config, '{}'), COALESCE(instructions, '')
           FROM project_agents
           WHERE COALESCE(enabled, 1) = 1
             AND trigger_type = 'cron'
             AND next_run_at != ''
             AND next_run_at <= $1
             AND kind != 'subagent'"#,
    )
    .bind(&now)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    for (agent_uuid, project_uuid, trigger_config, instructions) in due {
        let content = if instructions.trim().is_empty() {
            "Exécution planifiée (cron). Applique ta mission pour ce projet.".to_string()
        } else {
            instructions
        };
        let marker = format!(
            "AGENT-WAKE:CRON:{}:{}",
            agent_uuid,
            &now[..16.min(now.len())]
        );
        if let Err(e) =
            wake_project_agent(state, &project_uuid, &agent_uuid, &marker, &content).await
        {
            tracing::warn!(agent_uuid, error = %e, "wake cron agent échoué");
        }
        let next = {
            let v: serde_json::Value =
                serde_json::from_str(&trigger_config).unwrap_or_else(|_| serde_json::json!({}));
            let expr = v
                .get("cron_expression")
                .and_then(|x| x.as_str())
                .unwrap_or("");
            let tz = v.get("timezone").and_then(|x| x.as_str());
            if expr.is_empty() {
                String::new()
            } else {
                devforge_cron::next_run_time(expr, tz)
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_default()
            }
        };
        let _ = sqlx::query(
            "UPDATE project_agents SET next_run_at = $1, updated_at = $2 WHERE uuid = $3",
        )
        .bind(&next)
        .bind(&now)
        .bind(&agent_uuid)
        .execute(&state.pool)
        .await;
    }
    Ok(())
}

pub(crate) async fn wake_coordinator_deploy_fail(
    state: &AppState,
    project_uuid: &str,
    dep_uuid: &str,
    summary: &str,
    hint: &str,
) -> Result<(), String> {
    let marker = crate::db::coordinator_deploy_fail_marker(dep_uuid);
    let hint_line = if hint.is_empty() {
        String::new()
    } else {
        format!("\nIndice : {hint}")
    };
    let content = format!(
        "Événement projet : échec de déploiement.\n\
         Déploiement : {dep_uuid}\n\
         Diagnostic : {summary}{hint_line}\n\n\
         Tu es le Coordinateur (fil permanent). Analyse la situation, propose un plan, \
         et pour une réparation lourde délègue via un sous-agent (kind=subagent, parent=toi) \
         plutôt que de créer un nouveau fil permanent. Tu peux aussi t’appuyer sur l’agent Deploy."
    );
    let r = wake_coordinator(state, project_uuid, &marker, &content).await;
    let event_marker = format!("{marker}:event-agents");
    let _ = wake_event_agents(state, project_uuid, "deploy_fail", &event_marker, &content).await;
    r
}


pub(crate) async fn wake_deploy_success(
    state: &AppState,
    project_uuid: &str,
    dep_uuid: &str,
) -> Result<(), String> {
    let marker = format!("COORD-WAKE:DEPLOY-OK:{dep_uuid}");
    let content = format!(
        "Événement projet : déploiement réussi.\n         Déploiement : {dep_uuid}\n\n         Vérifie la santé / revue post-deploy si ta mission le demande."
    );
    // Coordinateur n'est pas réveillé sur succès (évite bruit) — agents event uniquement.
    wake_event_agents(state, project_uuid, "deploy_success", &marker, &content).await
}

async fn wake_coordinator_health(
    state: &AppState,
    project_uuid: &str,
    status: &str,
) -> Result<(), String> {
    let marker = crate::db::coordinator_health_marker(project_uuid, status);
    let label = match status {
        "unhealthy" => "santé dégradée (unhealthy)",
        "unrouted" => "application non routée (unrouted)",
        other => other,
    };
    let content = format!(
        "Événement projet : {label}.\n\
         Statut dérivé : {status}\n\n\
         Tu es le Coordinateur (fil permanent). Vérifie get_project / http_smoke / logs, \
         explique l’impact, et propose les prochaines actions. Pour un diagnostic approfondi, \
         spawn un sous-agent (kind=subagent, parent_agent_uuid=ton uuid) plutôt qu’un nouveau chat permanent."
    );
    let r = wake_coordinator(state, project_uuid, &marker, &content).await;
    let event_marker = format!("{marker}:event-agents");
    let event = if status == "unrouted" { "unrouted" } else { "unhealthy" };
    let _ = wake_event_agents(state, project_uuid, event, &event_marker, &content).await;
    r
}

/// Auto-trigger repair after failed deployment (max once per deployment uuid).
async fn auto_trigger_repair(state: &AppState, dep_uuid: &str) -> Result<(), String> {
    // Check if repair already attempted for this deployment
    let already_attempted: Option<(i64,)> = sqlx::query_as(
        "SELECT COUNT(*) FROM agent_messages WHERE content LIKE $1 AND content LIKE $2",
    )
    .bind(format!("%AUTO-RÉPARATION%{}%", dep_uuid))
    .bind("%AUTO-RÉPARATION DÉPLOIEMENT%")
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();

    if let Some((count,)) = already_attempted {
        if count > 0 {
            tracing::info!("Auto-repair déjà tenté pour {}, skip", dep_uuid);
            return Ok(());
        }
    }

    let dep = sqlx::query_as::<_, Deployment>("SELECT * FROM deployments WHERE uuid = $1")
        .bind(dep_uuid)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Deployment not found".to_string())?;

    let project = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE id = $1")
        .bind(dep.project_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Project not found".to_string())?;

    let agent_uuid: Option<(String,)> = sqlx::query_as(
        "SELECT uuid FROM project_agents WHERE project_uuid = $1 AND role = 'deploy' LIMIT 1",
    )
    .bind(&project.uuid)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    let Some((agent_uuid,)) = agent_uuid else {
        return Err("No deploy agent found".to_string());
    };

    let summary = dep
        .error_summary
        .as_deref()
        .unwrap_or("Échec du déploiement");
    let hint = dep.error_hint.as_deref().unwrap_or("");
    let repair_prompt =
        build_repair_prompt(&dep.uuid, summary, hint, dep.logs.as_deref().unwrap_or(""));

    let now = now_str();
    let msg_uuid = new_uuid();

    sqlx::query(
        r#"INSERT INTO agent_messages (uuid, project_uuid, agent_uuid, role, content, tool_calls_json, provider, created_at)
           VALUES ($1, $2, $3, 'user', $4, '[]', 'system', $5)"#,
    )
    .bind(&msg_uuid)
    .bind(&project.uuid)
    .bind(&agent_uuid)
    .bind(&repair_prompt)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    sqlx::query("UPDATE project_agents SET status = 'working', updated_at = $1 WHERE uuid = $2")
        .bind(&now)
        .bind(&agent_uuid)
        .execute(&state.pool)
        .await
        .map_err(|e| e.to_string())?;

    let _ = trigger_agent_turn(state, &project.uuid, &agent_uuid).await;

    tracing::info!("Auto-repair lancé pour déploiement {}", dep_uuid);
    Ok(())
}

/// Déclenche un tour d'agent de manière interne (sans requête HTTP).
/// Le message utilisateur est déjà dans `agent_messages`. Le run est repris au boot s'il est coupé.
async fn trigger_agent_turn(
    state: &AppState,
    project_uuid: &str,
    agent_uuid: &str,
) -> Result<(), String> {
    let last_user_msg = sqlx::query_as::<_, (String, String)>(
        "SELECT uuid, content FROM agent_messages WHERE agent_uuid = $1 AND role = 'user' ORDER BY id DESC LIMIT 1",
    )
    .bind(agent_uuid)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    let Some((message_uuid, content)) = last_user_msg else {
        return Err("Aucun message utilisateur trouvé pour cet agent".to_string());
    };

    let run_uuid =
        crate::agent_runs::enqueue(&state.pool, project_uuid, agent_uuid, &message_uuid).await?;
    if crate::agent_runs::assistant_already_replied(&state.pool, agent_uuid, &message_uuid)
        .await
        .unwrap_or(false)
    {
        let _ = crate::agent_runs::finish(&state.pool, &run_uuid, "completed", None).await;
        return Ok(());
    }
    let claimed = crate::agent_runs::try_claim(&state.pool, &run_uuid)
        .await
        .map_err(|e| e.to_string())?;
    if !claimed {
        return Ok(());
    }
    let run = crate::agent_runs::RunRow {
        uuid: run_uuid,
        project_uuid: project_uuid.to_string(),
        agent_uuid: agent_uuid.to_string(),
        message_uuid,
        content,
    };
    execute_claimed_run(state, &run).await
}

async fn execute_claimed_run(
    state: &AppState,
    run: &crate::agent_runs::RunRow,
) -> Result<(), String> {
    let mut ctx = load_agent_context(state, &run.project_uuid, &run.agent_uuid).await;
    if ctx
        .history
        .last()
        .is_some_and(|(role, content)| role == "user" && content == &run.content)
    {
        ctx.history.pop();
    }
    let now = now_str();
    let _ = sqlx::query(
        "UPDATE project_agents SET status = 'working', updated_at = $1 WHERE uuid = $2",
    )
    .bind(&now)
    .bind(&run.agent_uuid)
    .execute(&state.pool)
    .await;

    let owner = {
        let ws: Option<(String,)> =
            sqlx::query_as("SELECT workspace_uuid FROM projects WHERE uuid = $1")
                .bind(&run.project_uuid)
                .fetch_optional(&state.pool)
                .await
                .ok()
                .flatten();
        match ws {
            Some((ws,)) => crate::user_prefs::workspace_owner(&state.pool, &ws).await,
            None => None,
        }
    };
    let result = match owner {
        Some(uuid) => {
            let (llm, mode) = state.llm_for_user(&uuid).await;
            let token = crate::user_prefs::github_token(&state.pool, &uuid).await;
            devforge_github::with_token(
                &token,
                state.agent.handle_with_provider(
                    &run.content,
                    None,
                    None,
                    ctx,
                    None,
                    Some((llm, mode)),
                ),
            )
            .await
        }
        None => {
            state
                .agent
                .handle_with_context(&run.content, None, None, ctx)
                .await
        }
    };
    let result = match result {
        Ok(result) => result,
        Err(e) => {
            crate::agent_runs::fail_run(&state.pool, &run.uuid, &run.agent_uuid, &e.to_string())
                .await;
            return Err(e.to_string());
        }
    };
    let tools_json = serde_json::to_string(&result.tool_calls).unwrap_or_else(|_| "[]".into());
    crate::agent_runs::save_assistant_and_finish(
        &state.pool,
        &run.uuid,
        &run.project_uuid,
        &run.agent_uuid,
        &result.reply,
        &tools_json,
        &result.provider,
    )
    .await
    .map_err(|e| e.to_string())?;
    schedule_preview_repair(
        state.clone(),
        run.project_uuid.clone(),
        run.agent_uuid.clone(),
        run.content.clone(),
        tools_json,
    );
    Ok(())
}

fn schedule_preview_repair(
    state: AppState,
    project_uuid: String,
    agent_uuid: String,
    user_message: String,
    tools_json: String,
) {
    let Some(prompt) = crate::agent_runs::preview_repair_prompt(&user_message, &tools_json) else {
        return;
    };
    tokio::spawn(async move {
        if let Err(e) =
            crate::agent_runs::record_user_turn(&state.pool, &project_uuid, &agent_uuid, &prompt)
                .await
        {
            tracing::error!(error = %e, "message de réparation preview");
            return;
        }
        if let Err(e) = trigger_agent_turn(&state, &project_uuid, &agent_uuid).await {
            tracing::error!(error = %e, "tour de réparation preview");
        }
    });
}

async fn load_agent_context(
    state: &AppState,
    project_uuid: &str,
    agent_uuid: &str,
) -> devforge_agent::AgentChatContext {
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
    if let Ok(Some((name, role))) = sqlx::query_as::<_, (String, String)>(
        "SELECT name, role FROM project_agents WHERE uuid = $1",
    )
    .bind(agent_uuid)
    .fetch_optional(&state.pool)
    .await
    {
        ctx.agent_name = Some(name);
        ctx.agent_role = Some(role);
    }
    ctx.history = crate::agent_runs::recent_history(&state.pool, agent_uuid).await;
    if let Ok(brief) = build_project_agent_brief(state, project_uuid).await {
        ctx.git_owner = brief.git_owner;
        ctx.git_repo = brief.git_repo;
        ctx.git_branch = brief.git_branch;
        ctx.project_brief = Some(brief.text);
    }
    ctx
}

/// Reprend les tours coupés par un redémarrage. Appelé une fois au boot du leader.
/// Reprend la file SQLite après le boot, seulement si ce processus peut écrire.
/// Un claim par déploiement : le second leader, ou un second passage, ne relance pas le build.
pub fn resume_deploy_queue(state: AppState) {
    tokio::spawn(async move {
        let writable = match state.cluster.local().await {
            Ok(local) => !local.writes_fenced && local.role == devforge_cluster::NodeRole::Leader,
            Err(e) => {
                tracing::error!(error = %e, "file de déploiement : état cluster illisible");
                false
            }
        };
        if !writable {
            tracing::info!("file de déploiement laissée en attente : écritures closes");
            return;
        }
        if let Err(e) = crate::deploy_queue::requeue_interrupted(&state.pool).await {
            tracing::error!(error = %e, "reprise de la file de déploiement");
            return;
        }
        let queued = match crate::deploy_queue::list_queued_deployments(&state.pool).await {
            Ok(rows) => rows,
            Err(e) => {
                tracing::error!(error = %e, "liste de la file de déploiement");
                return;
            }
        };
        if queued.is_empty() {
            return;
        }
        tracing::info!(count = queued.len(), "reprise des déploiements en file");
        for uuid in queued {
            let fenced = state
                .cluster
                .local()
                .await
                .map(|l| l.writes_fenced)
                .unwrap_or(true);
            if fenced {
                tracing::info!("reprise des déploiements arrêtée : écritures closes");
                break;
            }
            let claimed = crate::deploy_queue::try_claim_deployment(&state.pool, &uuid)
                .await
                .unwrap_or(false);
            if !claimed {
                continue;
            }
            let project = sqlx::query_as::<_, Project>(
                r#"SELECT p.* FROM projects p
                   JOIN deployments d ON d.project_id = p.id
                   WHERE d.uuid = $1"#,
            )
            .bind(&uuid)
            .fetch_optional(&state.pool)
            .await;
            let project = match project {
                Ok(Some(p)) => p,
                Ok(None) => {
                    let now = now_str();
                    let _ = sqlx::query(
                        r#"UPDATE deployments
                           SET status = 'failed', error_summary = $1, finished_at = $2, updated_at = $3
                           WHERE uuid = $4"#,
                    )
                    .bind("Projet introuvable")
                    .bind(&now)
                    .bind(&now)
                    .bind(&uuid)
                    .execute(&state.pool)
                    .await;
                    continue;
                }
                Err(e) => {
                    tracing::error!(error = %e, deployment = %uuid, "lecture du projet à reprendre");
                    continue;
                }
            };
            let outcome = run_real_deploy(&state, &project, &uuid).await;
            persist_resumed_deploy(&state, &project, &uuid, &outcome).await;
        }
    });
}

async fn persist_resumed_deploy(
    state: &AppState,
    project: &Project,
    deployment_uuid: &str,
    outcome: &DeployRunOutcome,
) {
    if outcome.cancelled {
        return;
    }
    let result = &outcome.result;
    let finished = now_str();
    let status = if result.ok { "success" } else { "failed" };
    let sha = result.git_sha.clone().unwrap_or_else(|| "unknown".into());
    let (error_summary, error_hint) = if result.ok {
        (None, None)
    } else {
        match devforge_deploy::parse_deploy_error_fr(&result.logs) {
            Some(err) => (Some(err.summary), err.hint),
            None => (Some("Échec du déploiement".into()), None),
        }
    };
    let wrote = crate::deploy_queue::finalize_if_active(
        &state.pool,
        deployment_uuid,
        status,
        &sha,
        &result.logs,
        error_summary.as_deref(),
        error_hint.as_deref(),
        None,
    )
    .await;
    if !wrote {
        return;
    }
    let project_status = if result.ok { "live" } else { "failed" };
    let _ = sqlx::query("UPDATE projects SET status = $1, updated_at = $2 WHERE id = $3")
        .bind(project_status)
        .bind(&finished)
        .bind(project.id)
        .execute(&state.pool)
        .await;
    if result.ok {
        if let Err(e) = state.proxy.ensure_traefik().await {
            tracing::error!(error = %e, project = %project.uuid, "reprise : Traefik");
        }
    } else {
        let state_clone = state.clone();
        let project_uuid = project.uuid.clone();
        let dep_uuid = deployment_uuid.to_string();
        let summary = error_summary
            .clone()
            .unwrap_or_else(|| "Échec du déploiement".into());
        let hint = error_hint.clone().unwrap_or_default();
        tokio::spawn(async move {
            let _ = wake_coordinator_deploy_fail(
                &state_clone,
                &project_uuid,
                &dep_uuid,
                &summary,
                &hint,
            )
            .await;
        });
    }
}

pub fn resume_agent_runs(state: AppState) {
    tokio::spawn(async move {
        if let Err(e) = crate::agent_runs::reopen_interrupted(&state.pool).await {
            tracing::error!(error = %e, "reprise des tours d'agent");
            return;
        }
        let runs = match crate::agent_runs::list_pending(&state.pool).await {
            Ok(runs) => runs,
            Err(e) => {
                tracing::error!(error = %e, "liste des tours d'agent en attente");
                return;
            }
        };
        if runs.is_empty() {
            return;
        }
        tracing::info!(count = runs.len(), "reprise des tours d'agent interrompus");
        for run in runs {
            let claimed = crate::agent_runs::try_claim(&state.pool, &run.uuid)
                .await
                .unwrap_or(false);
            if !claimed {
                continue;
            }
            if crate::agent_runs::assistant_already_replied(
                &state.pool,
                &run.agent_uuid,
                &run.message_uuid,
            )
            .await
            .unwrap_or(false)
            {
                let _ = crate::agent_runs::finish(&state.pool, &run.uuid, "completed", None).await;
                continue;
            }
            let state = state.clone();
            tokio::spawn(async move {
                if let Err(e) = execute_claimed_run(&state, &run).await {
                    tracing::error!(error = %e, run = %run.uuid, "échec reprise tour d'agent");
                }
            });
        }
    });
}

async fn attach_project_sqlite(state: &AppState, project: &Project) -> Result<(), String> {
    let raw = project.workdir.as_deref().unwrap_or("").trim();
    let resolved = devforge_deploy::resolve_project_workdir(raw, &project.uuid);
    let db_file = std::path::Path::new(&resolved).join("data").join("app.db");
    let _url = devforge_database::provision_sqlite_file(&db_file).await?;
    state
        .env
        .upsert(
            &project.uuid,
            devforge_env::EnvVar {
                key: "DATABASE_URL".into(),
                value: "sqlite:data/app.db?mode=rwc".into(),
                secret: false,
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    let _ = materialize_project_env_to_workdir(&state.pool, project).await;
    Ok(())
}

async fn agent_chat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ChatBody>,
) -> Result<axum::response::Response, ApiError> {
    let (user, workspace) = require_auth(&state, &headers).await?;
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
            "SELECT name, role FROM project_agents WHERE uuid = $1",
        )
        .bind(agent_uuid)
        .fetch_optional(&state.pool)
        .await
        {
            ctx.agent_name = Some(name);
            ctx.agent_role = Some(role);
        }

        ctx.history = crate::agent_runs::recent_history(&state.pool, agent_uuid).await;
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
    let user_message = body.message.clone();
    let force_tool = body.tool.clone();
    let force_args = body.arguments.clone();
    let want_stream = body.stream.unwrap_or(false);
    let run_uuid = match (project_uuid.as_ref(), agent_uuid.as_ref()) {
        (Some(project_uuid), Some(agent_uuid)) => {
            Some(begin_agent_run(&state, project_uuid, agent_uuid, &user_message).await?)
        }
        _ => None,
    };

    let user_uuid = user.uuid.clone();

    if want_stream {
        let agent = state.agent.clone();
        let pool = state.pool.clone();
        let repair_state = state.clone();
        let llm_state = state.clone();
        let (ev_tx, ev_rx) = tokio::sync::mpsc::unbounded_channel::<devforge_agent::AgentEvent>();
        let progress_tx = ev_tx.clone();
        let run_uuid_stream = run_uuid.clone();

        // Octets tout de suite : la résolution LLM (sondes) ne doit pas retarder les en-têtes,
        // sinon Cloudflare renvoie 524 avant le premier octet.
        let _ = ev_tx.send(devforge_agent::AgentEvent::Thinking {
            round: 0,
            label: "Connexion aux modèles…".into(),
            detail: String::new(),
        });

        tokio::spawn(async move {
            let (llm, llm_mode) = llm_state.llm_for_user(&user_uuid).await;
            let gh_token = crate::user_prefs::github_token(&pool, &user_uuid).await;
            let result = devforge_github::with_token(
                &gh_token,
                agent.handle_with_provider(
                    &user_message,
                    force_tool.as_deref(),
                    force_args,
                    ctx,
                    Some(progress_tx),
                    Some((llm, llm_mode)),
                ),
            )
            .await;
            match result {
                Ok(result) => {
                    let _ = ev_tx.send(devforge_agent::AgentEvent::Reply {
                        content: result.reply.clone(),
                        provider: result.provider.clone(),
                        tool_calls: result.tool_calls.clone(),
                    });
                    if let (Some(project_uuid), Some(agent_uuid), Some(run_uuid)) = (
                        project_uuid.as_ref(),
                        agent_uuid.as_ref(),
                        run_uuid_stream.as_ref(),
                    ) {
                        let tools_json = serde_json::to_string(&result.tool_calls)
                            .unwrap_or_else(|_| "[]".into());
                        if let Err(e) = crate::agent_runs::save_assistant_and_finish(
                            &pool,
                            run_uuid,
                            project_uuid,
                            agent_uuid,
                            &result.reply,
                            &tools_json,
                            &result.provider,
                        )
                        .await
                        {
                            tracing::error!(error = %e, "sauvegarde du tour d'agent");
                        } else {
                            schedule_preview_repair(
                                repair_state.clone(),
                                project_uuid.clone(),
                                agent_uuid.clone(),
                                user_message.clone(),
                                tools_json,
                            );
                        }
                    }
                }
                Err(e) => {
                    if let (Some(run_uuid), Some(agent_uuid)) =
                        (run_uuid_stream.as_ref(), agent_uuid.as_ref())
                    {
                        crate::agent_runs::fail_run(&pool, run_uuid, agent_uuid, &e.to_string())
                            .await;
                    }
                    let _ = ev_tx.send(devforge_agent::AgentEvent::Error {
                        message: e.to_string(),
                    });
                }
            }
        });

        let stream = stream::unfold(ev_rx, |mut rx| async move {
            match rx.recv().await {
                Some(ev) => {
                    let data = serde_json::to_string(&ev).unwrap_or_else(|_| "{}".into());
                    Some((
                        Ok::<Event, Infallible>(Event::default().event("message").data(data)),
                        rx,
                    ))
                }
                None => None,
            }
        })
        .chain(stream::iter(std::iter::once(Ok::<Event, Infallible>(
            Event::default().event("done").data("{}"),
        ))));

        return Ok(Sse::new(stream)
            .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
            .into_response());
    }

    let (llm, llm_mode) = state.llm_for_user(&user_uuid).await;
    let gh_token = crate::user_prefs::github_token(&state.pool, &user_uuid).await;

    let result = match devforge_github::with_token(
        &gh_token,
        state.agent.handle_with_provider(
            &user_message,
            force_tool.as_deref(),
            force_args,
            ctx,
            None,
            Some((llm, llm_mode)),
        ),
    )
    .await
    {
        Ok(result) => result,
        Err(e) => {
            if let (Some(run_uuid), Some(agent_uuid)) = (run_uuid.as_ref(), agent_uuid.as_ref()) {
                crate::agent_runs::fail_run(&state.pool, run_uuid, agent_uuid, &e.to_string())
                    .await;
            }
            return Err(ApiError::message(e.to_string()));
        }
    };

    if let (Some(project_uuid), Some(agent_uuid), Some(run_uuid)) =
        (project_uuid, agent_uuid, run_uuid)
    {
        let tools_json = serde_json::to_string(&result.tool_calls).unwrap_or_else(|_| "[]".into());
        crate::agent_runs::save_assistant_and_finish(
            &state.pool,
            &run_uuid,
            &project_uuid,
            &agent_uuid,
            &result.reply,
            &tools_json,
            &result.provider,
        )
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;
        schedule_preview_repair(
            state.clone(),
            project_uuid,
            agent_uuid,
            user_message,
            tools_json,
        );
    }

    Ok(Json(json!({"data": result})).into_response())
}

async fn begin_agent_run(
    state: &AppState,
    project_uuid: &str,
    agent_uuid: &str,
    message: &str,
) -> Result<String, ApiError> {
    let run_uuid =
        crate::agent_runs::record_user_turn(&state.pool, project_uuid, agent_uuid, message)
            .await
            .map_err(ApiError::message)?;
    let claimed = crate::agent_runs::try_claim(&state.pool, &run_uuid)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;
    if !claimed {
        return Err(ApiError::message(
            "Un tour d'agent est déjà en cours pour ce message",
        ));
    }
    Ok(run_uuid)
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
        .provision(&body.name, body.engine.as_deref())
        .await;
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
    let (_user, _ws, project) = auth_project(&state, &headers, &uuid).await?;
    let existing = state
        .env
        .get(&uuid, body.key.trim())
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;
    let unchanged = existing.as_ref().is_some_and(|v| v.value == body.value);
    if unchanged {
        let _ = materialize_project_env_to_workdir(&state.pool, &project).await;
        return Ok(Json(json!({
            "data": existing.unwrap().public_view(),
            "unchanged": true,
        })));
    }
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
    let materialize = materialize_project_env_to_workdir(&state.pool, &project)
        .await
        .unwrap_or_else(|e| format!("materialize warn: {}", e.message));
    Ok(Json(json!({"data": view, "materialize": materialize})))
}

async fn delete_env(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, key)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let (_user, _ws, project) = auth_project(&state, &headers, &uuid).await?;
    let deleted = state
        .env
        .delete(&uuid, &key)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;
    let materialize = materialize_project_env_to_workdir(&state.pool, &project)
        .await
        .unwrap_or_else(|e| format!("materialize warn: {}", e.message));
    Ok(Json(json!({"ok": deleted, "materialize": materialize})))
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
    let (_user, _ws, project) = auth_project(&state, &headers, &uuid).await?;
    let mut result = state
        .env
        .import_dotenv(&uuid, &body.content, body.overwrite.unwrap_or(true))
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;
    let materialize = materialize_project_env_to_workdir(&state.pool, &project)
        .await
        .unwrap_or_else(|e| format!("materialize warn: {}", e.message));
    if let Some(obj) = result.as_object_mut() {
        obj.insert("materialize".into(), json!(materialize));
    }
    Ok(Json(result))
}

/// Relit `{workdir}/.env` et n’écrase en DB que les clés vraiment modifiées.
async fn sync_env_from_workdir(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (_user, _ws, project) = auth_project(&state, &headers, &uuid).await?;
    let raw = project.workdir.as_deref().unwrap_or("").trim();
    let raw = if raw.is_empty() {
        format!("/data/devforge/applications/{}", project.uuid)
    } else {
        raw.to_string()
    };
    let workdir = devforge_deploy::resolve_project_workdir(&raw, &project.uuid);
    let workdir_path = std::path::Path::new(&workdir);
    let disk = devforge_env::read_dotenv_file(workdir_path)
        .map_err(|e| ApiError::message(e.to_string()))?;
    let Some(incoming) = disk else {
        return Ok(Json(json!({
            "ok": true,
            "imported": 0,
            "updated": 0,
            "unchanged": 0,
            "skipped": 0,
            "message": "aucun .env dans le workdir",
        })));
    };
    let stats = state
        .env
        .merge_vars(&uuid, incoming, true)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;
    // Re-clone DB → workdir pour garantir un fichier cohérent avec le projet.
    let materialize = materialize_project_env_to_workdir(&state.pool, &project)
        .await
        .unwrap_or_else(|e| format!("materialize warn: {}", e.message));
    let mut out = stats.to_json();
    if let Some(obj) = out.as_object_mut() {
        obj.insert("materialize".into(), json!(materialize));
        obj.insert("workdir".into(), json!(workdir));
    }
    Ok(Json(out))
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
            if slug[idx + 1..].len() == 4
                && slug[idx + 1..].chars().all(|c| c.is_ascii_alphanumeric())
            {
                return slug[..idx].to_string();
            }
        }
        slug.clone()
    });

    let description = body
        .description
        .unwrap_or_else(|| format!("Application {} générée par DevForge", project.name));
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
    sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE uuid = $1")
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
) -> Result<
    (
        crate::auth_routes::UserRow,
        crate::auth_routes::TeamRow,
        Project,
    ),
    ApiError,
> {
    let (user, workspace) = crate::auth_routes::current_workspace(state, headers)
        .await
        .map_err(ApiError::from_auth)?;
    let project = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects WHERE uuid = $1 AND workspace_uuid = $2",
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
) -> Result<
    (
        crate::auth_routes::UserRow,
        crate::auth_routes::TeamRow,
        Deployment,
    ),
    ApiError,
> {
    let (user, workspace) = require_auth(state, headers).await?;
    let dep = sqlx::query_as::<_, Deployment>(
        r#"SELECT d.* FROM deployments d
           JOIN projects p ON p.id = d.project_id
           WHERE d.uuid = $1 AND p.workspace_uuid = $2"#,
    )
    .bind(dep_uuid)
    .bind(&workspace.uuid)
    .fetch_optional(&state.pool)
    .await
    .map_err(ApiError::from)?
    .ok_or_else(|| ApiError::not_found("deployment"))?;
    Ok((user, workspace, dep))
}

struct HttpSample {
    status: u16,
    body: String,
    /// Vrai quand le corps tient dans le préfixe lu : assez pour reconnaître
    /// la page courte de Traefik (`404 page not found` ou `OK`).
    complete: bool,
    final_url: String,
}

async fn fetch_http_probe(url: &str) -> Result<HttpSample, String> {
    if url.is_empty() {
        return Err("empty".into());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("client: {}", e))?;

    match client.get(url).send().await {
        Ok(mut resp) => {
            let status = resp.status().as_u16();
            let final_url = resp.url().to_string();
            let mut buf = Vec::new();
            let mut complete = false;
            loop {
                if buf.len() >= 64 {
                    break;
                }
                match resp.chunk().await {
                    Ok(Some(chunk)) => {
                        let room = 64 - buf.len();
                        if chunk.len() <= room {
                            buf.extend_from_slice(&chunk);
                        } else {
                            buf.extend_from_slice(&chunk[..room]);
                            break;
                        }
                    }
                    Ok(None) => {
                        complete = true;
                        break;
                    }
                    Err(_) => break,
                }
            }
            Ok(HttpSample {
                status,
                body: String::from_utf8_lossy(&buf).into_owned(),
                complete,
                final_url,
            })
        }
        Err(e) => {
            if e.is_timeout() {
                Err("timeout".to_string())
            } else if e.is_connect() {
                Err("connection".to_string())
            } else {
                Err("unreachable".to_string())
            }
        }
    }
}

fn probe_url(base: &str) -> String {
    base.trim().trim_end_matches('/').to_string()
}

fn parse_container_probe(output: &str) -> Option<u16> {
    let line = output.lines().rev().find(|l| !l.trim().is_empty())?;
    let line = line.trim();
    if line == "down" {
        return None;
    }
    line.parse::<u16>()
        .ok()
        .filter(|c| devforge_deploy::app_http_is_up(*c))
}

fn project_listen_port(project: &Project) -> u16 {
    let port = project.port.clamp(0, 65535) as u16;
    if port == 0 {
        3000
    } else {
        port
    }
}

/// `live` si l'application répond.
/// Avec un nom public, le port vert ne suffit pas : Traefik répond `OK` à
/// `/ping*` et `404 page not found` quand la route Host n'est pas branchée.
async fn site_reach(state: &AppState, project: &Project) -> &'static str {
    if let Some(url) = project
        .production_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let target = probe_url(url);
        return match fetch_http_probe(&target).await {
            Ok(sample) => match devforge_deploy::classify_public_response(
                sample.status,
                &sample.body,
                sample.complete,
                &sample.final_url,
            ) {
                devforge_deploy::PublicReach::App => "live",
                devforge_deploy::PublicReach::ProxyOnly => "unrouted",
                devforge_deploy::PublicReach::Down => "unhealthy",
            },
            Err(_) => "unhealthy",
        };
    }

    let port = project_listen_port(project);
    let mut container_code = None;
    let server = project.server_id.as_deref().unwrap_or("").trim();
    if !server.is_empty() {
        let name = devforge_deploy::project_container_name(&project.uuid);
        let cmd = devforge_deploy::docker::docker_http_probe_cmd(&name, port, "/");
        let workdir = project
            .workdir
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("/");
        if let Ok(r) = state
            .deploy
            .executor()
            .exec(server, workdir, &cmd, 12)
            .await
        {
            container_code = parse_container_probe(&r.output);
            if container_code.is_some_and(devforge_deploy::app_http_is_up) {
                return "live";
            }
        }
    }

    match container_code {
        Some(c) if devforge_deploy::app_http_is_up(c) => "live",
        Some(_) => "unhealthy",
        None => "live",
    }
}

/// Statut depuis Postgres uniquement (dernier déploiement + status stocké).
/// Pas de probe HTTP/Docker — pour list/get project instantanés.
async fn resolve_project_status_db(state: &AppState, project: &Project) -> Result<String, ApiError> {
    let latest: Option<(String,)> = sqlx::query_as(
        "SELECT status FROM deployments WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(project.id)
    .fetch_optional(&state.pool)
    .await
    .map_err(ApiError::from)?;

    let derived = match latest.as_ref().map(|(s,)| s.as_str()) {
        Some("running") | Some("queued") | Some("building") | Some("pending") | Some("deploying") => {
            "deploying"
        }
        Some("failed") | Some("error") => "failed",
        Some("ready") | Some("success") | Some("completed") | Some("live") => {
            // Conserver le dernier statut de reach connu (live/unhealthy/unrouted/stopped).
            match project.status.as_str() {
                "unhealthy" | "unrouted" | "stopped" | "live" => project.status.as_str(),
                _ => "live",
            }
        }
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

    persist_derived_status(state, project, &derived).await;
    Ok(derived)
}

/// Statut avec probe live (HTTP public ou Docker). Lent — réservé à ?live=1.
async fn resolve_project_status_live(state: &AppState, project: &Project) -> Result<String, ApiError> {
    let latest: Option<(String,)> = sqlx::query_as(
        "SELECT status FROM deployments WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(project.id)
    .fetch_optional(&state.pool)
    .await
    .map_err(ApiError::from)?;

    let derived = match latest.as_ref().map(|(s,)| s.as_str()) {
        Some("running") | Some("queued") | Some("building") | Some("pending") | Some("deploying") => {
            "deploying"
        }
        Some("failed") | Some("error") => "failed",
        Some("ready") | Some("success") | Some("completed") | Some("live") => {
            site_reach(state, project).await
        }
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

    persist_derived_status(state, project, &derived).await;
    Ok(derived)
}

async fn persist_derived_status(state: &AppState, project: &Project, derived: &str) {
    if derived != project.status
        && matches!(
            derived,
            "draft" | "live" | "failed" | "deploying" | "stopped" | "unhealthy" | "unrouted"
        )
    {
        let prev = project.status.clone();
        let _ = sqlx::query("UPDATE projects SET status = $1 WHERE id = $2")
            .bind(derived)
            .bind(project.id)
            .execute(&state.pool)
            .await;
        // Transition vers unhealthy/unrouted → wake coordinateur (une fois par couple projet+statut)
        if matches!(derived, "unhealthy" | "unrouted") && prev.as_str() != derived {
            let state_clone = state.clone();
            let project_uuid = project.uuid.clone();
            let status = derived.to_string();
            tokio::spawn(async move {
                let _ = wake_coordinator_health(&state_clone, &project_uuid, &status).await;
            });
        }
    }
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
    let templates_root = crate::paths::templates_dir()
        .unwrap_or_else(|| FsPath::new(env!("CARGO_MANIFEST_DIR")).join("../../crates/templates"));

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

pub(crate) fn slugify(s: &str) -> String {
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

pub(crate) fn fqdn_from_url(url: &str) -> Option<String> {
    url.strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .map(|s| s.split('/').next().unwrap_or(s).trim().to_lowercase())
        .filter(|s| s.contains('.'))
}

pub(crate) async fn project_github(
    state: &AppState,
    workspace_uuid: &str,
) -> std::sync::Arc<devforge_github::GitHubFacade> {
    let owner = crate::user_prefs::workspace_owner(&state.pool, workspace_uuid).await;
    let token = match owner.as_deref() {
        Some(uuid) => crate::user_prefs::github_token(&state.pool, uuid).await,
        None => String::new(),
    };
    AppState::github_from_token(&token)
}

async fn wildcard_domain(state: &AppState) -> Result<String, ApiError> {
    Ok(crate::user_prefs::instance_wildcard(&state.pool).await)
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
            v.get("domains").and_then(|d| d.as_array()).map(|arr| {
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
    if let Ok(project) = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE uuid = $1")
        .bind(project_uuid)
        .fetch_one(&state.pool)
        .await
    {
        crate::sso::sync_project_proxy(state, &project).await;
    } else {
        let _ = state.proxy.sync(project_uuid).await;
    }
    crate::dns::sync_project(state, project_uuid).await;
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
                if !hosts.iter().any(|(h, _)| h.eq_ignore_ascii_case(host)) {
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

/// Génère une URL d’atelier isolée pour le workspace (process npm run dev + Traefik file).
/// Format: `https://dev-{short-uuid}.{wildcard_domain}`
async fn generate_dev_url(state: &AppState, project_uuid: &str) -> Option<String> {
    let workspace: Option<(String,)> =
        sqlx::query_as("SELECT workspace_uuid FROM projects WHERE uuid = $1")
            .bind(project_uuid)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
    let domain = match workspace {
        Some((ws,)) => crate::user_prefs::effective_wildcard_for_workspace(&state.pool, &ws).await,
        None => wildcard_domain(state).await.ok()?,
    };
    if domain.is_empty() {
        return None;
    }
    let short = project_uuid.chars().take(8).collect::<String>();
    Some(format!("https://dev-{}.{}", short, domain))
}

/// @deprecated alias — préférer [`generate_dev_url`]
async fn generate_preview_url(state: &AppState, project_uuid: &str) -> Option<String> {
    generate_dev_url(state, project_uuid).await
}

/// Extrait tous les FQDNs de production d'un projet (production_url + domaines attachés).
async fn get_production_fqdns(state: &AppState, project: &Project) -> Vec<String> {
    let mut fqdns = Vec::new();

    if let Some(url) = project.production_url.as_deref().and_then(fqdn_from_url) {
        fqdns.push(url.to_lowercase());
    }

    if let Ok(listed) = state.domains.list(&project.uuid).await {
        if let Some(arr) = listed.get("domains").and_then(|d| d.as_array()) {
            for d in arr {
                if let Some(fqdn) = d.get("fqdn").and_then(|f| f.as_str()) {
                    let normalized = fqdn.trim().to_lowercase();
                    if !normalized.is_empty() && !fqdns.contains(&normalized) {
                        fqdns.push(normalized);
                    }
                }
            }
        }
    }

    fqdns
}

/// Détecte si un nom de conteneur suit le pattern `df-{uuid}` (conteneur local/preview).
fn is_df_container(container_name: &str) -> bool {
    container_name.starts_with("df-") && container_name.len() >= 7
}

/// Labels Traefik pour le deploy (`docker run`).
///
/// Retourne les labels Traefik pour **tous les domaines de production** du projet.
/// Cette fonction est appelée uniquement pour les déploiements production (`df-<uuid>`),
/// jamais pour les previews (`df-dev-<uuid>` utilise `traefik_dev_labels` directement).
///
/// Fix 2026-09-15 : blue-green deploy perdait les labels Traefik car la fonction retournait
/// early avec les labels preview au lieu des labels production.
pub(crate) async fn proxy_labels_for_project(
    state: &AppState,
    project: &Project,
) -> Option<serde_json::Value> {
    let uuid = &project.uuid;
    let port = project.port.clamp(1, 65535) as u16;

    // Ensure all production domains have proxy routes
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
        let path = r.get("path_prefix").and_then(|p| p.as_str()).unwrap_or("/");
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
    let domain = crate::domain_catalog::apex_for_project(&state.pool, project).await;
    if domain.is_empty() {
        return Ok(None);
    }
    let host = slugify(&project.name);
    if host.is_empty() {
        return Ok(None);
    }
    let url = format!("https://{host}.{domain}");
    let now = now_str();
    sqlx::query("UPDATE projects SET production_url = $1, updated_at = $2 WHERE id = $3")
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
