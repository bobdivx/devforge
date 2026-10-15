//! P7 — Migration des projets « PAT + webhook par dépôt » vers la GitHub App, rotation du
//! secret webhook, limitation de débit des webhooks.
//!
//! `POST /api/v1/github-app/migrate` est en **dry-run par défaut** : il calcule le rapport
//! « couvert / non couvert » sans aucun appel destructeur. En mode réel (`dry_run=false`),
//! pour chaque projet couvert : liaison à l'installation, puis suppression du webhook par
//! dépôt créé par DevForge (filtré sur l'URL de rappel, via le PAT encore présent) après
//! enregistrement de `legacy_webhook_id` (rollback : `POST /api/v1/github-app/migrate/rollback`).

use std::sync::Mutex;

use axum::{extract::State, http::HeaderMap, routing::post, Json, Router};
use devforge_github::checks::RepoApi;
use rand::RngCore;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::github_app_routes::{db_err, err, require_admin, ApiErr};
use crate::state::{now_str, AppState};
use axum::http::StatusCode;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/github-app/migrate", post(migrate))
        .route("/api/v1/github-app/migrate/rollback", post(rollback))
        .route(
            "/api/v1/github-app/rotate-webhook-secret",
            post(rotate_webhook_secret),
        )
        .route("/api/v1/github-app/retire-legacy", post(retire_legacy))
}

// ───────────────────── Rapport (pur) ─────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectRepo {
    pub uuid: String,
    pub name: String,
    pub git_repository: Option<String>,
    pub installation_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CachedRepo {
    pub installation_id: i64,
    pub repo_id: i64,
    pub full_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Coverage {
    AlreadyLinked { installation_id: i64 },
    Covered { installation_id: i64, repo_id: i64 },
    NotCovered { full_name: String },
    NotGithub,
}

pub fn coverage(p: &ProjectRepo, cache: &[CachedRepo]) -> Coverage {
    if let Some(i) = p.installation_id {
        return Coverage::AlreadyLinked { installation_id: i };
    }
    let Some((o, r)) = p
        .git_repository
        .as_deref()
        .and_then(devforge_github::checks::parse_repo)
    else {
        return Coverage::NotGithub;
    };
    let full = format!("{o}/{r}");
    match cache
        .iter()
        .find(|c| c.full_name.eq_ignore_ascii_case(&full))
    {
        Some(c) => Coverage::Covered {
            installation_id: c.installation_id,
            repo_id: c.repo_id,
        },
        None => Coverage::NotCovered { full_name: full },
    }
}

pub fn coverage_json(p: &ProjectRepo, c: &Coverage) -> Value {
    let (status, extra) = match c {
        Coverage::AlreadyLinked { installation_id } => {
            ("linked", json!({"installation_id": installation_id}))
        }
        Coverage::Covered {
            installation_id,
            repo_id,
        } => (
            "covered",
            json!({"installation_id": installation_id, "repo_id": repo_id}),
        ),
        Coverage::NotCovered { full_name } => (
            "not_covered",
            json!({"repo": full_name, "action": "Installer l’app GitHub sur ce dépôt"}),
        ),
        Coverage::NotGithub => ("not_github", json!({})),
    };
    let mut v = json!({"project_uuid": p.uuid, "name": p.name, "status": status});
    if let (Some(o), Some(e)) = (v.as_object_mut(), extra.as_object()) {
        for (k, val) in e {
            o.insert(k.clone(), val.clone());
        }
    }
    v
}

/// Webhooks DevForge d'un dépôt : URL de rappel identique (sans `/` final).
pub fn legacy_hook_ids(hooks: &[(i64, String)], callback: &str) -> Vec<i64> {
    let want = callback.trim_end_matches('/');
    hooks
        .iter()
        .filter(|(_, u)| u.trim_end_matches('/') == want)
        .map(|(id, _)| *id)
        .collect()
}

async fn load_projects(pool: &PgPool) -> Result<Vec<ProjectRepo>, sqlx::Error> {
    let rows: Vec<(String, String, Option<String>, Option<i64>)> = sqlx::query_as(
        "SELECT uuid, name, git_repository, github_installation_id FROM projects ORDER BY name",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(uuid, name, git_repository, installation_id)| ProjectRepo {
                uuid,
                name,
                git_repository,
                installation_id,
            },
        )
        .collect())
}

async fn load_cache(pool: &PgPool) -> Result<Vec<CachedRepo>, sqlx::Error> {
    let rows: Vec<(i64, i64, String)> = sqlx::query_as(
        "SELECT r.installation_id, r.repo_id, r.full_name FROM github_installation_repos r JOIN github_installations i USING (installation_id) WHERE i.suspended_at IS NULL",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(installation_id, repo_id, full_name)| CachedRepo {
            installation_id,
            repo_id,
            full_name,
        })
        .collect())
}

async fn instance_pat(pool: &PgPool) -> String {
    sqlx::query_as::<_, (String,)>("SELECT github_token FROM instance_settings WHERE id = 1")
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .map(|(t,)| crate::secret_box::open_compat(&t))
        .unwrap_or_default()
}

#[derive(Deserialize, Default)]
struct MigrateBody {
    /// Défaut : `true` (aucune modification).
    dry_run: Option<bool>,
    /// Restreindre à ces projets (défaut : tous les projets couverts).
    project_uuids: Option<Vec<String>>,
}

async fn migrate(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Option<Json<MigrateBody>>,
) -> Result<Json<Value>, ApiErr> {
    require_admin(&state, &headers).await?;
    let body = body.map(|Json(b)| b).unwrap_or_default();
    let dry_run = body.dry_run.unwrap_or(true);
    let projects = load_projects(&state.pool).await.map_err(db_err)?;
    let cache = load_cache(&state.pool).await.map_err(db_err)?;
    let mut report = Vec::new();
    let mut migrated = 0usize;
    let callback = crate::auto_deploy::instance_public_url(&state)
        .await
        .map(|u| crate::auto_deploy::webhook_callback_url(&u));
    let pat = instance_pat(&state.pool).await;
    for p in &projects {
        let cov = coverage(p, &cache);
        let mut item = coverage_json(p, &cov);
        let selected = body
            .project_uuids
            .as_ref()
            .is_none_or(|l| l.contains(&p.uuid));
        if let (
            false,
            true,
            Coverage::Covered {
                installation_id,
                repo_id,
            },
        ) = (dry_run, selected, &cov)
        {
            let mut deleted = Vec::new();
            let mut hook_error = None;
            let (o, r) = p
                .git_repository
                .as_deref()
                .and_then(devforge_github::checks::parse_repo)
                .unwrap_or_default();
            let mut legacy_id: Option<i64> = None;
            if let (Some(cb), false) = (&callback, pat.trim().is_empty()) {
                let api = RepoApi::new(crate::github_app_routes::api_base(), &pat, &o, &r);
                match api.list_hooks().await {
                    Ok(hooks) => {
                        let ids = legacy_hook_ids(&hooks, cb);
                        legacy_id = ids.first().copied();
                        // Enregistré AVANT suppression (rollback).
                        let _ = sqlx::query(
                            "UPDATE projects SET legacy_webhook_id = COALESCE($1, legacy_webhook_id) WHERE uuid = $2",
                        )
                        .bind(legacy_id)
                        .bind(&p.uuid)
                        .execute(&state.pool)
                        .await;
                        for id in ids {
                            match api.delete_hook(id).await {
                                Ok(()) => deleted.push(id),
                                Err(e) => hook_error = Some(e),
                            }
                        }
                    }
                    Err(e) => hook_error = Some(e),
                }
            }
            sqlx::query(
                "UPDATE projects SET github_installation_id = $1, github_repo_id = $2, updated_at = $3 WHERE uuid = $4",
            )
            .bind(installation_id)
            .bind(repo_id)
            .bind(now_str())
            .bind(&p.uuid)
            .execute(&state.pool)
            .await
            .map_err(db_err)?;
            migrated += 1;
            item["migrated"] = json!(true);
            item["legacy_webhook_id"] = json!(legacy_id);
            item["deleted_hooks"] = json!(deleted);
            if let Some(e) = hook_error {
                item["hook_error"] = json!(e);
            }
        }
        report.push(item);
    }
    let not_covered = report
        .iter()
        .filter(|i| i["status"] == "not_covered")
        .count();
    Ok(Json(json!({
        "ok": true,
        "dry_run": dry_run,
        "migrated": migrated,
        "not_covered": not_covered,
        "projects": report,
    })))
}

#[derive(Deserialize)]
struct RollbackBody {
    project_uuid: String,
}

/// Délie le projet et recrée le webhook push par dépôt (PAT).
async fn rollback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(b): Json<RollbackBody>,
) -> Result<Json<Value>, ApiErr> {
    require_admin(&state, &headers).await?;
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT git_repository FROM projects WHERE uuid = $1")
            .bind(&b.project_uuid)
            .fetch_optional(&state.pool)
            .await
            .map_err(db_err)?;
    let (repo,) = row.ok_or_else(|| err(StatusCode::NOT_FOUND, "projet introuvable"))?;
    let pat = instance_pat(&state.pool).await;
    let mut hook_id = None;
    let mut hook_error = None;
    let callback = crate::auto_deploy::instance_public_url(&state)
        .await
        .map(|u| crate::auto_deploy::webhook_callback_url(&u));
    if let (Some((o, r)), Some(cb), false) = (
        repo.as_deref()
            .and_then(devforge_github::checks::parse_repo),
        callback,
        pat.trim().is_empty(),
    ) {
        let api = RepoApi::new(crate::github_app_routes::api_base(), &pat, &o, &r);
        let existing = api
            .list_hooks()
            .await
            .map(|h| legacy_hook_ids(&h, &cb))
            .unwrap_or_default();
        if let Some(id) = existing.first() {
            hook_id = Some(*id);
        } else {
            match api
                .create_push_hook(&cb, crate::auto_deploy::webhook_secret().as_deref())
                .await
            {
                Ok(id) => hook_id = Some(id),
                Err(e) => hook_error = Some(e),
            }
        }
    } else {
        hook_error = Some("PAT ou URL publique absents : webhook non recréé".to_string());
    }
    sqlx::query(
        "UPDATE projects SET github_installation_id = NULL, github_repo_id = NULL, legacy_webhook_id = $1, updated_at = $2 WHERE uuid = $3",
    )
    .bind(hook_id)
    .bind(now_str())
    .bind(&b.project_uuid)
    .execute(&state.pool)
    .await
    .map_err(db_err)?;
    // Rollback ⇒ réactiver l’endpoint legacy pour recevoir à nouveau les pushes.
    let _ = set_legacy_webhook(&state.pool, true).await;
    Ok(Json(
        json!({"ok": true, "webhook_id": hook_id, "hook_error": hook_error, "legacy_webhook": true}),
    ))
}

/// Nouveau secret webhook : `PATCH /app/hook/config` (JWT de l'app) puis stockage scellé.
async fn rotate_webhook_secret(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiErr> {
    require_admin(&state, &headers).await?;
    let creds = crate::github_app_routes::load_credentials(&state.pool)
        .await
        .map_err(|e| err(StatusCode::BAD_REQUEST, &e))?;
    let jwt = creds
        .app_jwt()
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let mut b = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut b);
    let secret: String = b.iter().map(|x| format!("{x:02x}")).collect();
    let sealed = crate::secret_box::seal(secret.as_bytes()).map_err(|_| {
        err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "coffre de secrets indisponible",
        )
    })?;
    let res = reqwest::Client::new()
        .patch(format!(
            "{}/app/hook/config",
            crate::github_app_routes::api_base()
        ))
        .bearer_auth(jwt.expose())
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "devforge-server/2")
        .json(&json!({ "secret": secret }))
        .send()
        .await
        .map_err(|_| err(StatusCode::BAD_GATEWAY, "GitHub injoignable"))?;
    if !res.status().is_success() {
        return Err(err(
            StatusCode::BAD_GATEWAY,
            &format!("GitHub a répondu {}", res.status().as_u16()),
        ));
    }
    sqlx::query("UPDATE github_app SET webhook_secret_enc = $1 WHERE id = 1")
        .bind(&sealed)
        .execute(&state.pool)
        .await
        .map_err(db_err)?;
    Ok(Json(json!({"ok": true, "rotated": true})))
}

// ───────────────────── Limitation de débit ─────────────────────

/// Fenêtre fixe d'une minute (compteur global, en mémoire).
pub struct RateWindow {
    inner: Mutex<(i64, u32)>,
}

impl Default for RateWindow {
    fn default() -> Self {
        Self::new()
    }
}

impl RateWindow {
    pub const fn new() -> Self {
        Self {
            inner: Mutex::new((0, 0)),
        }
    }

    /// `true` si la requête passe (≤ `limit` dans la minute `now / 60`).
    pub fn allow(&self, now_secs: i64, limit: u32) -> bool {
        let minute = now_secs.div_euclid(60);
        let mut g = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        if g.0 != minute {
            *g = (minute, 0);
        }
        if g.1 >= limit {
            return false;
        }
        g.1 += 1;
        true
    }
}

pub static WEBHOOK_RATE: RateWindow = RateWindow::new();

pub fn webhook_rate_limit() -> u32 {
    std::env::var("DEVFORGE_WEBHOOK_RATE_PER_MIN")
        .ok()
        .and_then(|v| v.trim().parse().ok())
        .filter(|n: &u32| *n > 0)
        .unwrap_or(600)
}

/// À appeler en tête des deux routes webhook.
pub fn webhook_allowed() -> bool {
    WEBHOOK_RATE.allow(chrono::Utc::now().timestamp(), webhook_rate_limit())
}

/// Ancien webhook par dépôt actif ? Réglage `instance_settings.legacy_webhook` (admin).
pub async fn legacy_webhook_enabled(pool: &PgPool) -> bool {
    let row: Option<(i64,)> =
        sqlx::query_as("SELECT legacy_webhook FROM instance_settings WHERE id = 1")
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    row.map(|(v,)| v != 0).unwrap_or(true)
}

pub async fn set_legacy_webhook(pool: &PgPool, enabled: bool) -> Result<(), sqlx::Error> {
    let now = now_str();
    sqlx::query(
        "UPDATE instance_settings SET legacy_webhook = $1, updated_at = $2 WHERE id = 1",
    )
    .bind(if enabled { 1i64 } else { 0i64 })
    .bind(&now)
    .execute(pool)
    .await?;
    Ok(())
}

/// Admin : tous les projets migrés → efface le PAT instance et coupe l’ancien webhook.
async fn retire_legacy(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiErr> {
    require_admin(&state, &headers).await?;
    let (unmigrated,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM projects WHERE github_installation_id IS NULL AND git_repository ILIKE '%github.com%'",
    )
    .fetch_one(&state.pool)
    .await
    .map_err(db_err)?;
    if unmigrated > 0 {
        let msg = format!(
            "{unmigrated} projet(s) GitHub encore non migrés — termine la migration d’abord"
        );
        return Err(err(StatusCode::CONFLICT, &msg));
    }
    state.configure_github("").await.map_err(|e| {
        let msg = format!("impossible d’effacer le jeton : {e}");
        err(StatusCode::INTERNAL_SERVER_ERROR, &msg)
    })?;
    set_legacy_webhook(&state.pool, false)
        .await
        .map_err(db_err)?;
    Ok(Json(json!({
        "ok": true,
        "pat_cleared": true,
        "legacy_webhook": false,
    })))
}

#[cfg(test)]
#[path = "github_migration_tests.rs"]
mod tests;
