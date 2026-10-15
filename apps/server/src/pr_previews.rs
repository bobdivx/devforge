//! P5 — Previews de pull requests (GitHub App).
//!
//! `pull_request.opened|synchronize|reopened` sur un dépôt lié à l'installation ⇒ une
//! instance isolée par PR (`pv{hash10}` → conteneur `df-pv{hash10}`), publiée sur
//! `pr-<n>-<slug>.<zone de la prod>` (un seul niveau sous la zone : couvert par le
//! certificat de la zone, comme la dev). `synchronize` remplace le build en cours de la
//! même PR (environnement `preview-<n>`, concurrence 1 par PR). `closed` ⇒ nettoyage.
//!
//! Sécurité :
//! - PR de forks ignorées (code non fiable + variables du projet) : Check Run `neutral`.
//! - Les variables d'environnement de prod ne sont PAS injectées : seules celles marquées
//!   « preview » (`project_env_vars.preview = true`) le sont, plus `DEVFORGE_PREVIEW=1`.
//! - Ressources limitées (`DEVFORGE_PREVIEW_MEMORY`, défaut 1g ; `DEVFORGE_PREVIEW_CPUS`,
//!   défaut 1), pas de ports publiés sur l'hôte, pas de volumes de la prod.
//! - Commentaire PR unique par projet (marqueur caché), édité à chaque changement.

use std::sync::atomic::{AtomicI64, Ordering};

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post, put},
    Json, Router,
};
use devforge_github::checks::RepoApi;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::github_checks::{Final, Ids, Reporter};
use crate::routes::{auth_project, ApiError, DeployRunOutcome};
use crate::state::{new_uuid, now_str, AppState, Project};

pub const ENV_PREFIX: &str = "preview-";
pub const FORK_CHECK_NAME: &str = "DevForge / preview";
/// Previews inactives depuis plus longtemps ⇒ nettoyées par le rattrapage.
pub const TTL_DAYS: i64 = 7;
const SWEEP_EVERY_SECS: i64 = 3600;
static LAST_SWEEP: AtomicI64 = AtomicI64::new(0);

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/projects/{uuid}/previews", get(list))
        .route("/api/v1/projects/{uuid}/previews/settings", put(settings))
        .route(
            "/api/v1/projects/{uuid}/previews/{number}/redeploy",
            post(redeploy),
        )
        .route(
            "/api/v1/projects/{uuid}/previews/{number}",
            axum::routing::delete(remove),
        )
}

// ---------------------------------------------------------------------------
// Fonctions pures
// ---------------------------------------------------------------------------

/// Instance moteur (12 caractères : `pv` + 10 hex) — unique par (projet, PR).
pub fn preview_instance_id(project_uuid: &str, pr: i64) -> String {
    let h = Sha256::digest(format!("{project_uuid}#{pr}").as_bytes());
    let hex: String = h.iter().map(|b| format!("{b:02x}")).collect();
    format!("pv{}", &hex[..10])
}

pub fn preview_container_name(project_uuid: &str, pr: i64) -> String {
    devforge_deploy::project_container_name(&preview_instance_id(project_uuid, pr))
}

pub fn preview_environment(pr: i64) -> String {
    format!("{ENV_PREFIX}{pr}")
}

pub fn is_preview_env(environment: &str) -> bool {
    environment.starts_with(ENV_PREFIX)
}

/// Numéro de PR d'un environnement `preview-<n>`.
pub fn pr_of_env(environment: &str) -> Option<i64> {
    environment.strip_prefix(ENV_PREFIX)?.parse().ok()
}

/// Minuscules, `[a-z0-9-]`, sans tirets en bord ni doublés.
pub fn slugify(raw: &str) -> String {
    let mut out = String::new();
    for c in raw.trim().to_ascii_lowercase().chars() {
        let c = if c.is_ascii_alphanumeric() { c } else { '-' };
        if c == '-' && (out.is_empty() || out.ends_with('-')) {
            continue;
        }
        out.push(c);
    }
    out.trim_end_matches('-').to_string()
}

/// `pr-<n>-<slug>.<zone>` ; label ≤ 63 caractères, valide DNS.
pub fn preview_fqdn(prod_fqdn: &str, apex: Option<&str>, pr: i64, slug: &str) -> Option<String> {
    let host = prod_fqdn.trim().trim_end_matches('.').to_ascii_lowercase();
    let labels: Vec<&str> = host.split('.').collect();
    if labels.len() < 2 || labels.iter().any(|l| l.is_empty()) || pr <= 0 {
        return None;
    }
    let apex = apex
        .map(|a| a.trim().trim_end_matches('.').to_ascii_lowercase())
        .filter(|a| !a.is_empty());
    let zone = if labels.len() == 2 || apex.as_deref() == Some(host.as_str()) {
        host.clone()
    } else {
        labels[1..].join(".")
    };
    let prefix = format!("pr-{pr}-");
    let mut s = slugify(slug);
    if s.is_empty() {
        s = slugify(labels[0]);
    }
    let room = 63usize.saturating_sub(prefix.len());
    let s: String = s.chars().take(room).collect();
    let label = format!("{prefix}{}", s.trim_end_matches('-'));
    let label = label.trim_end_matches('-').to_string();
    Some(format!("{label}.{zone}"))
}

pub fn preview_host_for(project: &Project, pr: i64) -> Option<String> {
    let fqdn = project
        .production_url
        .as_deref()
        .and_then(crate::routes::fqdn_from_url)?;
    let apex = Some(project.domain_apex.as_str()).filter(|a| !a.trim().is_empty());
    let slug = if project.slug.trim().is_empty() {
        project.name.as_str()
    } else {
        project.slug.as_str()
    };
    preview_fqdn(&fqdn, apex, pr, slug)
}

pub fn marker(project_uuid: &str) -> String {
    format!("<!-- devforge-preview:{project_uuid} -->")
}

/// Heure de Paris lisible (`15/10 10:42`).
pub fn paris_time(at: chrono::DateTime<chrono::Utc>) -> String {
    at.with_timezone(&chrono_tz::Europe::Paris)
        .format("%d/%m %H:%M")
        .to_string()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommentView {
    pub project_name: String,
    pub status: String,
    pub url: Option<String>,
    pub sha: String,
    pub updated: String,
}

pub fn status_label(status: &str) -> &'static str {
    match status {
        "queued" => "⏳ En file",
        "building" => "🔨 Build en cours",
        "ready" => "✅ Prête",
        "failed" => "❌ Échec",
        "cancelled" => "⏹️ Annulée",
        "deleted" => "🗑️ Preview supprimée",
        _ => "…",
    }
}

/// Corps du commentaire unique (marqueur + tableau Markdown).
pub fn comment_body(project_uuid: &str, v: &CommentView) -> String {
    let url = match (&v.url, v.status.as_str()) {
        (_, "deleted") => "—".to_string(),
        (Some(u), "ready") => format!("[{u}]({u})"),
        (Some(u), _) => format!("`{u}`"),
        (None, _) => "—".to_string(),
    };
    let sha: String = v.sha.chars().take(7).collect();
    let name = v.project_name.replace('|', "\\|");
    format!(
        "{}\n**DevForge — preview**\n\n| Projet | Statut | Preview | Commit | Mis à jour (heure Paris) |\n|---|---|---|---|---|\n| {} | {} | {} | `{}` | {} |\n",
        marker(project_uuid),
        name,
        status_label(&v.status),
        url,
        sha,
        v.updated
    )
}

/// PR provenant d'un autre dépôt (fork) — ou dépôt de tête supprimé.
pub fn is_fork(payload: &Value) -> bool {
    let head = payload
        .pointer("/pull_request/head/repo/id")
        .and_then(Value::as_i64);
    let base = payload
        .pointer("/pull_request/base/repo/id")
        .and_then(Value::as_i64)
        .or_else(|| payload.pointer("/repository/id").and_then(Value::as_i64));
    match (head, base) {
        (Some(h), Some(b)) => h != b,
        _ => true,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PrAction {
    Deploy {
        number: i64,
        head_sha: String,
        head_ref: String,
    },
    Close {
        number: i64,
    },
    Fork {
        number: i64,
        head_sha: String,
    },
    Ignore,
}

pub fn classify(action: &str, payload: &Value) -> PrAction {
    let Some(number) = payload
        .pointer("/pull_request/number")
        .or_else(|| payload.get("number"))
        .and_then(Value::as_i64)
    else {
        return PrAction::Ignore;
    };
    let head_sha = payload
        .pointer("/pull_request/head/sha")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let head_ref = payload
        .pointer("/pull_request/head/ref")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    match action {
        "closed" => PrAction::Close { number },
        "opened" | "synchronize" | "reopened" => {
            let sha_ok = head_sha.len() == 40 && head_sha.chars().all(|c| c.is_ascii_hexdigit());
            if !sha_ok || head_ref.is_empty() {
                PrAction::Ignore
            } else if is_fork(payload) {
                PrAction::Fork { number, head_sha }
            } else {
                PrAction::Deploy {
                    number,
                    head_sha,
                    head_ref,
                }
            }
        }
        _ => PrAction::Ignore,
    }
}

/// Ressources d'une preview : ports hôte retirés, mémoire/CPU plafonnés.
pub fn preview_runtime(
    prod: &devforge_deploy::RuntimeSpec,
    memory: &str,
    cpus: &str,
) -> devforge_deploy::RuntimeSpec {
    let mut rt = crate::dev_env::dev_runtime(prod);
    rt.memory = Some(memory.to_string());
    rt.cpus = Some(cpus.to_string());
    rt
}

/// `docker rm -f` de l'instance (app, `-new`, services) + réseau + image.
pub fn teardown_command(project_uuid: &str, pr: i64) -> String {
    let name = preview_container_name(project_uuid, pr);
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

// ---------------------------------------------------------------------------
// Persistance
// ---------------------------------------------------------------------------

pub async fn migrate(pool: &sqlx::PgPool) -> Result<(), sqlx::Error> {
    for sql in [
        "ALTER TABLE pr_previews ADD COLUMN head_ref TEXT",
        "ALTER TABLE pr_previews ADD COLUMN github_deployment_id BIGINT",
        "ALTER TABLE project_env_vars ADD COLUMN preview BOOLEAN NOT NULL DEFAULT false",
    ] {
        let _ = sqlx::query(sql).execute(pool).await;
    }
    Ok(())
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PreviewRow {
    pub project_uuid: String,
    pub pr_number: i32,
    pub head_sha: String,
    pub head_ref: Option<String>,
    pub url: Option<String>,
    pub deployment_uuid: Option<String>,
    pub comment_id: Option<i64>,
    pub check_run_id: Option<i64>,
    pub github_deployment_id: Option<i64>,
    pub status: String,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

const COLS: &str = "project_uuid, pr_number, head_sha, head_ref, url, deployment_uuid, comment_id, check_run_id, github_deployment_id, status, updated_at";

async fn get_row(pool: &sqlx::PgPool, project_uuid: &str, pr: i64) -> Option<PreviewRow> {
    sqlx::query_as::<_, PreviewRow>(&format!(
        "SELECT {COLS} FROM pr_previews WHERE project_uuid = $1 AND pr_number = $2"
    ))
    .bind(project_uuid)
    .bind(pr as i32)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
}

async fn set_status(pool: &sqlx::PgPool, project_uuid: &str, pr: i64, status: &str) {
    let _ = sqlx::query(
        "UPDATE pr_previews SET status = $1, updated_at = now() WHERE project_uuid = $2 AND pr_number = $3",
    )
    .bind(status)
    .bind(project_uuid)
    .bind(pr as i32)
    .execute(pool)
    .await;
}

/// Variables marquées « preview » uniquement (jamais les secrets de prod par défaut).
pub async fn load_preview_env_file(
    pool: &sqlx::PgPool,
    project_uuid: &str,
    pr: i64,
    url: &str,
) -> Option<String> {
    let mut rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT key, value FROM project_env_vars WHERE project_uuid = $1 AND preview = true ORDER BY key",
    )
    .bind(project_uuid)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    rows.retain(|(k, _)| !k.starts_with("DEVFORGE_PREVIEW"));
    rows.push(("DEVFORGE_PREVIEW".into(), "1".into()));
    rows.push(("DEVFORGE_PREVIEW_PR".into(), pr.to_string()));
    rows.push(("DEVFORGE_PREVIEW_URL".into(), url.to_string()));
    Some(devforge_env::serialize_docker_env_file(&rows))
}

/// Projets liés à l'installation et au dépôt de l'événement, previews activées.
async fn target_projects(
    pool: &sqlx::PgPool,
    installation_id: i64,
    payload: &Value,
) -> Vec<Project> {
    let Some(repo_id) = payload.pointer("/repository/id").and_then(Value::as_i64) else {
        return Vec::new();
    };
    sqlx::query_as::<_, Project>(
        "SELECT * FROM projects WHERE github_installation_id = $1 AND github_repo_id = $2 AND pr_previews_enabled = true",
    )
    .bind(installation_id)
    .bind(repo_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// GitHub (commentaire, check, deployment)
// ---------------------------------------------------------------------------

async fn reporter_for(
    state: &AppState,
    project: &Project,
    pr: i64,
    url: Option<String>,
) -> Option<Reporter> {
    let dep = new_uuid();
    let mut r = crate::github_checks::resolve(state, project, &dep).await?;
    let base = instance_base(&r.details_url);
    if r.details_url.is_some() {
        r.details_url = Some(format!(
            "{base}/app/projects/view?uuid={}&tab=previews",
            project.uuid
        ));
    }
    r.environment = format!("Preview PR #{pr}");
    r.environment_url = url;
    Some(r)
}

fn instance_base(details: &Option<String>) -> String {
    details
        .as_deref()
        .and_then(|d| d.split("/app/").next())
        .unwrap_or("")
        .to_string()
}

/// Crée ou édite le commentaire unique ; retrouvé par marqueur si l'id est perdu.
async fn upsert_comment(
    api: &RepoApi,
    project_uuid: &str,
    pr: i64,
    known: Option<i64>,
    body: &str,
) -> Option<i64> {
    if let Some(id) = known {
        if api.update_issue_comment(id, body).await.is_ok() {
            return Some(id);
        }
    }
    let mark = marker(project_uuid);
    for page in 1..=10u32 {
        let Ok(list) = api.list_issue_comments(pr, page).await else {
            break;
        };
        if let Some(id) = list
            .iter()
            .find(|c| {
                c.get("body")
                    .and_then(Value::as_str)
                    .is_some_and(|b| b.contains(&mark))
            })
            .and_then(|c| c.get("id").and_then(Value::as_i64))
        {
            return api.update_issue_comment(id, body).await.ok().map(|_| id);
        }
        if list.len() < 100 {
            break;
        }
    }
    match api.create_issue_comment(pr, body).await {
        Ok(id) => Some(id),
        Err(e) => {
            tracing::warn!(project = %project_uuid, pr, "commentaire preview : {e}");
            None
        }
    }
}

async fn refresh_comment(state: &AppState, project: &Project, api: &RepoApi, pr: i64) {
    let Some(row) = get_row(&state.pool, &project.uuid, pr).await else {
        return;
    };
    let view = CommentView {
        project_name: project.name.clone(),
        status: row.status.clone(),
        url: row.url.clone(),
        sha: row.head_sha.clone(),
        updated: paris_time(chrono::Utc::now()),
    };
    let body = comment_body(&project.uuid, &view);
    if let Some(id) = upsert_comment(api, &project.uuid, pr, row.comment_id, &body).await {
        if Some(id) != row.comment_id {
            let _ = sqlx::query(
                "UPDATE pr_previews SET comment_id = $1 WHERE project_uuid = $2 AND pr_number = $3",
            )
            .bind(id)
            .bind(&project.uuid)
            .bind(pr as i32)
            .execute(&state.pool)
            .await;
        }
    }
}

// ---------------------------------------------------------------------------
// Événements
// ---------------------------------------------------------------------------

/// Point d'entrée du webhook app-level (`pull_request`).
pub async fn handle_pull_request(
    state: &AppState,
    installation_id: i64,
    action: &str,
    payload: &Value,
) -> Result<&'static str, String> {
    let act = classify(action, payload);
    if act == PrAction::Ignore {
        return Ok("ignored");
    }
    let projects = target_projects(&state.pool, installation_id, payload).await;
    if projects.is_empty() {
        return Ok("no_project");
    }
    for project in projects {
        match &act {
            PrAction::Deploy {
                number,
                head_sha,
                head_ref,
            } => {
                if let Err(e) = start_preview(state, &project, *number, head_sha, head_ref).await {
                    tracing::warn!(project = %project.uuid, pr = number, "preview : {e}");
                }
            }
            PrAction::Fork { number, head_sha } => {
                if let Some(r) = reporter_for(state, &project, *number, None).await {
                    let _ = r
                        .api
                        .completed_check_run(
                            FORK_CHECK_NAME,
                            head_sha,
                            "neutral",
                            "Previews désactivées pour les forks",
                            "Le code d’une PR de fork n’est pas exécuté par DevForge (il aurait accès aux ressources du projet).",
                        )
                        .await;
                }
            }
            PrAction::Close { number } => {
                teardown(state, &project, *number, "PR fermée").await;
            }
            PrAction::Ignore => {}
        }
    }
    Ok(match act {
        PrAction::Fork { .. } => "fork_skipped",
        PrAction::Close { .. } => "preview_removed",
        _ => "preview_queued",
    })
}

/// Upsert de la preview + déploiement détaché du `head_sha`.
pub async fn start_preview(
    state: &AppState,
    project: &Project,
    pr: i64,
    head_sha: &str,
    head_ref: &str,
) -> Result<String, String> {
    if project.build_pack == "dockercompose" {
        return Err("previews indisponibles pour les projets docker compose".into());
    }
    let host =
        preview_host_for(project, pr).ok_or("URL de production absente : pas d’hôte preview")?;
    let url = format!("https://{host}");
    sqlx::query(
        r#"INSERT INTO pr_previews (project_uuid, pr_number, head_sha, head_ref, url, status, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'queued', now())
           ON CONFLICT (project_uuid, pr_number) DO UPDATE
             SET head_sha = EXCLUDED.head_sha, head_ref = EXCLUDED.head_ref,
                 url = EXCLUDED.url, status = 'queued', updated_at = now()"#,
    )
    .bind(&project.uuid)
    .bind(pr as i32)
    .bind(head_sha)
    .bind(head_ref)
    .bind(&url)
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;

    let dep_uuid = new_uuid();
    let now = now_str();
    sqlx::query(
        r#"INSERT INTO deployments (
            uuid, project_id, status, git_sha, git_message, logs, finished_at, created_at, updated_at, environment
        ) VALUES ($1, $2, 'queued', $3, $4, $5, NULL, $6, $7, $8)"#,
    )
    .bind(&dep_uuid)
    .bind(project.id)
    .bind(head_sha.chars().take(12).collect::<String>())
    .bind(format!("Preview PR #{pr}"))
    .bind(format!("[devforge] preview PR #{pr} — démarrage…\n"))
    .bind(&now)
    .bind(&now)
    .bind(preview_environment(pr))
    .execute(&state.pool)
    .await
    .map_err(|e| e.to_string())?;
    let _ = sqlx::query(
        "UPDATE pr_previews SET deployment_uuid = $1 WHERE project_uuid = $2 AND pr_number = $3",
    )
    .bind(&dep_uuid)
    .bind(&project.uuid)
    .bind(pr as i32)
    .execute(&state.pool)
    .await;

    let (st, p, d, sha, r, u) = (
        state.clone(),
        project.clone(),
        dep_uuid.clone(),
        head_sha.to_string(),
        head_ref.to_string(),
        url,
    );
    tokio::spawn(async move {
        finish_preview(&st, &p, pr, &d, &sha, &r, &u).await;
    });
    Ok(dep_uuid)
}

async fn finish_preview(
    state: &AppState,
    project: &Project,
    pr: i64,
    dep_uuid: &str,
    head_sha: &str,
    head_ref: &str,
    url: &str,
) {
    let reporter = reporter_for(state, project, pr, Some(url.to_string())).await;
    let mut ids = Ids::default();
    if let Some(r) = &reporter {
        refresh_comment(state, project, &r.api, pr).await;
        ids = r.queued(head_sha, dep_uuid).await;
        let _ = sqlx::query(
            "UPDATE pr_previews SET check_run_id = $1, github_deployment_id = $2 WHERE project_uuid = $3 AND pr_number = $4",
        )
        .bind(ids.check_run_id)
        .bind(ids.deployment_id)
        .bind(&project.uuid)
        .bind(pr as i32)
        .execute(&state.pool)
        .await;
        r.in_progress(&ids).await;
    }
    set_status(&state.pool, &project.uuid, pr, "building").await;

    let outcome = run_preview_deploy(state, project, pr, dep_uuid, head_sha, head_ref, url).await;
    let result = &outcome.result;
    let sha = result
        .git_sha
        .clone()
        .unwrap_or_else(|| head_sha.chars().take(12).collect());
    let (status, row_status) = if outcome.cancelled {
        ("cancelled", None)
    } else if result.ok {
        ("success", Some("ready"))
    } else {
        ("failed", Some("failed"))
    };
    let summary = (!result.ok && !outcome.cancelled).then(|| {
        devforge_deploy::parse_deploy_error_fr(&result.logs)
            .map(|e| e.summary)
            .unwrap_or_else(|| "Échec de la preview".into())
    });
    let _ = crate::deploy_queue::finalize_if_active(
        &state.pool,
        dep_uuid,
        status,
        &sha,
        &result.logs,
        summary.as_deref(),
        None,
        None,
    )
    .await;
    if outcome.cancelled {
        // Remplacé par un build plus récent de la même PR : il reprend la main.
        if let (Some(r), true) = (
            &reporter,
            ids.check_run_id.is_some() || ids.deployment_id.is_some(),
        ) {
            r.finish(&ids, &Final::Cancelled).await;
        }
        return;
    }
    if result.ok {
        if let Err(e) = state.proxy.ensure_traefik().await {
            tracing::error!(error = %e, project = %project.uuid, "preview : ensure Traefik");
        }
    }
    if let Some(s) = row_status {
        set_status(&state.pool, &project.uuid, pr, s).await;
    }
    if let Some(r) = &reporter {
        let fin = if result.ok {
            Final::Success {
                summary: format!("Preview en ligne : {url}"),
            }
        } else {
            crate::github_checks::failure_output(&result.logs, &[])
        };
        r.finish(&ids, &fin).await;
        refresh_comment(state, project, &r.api, pr).await;
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_preview_deploy(
    state: &AppState,
    project: &Project,
    pr: i64,
    deployment_uuid: &str,
    head_sha: &str,
    head_ref: &str,
    url: &str,
) -> DeployRunOutcome {
    let instance = preview_instance_id(&project.uuid, pr);
    let fail = |msg: String| DeployRunOutcome {
        result: devforge_deploy::DeployResult {
            ok: false,
            git_sha: None,
            logs: format!("[devforge] {msg}\n"),
        },
        cancelled: false,
    };
    let Some(host) = crate::routes::fqdn_from_url(url) else {
        return fail("URL de preview invalide".into());
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
    let pat: Option<String> =
        sqlx::query_as::<_, (String,)>("SELECT github_token FROM instance_settings WHERE id = 1")
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten()
            .map(|(t,)| crate::secret_box::open_compat(&t))
            .filter(|t| !t.trim().is_empty());
    let deploy_tok = crate::github_auth::deploy_token(state, &project.uuid, pat).await;
    let env_file = load_preview_env_file(&state.pool, &project.uuid, pr, url).await;
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
    let memory = std::env::var("DEVFORGE_PREVIEW_MEMORY").unwrap_or_else(|_| "1g".into());
    let cpus = std::env::var("DEVFORGE_PREVIEW_CPUS").unwrap_or_else(|_| "1".into());
    let req = devforge_deploy::DeployRequest {
        project_uuid: instance.clone(),
        server_id: server_id.clone(),
        // Vide → `data/applications/{instance}` : jamais le checkout de la prod.
        workdir: String::new(),
        git_repository: project.git_repository.clone().unwrap_or_default(),
        git_branch: head_ref.to_string(),
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
        github_token: deploy_tok.token,
        github_token_ephemeral: deploy_tok.ephemeral,
        pin_sha: Some(head_sha.to_string()),
        env_file,
        proxy_labels: Some(labels),
        gpu_nvidia: false,
        gpu_dri: false,
        group_network: None,
        group_alias: None,
        volumes: Vec::new(),
        runtime: preview_runtime(
            &devforge_deploy::RuntimeSpec::from_json(&project.runtime_json).unwrap_or_default(),
            &memory,
            &cpus,
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
            state
                .deploy
                .abort_in_flight_swap(&instance, &server_id)
                .await;
            DeployRunOutcome {
                result: devforge_deploy::DeployResult {
                    ok: false,
                    git_sha: None,
                    logs: "[devforge] Preview annulée : remplacée par un build plus récent\n"
                        .into(),
                },
                cancelled: true,
            }
        }
        crate::deploy_queue::SlotOutcome::Completed(mut result) => {
            if result.ok {
                match crate::dns::sync_fqdn(state, &host, &server_id).await {
                    Ok(()) => result.logs.push_str(&format!("[dns] {host} OK\n")),
                    Err(e) => result.logs.push_str(&format!("[dns] {host} : {e}\n")),
                }
                result
                    .logs
                    .push_str(&format!("[devforge] Preview en ligne : https://{host}\n"));
            }
            DeployRunOutcome {
                result,
                cancelled: false,
            }
        }
    }
}

/// Supprime conteneur + route DNS, deployment `inactive`, commentaire « Preview supprimée ».
pub async fn teardown(state: &AppState, project: &Project, pr: i64, reason: &str) -> Value {
    let now = now_str();
    let active: Vec<(String,)> = sqlx::query_as(
        r#"UPDATE deployments
           SET status = 'cancelled', logs = COALESCE(logs, '') || $1, finished_at = $2, updated_at = $2
           WHERE project_id = $3 AND environment = $4
             AND status IN ('queued', 'running', 'building', 'pending', 'deploying')
           RETURNING uuid"#,
    )
    .bind(format!("\n[devforge] preview supprimée ({reason})\n"))
    .bind(&now)
    .bind(project.id)
    .bind(preview_environment(pr))
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
    let docker = match state
        .deploy
        .executor()
        .exec(&server, "", &teardown_command(&project.uuid, pr), 120)
        .await
    {
        Ok(r) => json!({"ok": r.ok}),
        Err(e) => json!({"ok": false, "error": e.to_string()}),
    };
    let row = get_row(&state.pool, &project.uuid, pr).await;
    let host = row
        .as_ref()
        .and_then(|r| r.url.as_deref())
        .and_then(crate::routes::fqdn_from_url)
        .or_else(|| preview_host_for(project, pr));
    if let Some(h) = &host {
        crate::dns::remove_fqdn(state, h).await;
    }
    if row.is_some() {
        set_status(&state.pool, &project.uuid, pr, "deleted").await;
        if let Some(r) = reporter_for(state, project, pr, None).await {
            if let Some(dep) = row.as_ref().and_then(|r| r.github_deployment_id) {
                let _ = r
                    .api
                    .create_deployment_status(dep, "inactive", None, None)
                    .await;
            }
            refresh_comment(state, project, &r.api, pr).await;
        }
    }
    json!({"cancelled_deployments": active.len(), "docker": docker, "host": host})
}

/// Rattrapage (au plus 1×/h depuis `auto_deploy::tick`) : PR fermées ou previews
/// inactives depuis plus de 7 jours ⇒ nettoyage.
pub async fn sweep(state: &AppState) {
    let now = chrono::Utc::now().timestamp();
    let last = LAST_SWEEP.load(Ordering::Relaxed);
    if now - last < SWEEP_EVERY_SECS {
        return;
    }
    LAST_SWEEP.store(now, Ordering::Relaxed);
    let rows: Vec<PreviewRow> = sqlx::query_as(&format!(
        "SELECT {COLS} FROM pr_previews WHERE status <> 'deleted'"
    ))
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    for row in rows {
        let Some(project) = crate::wake_gate::project_by_uuid(state, &row.project_uuid).await
        else {
            let _ = sqlx::query("UPDATE pr_previews SET status = 'deleted' WHERE project_uuid = $1 AND pr_number = $2")
                .bind(&row.project_uuid)
                .bind(row.pr_number)
                .execute(&state.pool)
                .await;
            continue;
        };
        let pr = row.pr_number as i64;
        let stale = chrono::Utc::now() - row.updated_at > chrono::Duration::days(TTL_DAYS);
        let closed = match reporter_for(state, &project, pr, None).await {
            Some(r) => r
                .api
                .pull_state(pr)
                .await
                .map(|s| s == "closed")
                .unwrap_or(false),
            None => false,
        };
        if stale || closed {
            teardown(
                state,
                &project,
                pr,
                if closed {
                    "PR fermée"
                } else {
                    "inactive > 7 j"
                },
            )
            .await;
        }
    }
}

// ---------------------------------------------------------------------------
// API (onglet « Previews »)
// ---------------------------------------------------------------------------

async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (_u, _w, project) = auth_project(&state, &headers, &uuid).await?;
    let enabled: bool =
        sqlx::query_as::<_, (bool,)>("SELECT pr_previews_enabled FROM projects WHERE uuid = $1")
            .bind(&project.uuid)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten()
            .map(|(b,)| b)
            .unwrap_or(false);
    let linked: bool = sqlx::query_as::<_, (Option<i64>,)>(
        "SELECT github_installation_id FROM projects WHERE uuid = $1",
    )
    .bind(&project.uuid)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten()
    .and_then(|(i,)| i)
    .is_some();
    let rows: Vec<PreviewRow> = sqlx::query_as(&format!(
        "SELECT {COLS} FROM pr_previews WHERE project_uuid = $1 ORDER BY updated_at DESC LIMIT 100"
    ))
    .bind(&project.uuid)
    .fetch_all(&state.pool)
    .await
    .map_err(ApiError::from)?;
    let previews: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "pr_number": r.pr_number,
                "head_sha": r.head_sha,
                "head_ref": r.head_ref,
                "url": r.url,
                "status": r.status,
                "deployment_uuid": r.deployment_uuid,
                "check_run_id": r.check_run_id,
                "updated_at": r.updated_at.to_rfc3339(),
            })
        })
        .collect();
    Ok(Json(json!({
        "ok": true,
        "enabled": enabled,
        "linked": linked,
        "previews": previews,
    })))
}

#[derive(Deserialize)]
struct SettingsBody {
    enabled: bool,
}

async fn settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<SettingsBody>,
) -> Result<Json<Value>, ApiError> {
    let (_u, _w, project) = auth_project(&state, &headers, &uuid).await?;
    sqlx::query("UPDATE projects SET pr_previews_enabled = $1 WHERE uuid = $2")
        .bind(body.enabled)
        .bind(&project.uuid)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(json!({"ok": true, "enabled": body.enabled})))
}

async fn redeploy(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, number)): Path<(String, i64)>,
) -> Result<Json<Value>, ApiError> {
    let (_u, _w, project) = auth_project(&state, &headers, &uuid).await?;
    let row = get_row(&state.pool, &project.uuid, number)
        .await
        .ok_or_else(|| ApiError::message("Preview introuvable."))?;
    let head_ref = row
        .head_ref
        .clone()
        .filter(|r| !r.is_empty())
        .ok_or_else(|| ApiError::message("Branche de la PR inconnue."))?;
    let dep = start_preview(&state, &project, number, &row.head_sha, &head_ref)
        .await
        .map_err(ApiError::message)?;
    Ok(Json(json!({"ok": true, "deployment_uuid": dep})))
}

async fn remove(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, number)): Path<(String, i64)>,
) -> Result<Json<Value>, ApiError> {
    let (_u, _w, project) = auth_project(&state, &headers, &uuid).await?;
    if get_row(&state.pool, &project.uuid, number).await.is_none() {
        return Err(ApiError::message("Preview introuvable."));
    }
    let res = teardown(&state, &project, number, "supprimée depuis DevForge").await;
    Ok(Json(json!({"ok": true, "result": res})))
}

#[cfg(test)]
#[path = "pr_previews_tests.rs"]
mod tests;
