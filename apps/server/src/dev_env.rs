//! Environnement **dev** d'un projet : une seconde instance (conteneur séparé) qui suit
//! une autre branche Git, publiée sur l'URL principale préfixée par `dev`.
//!
//! - `app.jeser.app` → `dev-app.jeser.app` (un seul niveau : couvert par le certificat
//!   universel de la zone, comme les previews atelier `dev-{uuid8}`).
//! - `example.com` (apex) → `dev.example.com`.
//!
//! La dev reprend les variables d'environnement de la prod et la même protection SSO.
//! Elle est distincte de la prod (`df-{uuid12}`) et de la preview atelier (`df-dev-{uuid12}`) :
//! instance `dv{uuid}` → conteneur `df-dv{uuid10}`.

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::routes::{auth_project, ApiError, DeployRunOutcome};
use crate::state::{new_uuid, now_str, AppState, Project};

#[allow(dead_code)]
pub const ENV_PROD: &str = "production";
pub const ENV_DEV: &str = "dev";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/projects/{uuid}/branches", get(get_branches))
        .route(
            "/api/v1/projects/{uuid}/branches/production",
            put(set_production_branch),
        )
        .route(
            "/api/v1/projects/{uuid}/branches/dev",
            put(set_dev_branch).delete(disable_dev_branch),
        )
        .route(
            "/api/v1/projects/{uuid}/branches/dev/deploy",
            post(deploy_dev_now),
        )
}

pub fn is_dev(environment: &str) -> bool {
    environment.trim().eq_ignore_ascii_case(ENV_DEV)
}

/// Identifiant d'instance passé au moteur de déploiement pour la dev.
/// Les UUID sont hexadécimaux : le préfixe `dv` ne collisionne jamais avec une prod.
pub fn dev_instance_id(project_uuid: &str) -> String {
    format!("dv{project_uuid}")
}

pub fn dev_container_name(project_uuid: &str) -> String {
    devforge_deploy::project_container_name(&dev_instance_id(project_uuid))
}

/// Nom d'hôte dev dérivé du nom d'hôte de prod.
///
/// `apex` = zone publique de l'app (`domain_apex`), si connue.
pub fn dev_fqdn(prod_fqdn: &str, apex: Option<&str>) -> Option<String> {
    let host = prod_fqdn.trim().trim_end_matches('.').to_ascii_lowercase();
    let labels: Vec<&str> = host.split('.').collect();
    if labels.len() < 2 || labels.iter().any(|l| l.is_empty()) {
        return None;
    }
    let apex = apex
        .map(|a| a.trim().trim_end_matches('.').to_ascii_lowercase())
        .filter(|a| !a.is_empty());
    if labels.len() == 2 || apex.as_deref() == Some(host.as_str()) {
        return Some(format!("dev.{host}"));
    }
    if labels[0] == "www" {
        let rest = labels[1..].join(".");
        if labels.len() == 3 || apex.as_deref() == Some(rest.as_str()) {
            return Some(format!("dev.{rest}"));
        }
    }
    let first = labels[0];
    let rest = labels[1..].join(".");
    Some(format!("dev-{first}.{rest}"))
}

/// URL publique de la dev (`https://dev-…`), si la prod a une URL.
pub fn dev_url_for(project: &Project) -> Option<String> {
    let fqdn = project
        .production_url
        .as_deref()
        .and_then(crate::routes::fqdn_from_url)?;
    let apex = Some(project.domain_apex.as_str()).filter(|a| !a.trim().is_empty());
    dev_fqdn(&fqdn, apex).map(|h| format!("https://{h}"))
}

pub fn dev_host_for(project: &Project) -> Option<String> {
    dev_url_for(project).and_then(|u| crate::routes::fqdn_from_url(&u))
}

/// Dossier de travail séparé : la dev ne touche jamais au checkout de la prod.
pub fn dev_workdir(prod_workdir: &str) -> String {
    let w = prod_workdir.trim().trim_end_matches('/');
    if w.is_empty() {
        // Vide → le moteur prend `data/applications/{instance}` (instance = `dv…`).
        String::new()
    } else {
        format!("{w}-dev")
    }
}

/// Ports publiés sur l'hôte retirés : la prod les occupe déjà.
pub fn dev_runtime(prod: &devforge_deploy::RuntimeSpec) -> devforge_deploy::RuntimeSpec {
    let mut rt = prod.clone();
    rt.ports.clear();
    for side in &mut rt.sidecars {
        side.ports.clear();
    }
    rt
}

fn normalize_branch(raw: &str) -> Result<String, ApiError> {
    let b = raw.trim().trim_start_matches("refs/heads/").to_string();
    let valid = !b.is_empty()
        && b.len() <= 200
        && !b.starts_with('-')
        && !b.contains("..")
        && !b.ends_with('/')
        && !b.ends_with(".lock")
        && b.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/'));
    if valid {
        Ok(b)
    } else {
        Err(ApiError::message(format!(
            "Nom de branche invalide : {raw}"
        )))
    }
}

fn dev_supported(project: &Project) -> Result<(), ApiError> {
    if project.build_pack == "dockercompose" {
        return Err(ApiError::message(
            "Environnement dev indisponible pour les projets docker compose (hôtes déclarés dans le fichier compose).",
        ));
    }
    if project
        .git_repository
        .as_deref()
        .unwrap_or("")
        .trim()
        .is_empty()
    {
        return Err(ApiError::message("Relie d’abord un dépôt Git au projet."));
    }
    if dev_url_for(project).is_none() {
        return Err(ApiError::message(
            "Définis d’abord l’URL de production : la dev est publiée sur la même URL préfixée par dev.",
        ));
    }
    Ok(())
}

async fn load_project(state: &AppState, uuid: &str) -> Option<Project> {
    sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE uuid = $1")
        .bind(uuid)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
}

async fn latest_dev_deployment(state: &AppState, project_id: i64) -> Option<Value> {
    let row: Option<(String, String, Option<String>, Option<String>, String)> = sqlx::query_as(
        r#"SELECT uuid, status, git_sha, git_message, created_at FROM deployments
           WHERE project_id = $1 AND environment = 'dev'
           ORDER BY created_at DESC LIMIT 1"#,
    )
    .bind(project_id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    row.map(|(uuid, status, sha, msg, created)| {
        json!({
            "uuid": uuid,
            "status": status,
            "git_sha": sha,
            "git_message": msg,
            "created_at": created,
        })
    })
}

pub(crate) async fn branches_view(state: &AppState, project: &Project) -> Value {
    let enabled = project
        .dev_branch
        .as_deref()
        .is_some_and(|b| !b.trim().is_empty());
    let last = if enabled {
        latest_dev_deployment(state, project.id).await
    } else {
        None
    };
    let unsupported = dev_supported(project).err().map(|e| e.message);
    json!({
        "production": {
            "branch": project.git_branch.clone().unwrap_or_else(|| "main".into()),
            "url": project.production_url,
        },
        "dev": {
            "enabled": enabled,
            "branch": project.dev_branch,
            "url": dev_url_for(project),
            "container": dev_container_name(&project.uuid),
            "last_deployment": last,
            "env_from": "production",
            "unsupported_reason": unsupported,
        },
        "auto_deploy": project.auto_deploy != 0,
    })
}

async fn get_branches(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (_user, _ws, project) = auth_project(&state, &headers, &uuid).await?;
    Ok(Json(json!({"data": branches_view(&state, &project).await})))
}

#[derive(Deserialize)]
pub struct SetBranchBody {
    pub branch: String,
    /// Prod : redéployer tout de suite. Dev : déployer tout de suite.
    #[serde(default)]
    pub redeploy: bool,
}

async fn set_production_branch(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<SetBranchBody>,
) -> Result<Json<Value>, ApiError> {
    let (_user, _ws, project) = auth_project(&state, &headers, &uuid).await?;
    let branch = normalize_branch(&body.branch)?;
    if project.dev_branch.as_deref() == Some(branch.as_str()) {
        return Err(ApiError::message(
            "Cette branche est déjà celle de la dev — choisis-en une autre ou désactive la dev.",
        ));
    }
    let now = now_str();
    sqlx::query("UPDATE projects SET git_branch = $1, updated_at = $2 WHERE id = $3")
        .bind(&branch)
        .bind(&now)
        .bind(project.id)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;
    crate::deploy_queue::record_event(
        &state.pool,
        &project.uuid,
        "branch",
        "production",
        "",
        &format!(
            "{} → {branch}",
            project.git_branch.as_deref().unwrap_or("main")
        ),
    )
    .await;
    let project = load_project(&state, &uuid)
        .await
        .ok_or_else(|| ApiError::not_found("project"))?;
    let deployment = if body.redeploy {
        Some(start_production_deploy(&state, &project, &format!("Branche prod → {branch}")).await?)
    } else {
        None
    };
    Ok(Json(json!({
        "ok": true,
        "data": branches_view(&state, &project).await,
        "deployment_uuid": deployment,
    })))
}

async fn set_dev_branch(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<SetBranchBody>,
) -> Result<Json<Value>, ApiError> {
    let (_user, _ws, project) = auth_project(&state, &headers, &uuid).await?;
    dev_supported(&project)?;
    let branch = normalize_branch(&body.branch)?;
    let prod_branch = project.git_branch.as_deref().unwrap_or("main");
    if prod_branch == branch {
        return Err(ApiError::message(
            "La dev doit suivre une autre branche que la prod.",
        ));
    }
    let now = now_str();
    sqlx::query("UPDATE projects SET dev_branch = $1, updated_at = $2 WHERE id = $3")
        .bind(&branch)
        .bind(&now)
        .bind(project.id)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;
    crate::deploy_queue::record_event(
        &state.pool,
        &project.uuid,
        "branch",
        "dev",
        "",
        &format!("dev → {branch}"),
    )
    .await;
    let project = load_project(&state, &uuid)
        .await
        .ok_or_else(|| ApiError::not_found("project"))?;
    let deployment = if body.redeploy {
        Some(start_dev_deploy(&state, &project, &format!("Dev → {branch}"), None).await?)
    } else {
        None
    };
    Ok(Json(json!({
        "ok": true,
        "data": branches_view(&state, &project).await,
        "deployment_uuid": deployment,
    })))
}

async fn deploy_dev_now(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (_user, _ws, project) = auth_project(&state, &headers, &uuid).await?;
    dev_supported(&project)?;
    if project
        .dev_branch
        .as_deref()
        .unwrap_or("")
        .trim()
        .is_empty()
    {
        return Err(ApiError::message("Environnement dev désactivé."));
    }
    let dep = start_dev_deploy(&state, &project, "Redéploiement dev", None).await?;
    Ok(Json(json!({"ok": true, "deployment_uuid": dep})))
}

async fn disable_dev_branch(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (_user, _ws, project) = auth_project(&state, &headers, &uuid).await?;
    let report = teardown(&state, &project).await;
    let now = now_str();
    sqlx::query("UPDATE projects SET dev_branch = NULL, updated_at = $1 WHERE id = $2")
        .bind(&now)
        .bind(project.id)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;
    crate::deploy_queue::record_event(
        &state.pool,
        &project.uuid,
        "branch",
        "dev_off",
        "",
        "environnement dev supprimé",
    )
    .await;
    let project = load_project(&state, &uuid)
        .await
        .ok_or_else(|| ApiError::not_found("project"))?;
    Ok(Json(json!({
        "ok": true,
        "data": branches_view(&state, &project).await,
        "teardown": report,
    })))
}

/// Même chemin qu'un déploiement manuel de prod (ligne `queued` puis tâche détachée).
async fn start_production_deploy(
    state: &AppState,
    project: &Project,
    message: &str,
) -> Result<String, ApiError> {
    let dep_uuid = new_uuid();
    let now = now_str();
    sqlx::query(
        r#"INSERT INTO deployments (
            uuid, project_id, status, git_sha, git_message, logs, finished_at, created_at, updated_at, environment
        ) VALUES ($1, $2, 'queued', 'pending', $3, $4, NULL, $5, $6, 'production')"#,
    )
    .bind(&dep_uuid)
    .bind(project.id)
    .bind(message)
    .bind("[devforge] starting…\n")
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(ApiError::from)?;
    let _ = sqlx::query("UPDATE projects SET status = 'deploying', updated_at = $1 WHERE id = $2")
        .bind(&now)
        .bind(project.id)
        .execute(&state.pool)
        .await;
    let st = state.clone();
    let p = project.clone();
    let d = dep_uuid.clone();
    tokio::spawn(async move {
        crate::routes::finish_manual_deploy(&st, p, d, None).await;
    });
    Ok(dep_uuid)
}

/// Crée la ligne `deployments` (environment = dev) puis lance le build en tâche détachée.
pub(crate) async fn start_dev_deploy(
    state: &AppState,
    project: &Project,
    message: &str,
    sha: Option<&str>,
) -> Result<String, ApiError> {
    let dep_uuid = new_uuid();
    let now = now_str();
    sqlx::query(
        r#"INSERT INTO deployments (
            uuid, project_id, status, git_sha, git_message, logs, finished_at, created_at, updated_at, environment
        ) VALUES ($1, $2, 'queued', $3, $4, $5, NULL, $6, $7, 'dev')"#,
    )
    .bind(&dep_uuid)
    .bind(project.id)
    .bind(sha.unwrap_or("pending"))
    .bind(message)
    .bind("[devforge] environnement DEV — démarrage…\n")
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(ApiError::from)?;
    let st = state.clone();
    let p = project.clone();
    let d = dep_uuid.clone();
    tokio::spawn(async move {
        finish_dev_deploy(&st, &p, &d).await;
    });
    Ok(dep_uuid)
}

/// Build + finalisation d'un déploiement dev (aussi appelé à la reprise de file au boot).
pub(crate) async fn finish_dev_deploy(state: &AppState, project: &Project, dep_uuid: &str) {
    let outcome = run_dev_deploy(state, project, dep_uuid).await;
    let result = &outcome.result;
    let sha = result.git_sha.clone().unwrap_or_else(|| "unknown".into());
    if outcome.cancelled {
        let _ = crate::deploy_queue::finalize_if_active(
            &state.pool,
            dep_uuid,
            "cancelled",
            &sha,
            &result.logs,
            Some("Annulé : un déploiement dev plus récent a été lancé"),
            None,
            None,
        )
        .await;
        return;
    }
    let status = if result.ok { "success" } else { "failed" };
    let (summary, hint) = if result.ok {
        (None, None)
    } else {
        match devforge_deploy::parse_deploy_error_fr(&result.logs) {
            Some(e) => (Some(e.summary), e.hint),
            None => (Some("Échec du déploiement dev".to_string()), None),
        }
    };
    let _ = crate::deploy_queue::finalize_if_active(
        &state.pool,
        dep_uuid,
        status,
        &sha,
        &result.logs,
        summary.as_deref(),
        hint.as_deref(),
        None,
    )
    .await;
    if result.ok {
        if let Err(e) = state.proxy.ensure_traefik().await {
            tracing::error!(error = %e, project = %project.uuid, "dev : ensure Traefik");
        }
    }
}

pub(crate) async fn run_dev_deploy(
    state: &AppState,
    project: &Project,
    deployment_uuid: &str,
) -> DeployRunOutcome {
    let instance = dev_instance_id(&project.uuid);
    let fail = |msg: String| DeployRunOutcome {
        result: devforge_deploy::DeployResult {
            ok: false,
            git_sha: None,
            logs: format!("[devforge] {msg}\n"),
        },
        cancelled: false,
    };
    let Some(branch) = project.dev_branch.clone().filter(|b| !b.trim().is_empty()) else {
        return fail("environnement dev désactivé".into());
    };
    let Some(host) = dev_host_for(project) else {
        return fail("URL de production absente : pas d’hôte dev".into());
    };
    {
        let _start = state.deploy_queue.lock_project_start(project.id).await;
        let _ = state.deploy_queue.register_cancel(deployment_uuid).await;
        let superseded = crate::deploy_queue::supersede_in_progress(
            &state.deploy_queue,
            &state.pool,
            project.id,
            deployment_uuid,
        )
        .await;
        if !superseded.is_empty() {
            let server = project.server_id.as_deref().unwrap_or("default");
            state.deploy.abort_in_flight_swap(&instance, server).await;
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

    // Mêmes variables que la prod (jamais loguées).
    let env_file = crate::routes::load_env_file_content(&state.pool, &project.uuid).await;

    let current = project
        .server_id
        .clone()
        .unwrap_or_else(|| "default".into());
    let server_id = crate::cluster_routes::ensure_live_server_id(state, &current).await;

    let port = project.port.clamp(1, 65535) as u16;
    let settings = crate::sso::load_sso_settings(&state.pool).await;
    let fwd = if crate::sso::should_protect_project(&settings, project) {
        settings.effective_forward_auth_address()
    } else {
        None
    };
    let labels =
        devforge_deploy::docker::traefik_labels(&instance, &host, "/", port, fwd.as_deref());

    let req = devforge_deploy::DeployRequest {
        project_uuid: instance.clone(),
        server_id: server_id.clone(),
        workdir: dev_workdir(project.workdir.as_deref().unwrap_or("")),
        git_repository: project.git_repository.clone().unwrap_or_default(),
        git_branch: branch.clone(),
        build_pack: if project.build_pack.is_empty() {
            "nixpacks".into()
        } else {
            project.build_pack.clone()
        },
        port,
        base_directory: if project.base_directory.is_empty() {
            "/".into()
        } else {
            project.base_directory.clone()
        },
        docker_compose_location: None,
        dockerfile_path: project.dockerfile_path.clone(),
        docker_build_context: project.docker_build_context.clone(),
        publish_directory: project.publish_directory.clone(),
        is_static: project.is_static != 0,
        github_token: token,
        env_file,
        proxy_labels: Some(labels),
        gpu_nvidia: project.gpu_nvidia != 0,
        gpu_dri: project.gpu_dri != 0,
        group_network: None,
        group_alias: None,
        // Les dossiers montés de la prod ne sont pas partagés (évite d'écrire dans ses données).
        volumes: Vec::new(),
        runtime: dev_runtime(
            &devforge_deploy::RuntimeSpec::from_json(&project.runtime_json).unwrap_or_default(),
        ),
    };
    let deploy = state.deploy.clone();
    let outcome = crate::deploy_queue::run_in_node_slot(
        &state.deploy_queue,
        &state.pool,
        &server_id,
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
                "deploy_dev",
                "cancelled",
                deployment_uuid,
                "superseded",
            )
            .await;
            state
                .deploy
                .abort_in_flight_swap(&instance, &server_id)
                .await;
            DeployRunOutcome {
                result: devforge_deploy::DeployResult {
                    ok: false,
                    git_sha: None,
                    logs: "[devforge] Déploiement dev annulé : remplacé par un plus récent\n"
                        .into(),
                },
                cancelled: true,
            }
        }
        crate::deploy_queue::SlotOutcome::Completed(mut result) => {
            crate::deploy_queue::record_event(
                &state.pool,
                &project.uuid,
                "deploy_dev",
                if result.ok { "success" } else { "failed" },
                deployment_uuid,
                result.git_sha.as_deref().unwrap_or(""),
            )
            .await;
            if result.ok {
                match crate::dns::sync_fqdn(state, &host, &server_id).await {
                    Ok(()) => result.logs.push_str(&format!("[dns] {host} OK\n")),
                    Err(e) => result.logs.push_str(&format!("[dns] {host} : {e}\n")),
                }
                result
                    .logs
                    .push_str(&format!("[devforge] DEV en ligne : https://{host}\n"));
            }
            DeployRunOutcome {
                result,
                cancelled: false,
            }
        }
    }
}

/// Arrête et supprime le conteneur dev (+ services, réseau, image), la route DNS
/// et annule les déploiements dev en cours. Ne touche jamais à la prod.
pub(crate) async fn teardown(state: &AppState, project: &Project) -> Value {
    // Annuler les builds dev encore actifs.
    let now = now_str();
    let active: Vec<(String,)> = sqlx::query_as(
        r#"UPDATE deployments
           SET status = 'cancelled',
               logs = COALESCE(logs, '') || $1,
               finished_at = $2,
               updated_at = $2
           WHERE project_id = $3 AND environment = 'dev'
             AND status IN ('queued', 'running', 'building', 'pending', 'deploying')
           RETURNING uuid"#,
    )
    .bind("\n[devforge] environnement dev désactivé\n")
    .bind(&now)
    .bind(project.id)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    for (u,) in &active {
        state.deploy_queue.signal_cancel(u).await;
    }

    let server = project
        .server_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("default")
        .to_string();
    let cmd = teardown_command(&project.uuid);
    let docker = match state.deploy.executor().exec(&server, "", &cmd, 120).await {
        Ok(r) => json!({"ok": r.ok, "exit_code": r.exit_code}),
        Err(e) => json!({"ok": false, "error": e.to_string()}),
    };

    let mut dns = Value::Null;
    if let Some(host) = dev_host_for(project) {
        crate::dns::remove_fqdn(state, &host).await;
        dns = json!({"removed": host});
    }
    json!({
        "cancelled_deployments": active.len(),
        "container": dev_container_name(&project.uuid),
        "docker": docker,
        "dns": dns,
    })
}

/// `docker rm -f` de toutes les instances `df-dv{10}*` (app, `-new`, services) + réseau + image.
pub fn teardown_command(project_uuid: &str) -> String {
    let name = dev_container_name(project_uuid);
    // Nom validé : `df-dv` + caractères d'UUID uniquement.
    let safe: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    let short = safe.trim_start_matches("df-");
    format!(
        "for c in $(docker ps -a --format '{{{{.Names}}}}' | grep -E '^{safe}(-|$)'); do docker rm -f \"$c\" >/dev/null 2>&1; done; \
         docker network rm dfside-{short} >/dev/null 2>&1; \
         docker rmi {safe}:latest >/dev/null 2>&1; true"
    )
}

/// Webhook push : déploie la dev des projets dont `dev_branch` correspond.
pub(crate) async fn on_push(
    state: &AppState,
    projects: &[Project],
    branch: &str,
    sha: Option<&str>,
    message: &str,
) -> Vec<Value> {
    let mut out = Vec::new();
    for project in projects {
        if project.auto_deploy == 0 {
            continue;
        }
        if project.dev_branch.as_deref() != Some(branch) {
            continue;
        }
        if dev_supported(project).is_err() {
            continue;
        }
        match start_dev_deploy(state, project, &format!("DEV · {message}"), sha).await {
            Ok(dep) => out.push(json!({
                "project": project.uuid,
                "deployment": dep,
                "environment": ENV_DEV,
            })),
            Err(e) => out.push(json!({
                "project": project.uuid,
                "environment": ENV_DEV,
                "ok": false,
                "error": e.message,
            })),
        }
    }
    out
}

async fn has_active_dev_deployment(state: &AppState, project_id: i64) -> bool {
    let cutoff = (chrono::Utc::now() - chrono::Duration::hours(1)).to_rfc3339();
    let row: Option<(i64,)> = sqlx::query_as(
        r#"SELECT COUNT(*) FROM deployments
           WHERE project_id = $1 AND environment = 'dev'
             AND status IN ('queued', 'running', 'building', 'pending', 'deploying')
             AND created_at > $2"#,
    )
    .bind(project_id)
    .bind(&cutoff)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    row.is_some_and(|(n,)| n > 0)
}

/// Filet du poller auto-deploy (webhook absent) : redéploie la dev en retard.
pub(crate) async fn poll_dev(state: &AppState, project: &Project) {
    let Some(branch) = project.dev_branch.as_deref().filter(|b| !b.is_empty()) else {
        return;
    };
    if project.auto_deploy == 0 || dev_supported(project).is_err() {
        return;
    }
    if has_active_dev_deployment(state, project.id).await {
        return;
    }
    let Some((owner, repo)) = project
        .git_repository
        .as_deref()
        .and_then(crate::infra_routes::parse_github_owner_repo)
    else {
        return;
    };
    let last: Option<(Option<String>,)> = sqlx::query_as(
        r#"SELECT git_sha FROM deployments
           WHERE project_id = $1 AND environment = 'dev' AND status = 'success'
           ORDER BY created_at DESC LIMIT 1"#,
    )
    .bind(project.id)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    // Jamais déployée avec succès : on n'insiste pas (le premier déploiement est explicite).
    let Some(base) = last
        .and_then(|(s,)| s)
        .filter(|s| !s.is_empty() && s != "pending" && s != "unknown")
    else {
        return;
    };
    let gh = crate::routes::project_github(state, &project.workspace_uuid).await;
    if let Ok(c) = gh.compare(&owner, &repo, &base, branch).await {
        if c.ahead_by > 0 {
            let tip = c
                .commits
                .last()
                .map(|c| c.sha.clone())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| c.head_sha.clone());
            if crate::auto_deploy_guard::gate(state, project, "dev", &tip).await
                != crate::auto_deploy_guard::Gate::Go
            {
                return;
            }
            let msg = format!("DEV · auto-deploy ({} commit(s))", c.ahead_by);
            if let Ok(dep) = start_dev_deploy(state, project, &msg, None).await {
                crate::auto_deploy_guard::set_target_sha(&state.pool, &dep, &tip).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_host_shared_zone_is_single_level() {
        assert_eq!(
            dev_fqdn("devforge-esp.jeser.app", Some("jeser.app")).as_deref(),
            Some("dev-devforge-esp.jeser.app")
        );
        assert_eq!(
            dev_fqdn("template-studio.jeser.app", None).as_deref(),
            Some("dev-template-studio.jeser.app")
        );
    }

    #[test]
    fn dev_host_apex_uses_dev_subdomain() {
        assert_eq!(
            dev_fqdn("example.com", None).as_deref(),
            Some("dev.example.com")
        );
        assert_eq!(
            dev_fqdn("www.example.com", None).as_deref(),
            Some("dev.example.com")
        );
        assert_eq!(
            dev_fqdn("shop.example.co", Some("shop.example.co")).as_deref(),
            Some("dev.shop.example.co")
        );
        assert_eq!(
            dev_fqdn("EXAMPLE.com.", None).as_deref(),
            Some("dev.example.com")
        );
    }

    #[test]
    fn dev_host_rejects_garbage() {
        assert_eq!(dev_fqdn("localhost", None), None);
        assert_eq!(dev_fqdn("a..b", None), None);
    }

    #[test]
    fn dev_instance_never_collides_with_prod_or_preview() {
        let uuid = "bba0bc75-1234-4abc-9def-001122334455";
        let dev = dev_container_name(uuid);
        assert_eq!(dev, "df-dvbba0bc75-1");
        assert_ne!(dev, devforge_deploy::project_container_name(uuid));
        assert_ne!(dev, devforge_deploy::docker::dev_container_name(uuid));
        assert!(!dev.starts_with("df-dev-"));
    }

    #[test]
    fn dev_workdir_is_separate() {
        assert_eq!(
            dev_workdir("/data/devforge/applications/abc/"),
            "/data/devforge/applications/abc-dev"
        );
        assert_eq!(dev_workdir(""), "");
    }

    #[test]
    fn dev_runtime_drops_host_ports() {
        let rt = devforge_deploy::RuntimeSpec::from_json(
            r#"{"memory":"512m","ports":[{"host":8443,"container":8443,"protocol":"tcp"}]}"#,
        )
        .unwrap_or_default();
        let dev = dev_runtime(&rt);
        assert!(dev.ports.is_empty());
        assert_eq!(dev.memory, rt.memory);
    }

    #[test]
    fn branch_names_are_validated() {
        assert_eq!(
            normalize_branch("refs/heads/feat/x").ok().as_deref(),
            Some("feat/x")
        );
        assert!(normalize_branch("main; rm -rf /").is_err());
        assert!(normalize_branch("-x").is_err());
        assert!(normalize_branch("a..b").is_err());
        assert!(normalize_branch("").is_err());
    }

    #[test]
    fn teardown_targets_only_dev_instance() {
        let cmd = teardown_command("bba0bc75-1234-4abc-9def-001122334455");
        assert!(cmd.contains("grep -E '^df-dvbba0bc75-1(-|$)'"));
        assert!(cmd.contains("{{.Names}}"));
        assert!(cmd.contains("docker rmi df-dvbba0bc75-1:latest"));
        assert!(!cmd.contains("df-bba0bc75"));
    }
}
