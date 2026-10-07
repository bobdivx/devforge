//! Brouillon d'une app : changements du workdir local pas encore sur GitHub.
//! Valider (commit + push), supprimer (avec sauvegarde 7 jours), annuler un fichier,
//! mettre à jour depuis GitHub. Chaque action est tracée dans `builder_events`.

use std::path::PathBuf;
use std::time::Duration;

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::draft::{self, DraftFile};
use crate::routes::ApiError;
use crate::state::{AppState, Project};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/drafts", get(list_drafts))
        .route("/api/v1/projects/{uuid}/draft", get(get_draft))
        .route("/api/v1/projects/{uuid}/draft/diff", get(get_diff))
        .route("/api/v1/projects/{uuid}/draft/validate", post(validate))
        .route("/api/v1/projects/{uuid}/draft/discard", post(discard))
        .route("/api/v1/projects/{uuid}/draft/restore", post(restore))
        .route("/api/v1/projects/{uuid}/draft/revert-file", post(revert_file))
        .route("/api/v1/projects/{uuid}/draft/update-from-github", post(update_from_github))
}

struct Ctx {
    user: crate::auth_routes::UserRow,
    project: Project,
    workdir: PathBuf,
    branch: String,
}

fn branch_of(p: &Project) -> String {
    p.git_branch.clone().filter(|b| !b.trim().is_empty()).unwrap_or_else(|| "main".into())
}

fn workdir_of(p: &Project) -> Option<PathBuf> {
    let configured = p.workdir.as_deref().unwrap_or("").trim();
    if configured.is_empty() {
        return None;
    }
    Some(PathBuf::from(devforge_deploy::resolve_project_workdir(configured, &p.uuid)))
}

async fn ctx(state: &AppState, headers: &HeaderMap, uuid: &str) -> Result<Ctx, ApiError> {
    let (user, _ws, project) = crate::routes::auth_project(state, headers, uuid).await?;
    let workdir = workdir_of(&project).ok_or_else(|| ApiError::message("Cette app n'a pas de dossier de travail."))?;
    let branch = branch_of(&project);
    Ok(Ctx { user, project, workdir, branch })
}

/// URL GitHub avec jeton (compte de l'utilisateur, sinon jeton d'instance) — jamais renvoyée au client.
async fn remote_url(state: &AppState, c: &Ctx) -> Option<String> {
    let repo = c.project.git_repository.as_deref().filter(|s| !s.trim().is_empty())?;
    let mut token = crate::user_prefs::github_token(&state.pool, &c.user.uuid).await;
    if token.trim().is_empty() {
        token = state.github.instance_token().unwrap_or_default();
    }
    Some(draft::token_url(repo, Some(&token)))
}

fn data_dir() -> PathBuf {
    PathBuf::from(std::env::var("DEVFORGE_DATA_DIR").unwrap_or_else(|_| "/data".into()))
}

fn backups_root(project_uuid: &str) -> PathBuf {
    draft::backups_root(&data_dir(), project_uuid)
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, draft::DraftError> + Send + 'static) -> Result<T, ApiError> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?
        .map_err(|e| ApiError::message(draft::redact(&e.0)))
}

async fn audit(state: &AppState, c: &Ctx, status: &str, ref_id: &str, detail: &str) {
    let who = if c.user.name.trim().is_empty() { &c.user.email } else { &c.user.name };
    crate::deploy_queue::record_event(&state.pool, &c.project.uuid, "draft", status, ref_id, &format!("{who} · {detail}")).await;
}

async fn preview_info(state: &AppState, uuid: &str) -> Value {
    let fut = state.registry.execute("local_preview_status", json!({ "project_uuid": uuid }));
    match tokio::time::timeout(Duration::from_secs(3), fut).await {
        Ok(Ok(v)) => {
            let running = matches!(v.get("status").and_then(|r| r.as_str()), Some("running" | "degraded"));
            let url = v.get("preview_url").cloned().unwrap_or(Value::Null);
            json!({ "running": running, "url": if running { url } else { Value::Null } })
        }
        _ => json!({ "running": false, "url": null }),
    }
}

fn status_json(st: &draft::DraftStatus) -> Value {
    let mut v = serde_json::to_value(st).unwrap_or_else(|_| json!({}));
    v["count"] = json!(st.files.len());
    v["suggested_message"] = json!(draft::suggested_message(&st.files));
    v
}

#[derive(Deserialize, Default)]
struct StatusQuery {
    /// `1` : rafraîchit d'abord la branche GitHub (réseau).
    fetch: Option<String>,
}

async fn get_draft(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Query(q): Query<StatusQuery>,
) -> Result<Json<Value>, ApiError> {
    let c = ctx(&state, &headers, &uuid).await?;
    let fetch = matches!(q.fetch.as_deref(), Some("1" | "true"));
    let url = if fetch { remote_url(&state, &c).await } else { None };
    let (wd, br) = (c.workdir.clone(), c.branch.clone());
    let st = blocking(move || Ok(draft::status(&wd, &br, url.as_deref()))).await?;
    let root = backups_root(&c.project.uuid);
    let backups = tokio::task::spawn_blocking(move || draft::list_backups(&root)).await.unwrap_or_default();
    let mut out = status_json(&st);
    out["ok"] = json!(true);
    out["backups"] = json!(backups);
    out["preview"] = if st.dirty { preview_info(&state, &uuid).await } else { json!({ "running": false, "url": null }) };
    Ok(Json(out))
}

#[derive(Deserialize, Default)]
struct DiffQuery {
    path: Option<String>,
}

async fn get_diff(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Query(q): Query<DiffQuery>,
) -> Result<Json<Value>, ApiError> {
    let c = ctx(&state, &headers, &uuid).await?;
    let (wd, br) = (c.workdir.clone(), c.branch.clone());
    let only = q.path.filter(|p| !p.trim().is_empty());
    let files = blocking(move || draft::diff(&wd, &br, only.as_deref())).await?;
    Ok(Json(json!({ "ok": true, "files": files })))
}

#[derive(Deserialize, Default)]
struct ValidateBody {
    message: Option<String>,
    confirm: Option<bool>,
}

async fn validate(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<ValidateBody>,
) -> Result<Json<Value>, ApiError> {
    let c = ctx(&state, &headers, &uuid).await?;
    if !body.confirm.unwrap_or(false) {
        return Err(ApiError::message("Confirmation requise pour valider le brouillon."));
    }
    let Some(url) = remote_url(&state, &c).await else {
        return Err(ApiError::message("Cette app n'est pas reliée à un dépôt GitHub."));
    };
    let message = body.message.unwrap_or_default();
    let (wd, br) = (c.workdir.clone(), c.branch.clone());
    let (name, email) = (author_name(&c), author_email(&c));
    let res = blocking(move || draft::validate(&wd, &br, &url, &message, (&name, &email))).await;
    match res {
        Ok(v) => {
            audit(&state, &c, "validated", &v.sha, &format!("{} fichier(s) envoyés sur GitHub ({})", v.files, v.branch)).await;
            Ok(Json(json!({ "ok": true, "sha": v.sha, "files": v.files, "branch": v.branch })))
        }
        Err(e) => {
            audit(&state, &c, "failed", "validate", &e.message).await;
            Err(e)
        }
    }
}

fn author_name(c: &Ctx) -> String {
    let n = c.user.name.trim();
    if n.is_empty() { "DevForge".into() } else { n.to_string() }
}

fn author_email(c: &Ctx) -> String {
    let e = c.user.email.trim();
    if e.is_empty() { "devforge@localhost".into() } else { e.to_string() }
}

#[derive(Deserialize, Default)]
struct ConfirmBody {
    confirm: Option<bool>,
}

async fn discard(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<ConfirmBody>,
) -> Result<Json<Value>, ApiError> {
    let c = ctx(&state, &headers, &uuid).await?;
    if !body.confirm.unwrap_or(false) {
        return Err(ApiError::message("Confirmation requise pour supprimer le brouillon."));
    }
    let url = remote_url(&state, &c).await;
    let root = backups_root(&c.project.uuid);
    let (wd, br) = (c.workdir.clone(), c.branch.clone());
    let res = blocking(move || {
        let st = draft::status(&wd, &br, url.as_deref());
        if !st.available {
            return Err(draft::DraftError(st.reason.unwrap_or_default()));
        }
        if !st.dirty {
            return Err(draft::DraftError("Le brouillon est déjà vide.".into()));
        }
        let b = draft::backup(&wd, &root, &st.files, "discard")?;
        let head = draft::discard(&wd, &br, None)?;
        Ok((b, head, st.files.len()))
    })
    .await;
    match res {
        Ok((b, head, n)) => {
            let _ = tokio::time::timeout(
                Duration::from_secs(10),
                state.registry.execute("stop_local_preview", json!({ "project_uuid": uuid })),
            )
            .await;
            audit(&state, &c, "discarded", &b.id, &format!("{n} fichier(s) supprimés, sauvegarde 7 jours")).await;
            Ok(Json(json!({ "ok": true, "backup_id": b.id, "files": n, "head": head })))
        }
        Err(e) => {
            audit(&state, &c, "failed", "discard", &e.message).await;
            Err(e)
        }
    }
}

#[derive(Deserialize, Default)]
struct RestoreBody {
    backup_id: Option<String>,
}

async fn restore(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<RestoreBody>,
) -> Result<Json<Value>, ApiError> {
    let c = ctx(&state, &headers, &uuid).await?;
    let id = body.backup_id.unwrap_or_default();
    let root = backups_root(&c.project.uuid);
    let wd = c.workdir.clone();
    let id2 = id.clone();
    let b = blocking(move || draft::restore(&wd, &root, &id2)).await?;
    audit(&state, &c, "restored", &id, &format!("{} fichier(s) remis", b.files.len() + b.deleted.len())).await;
    Ok(Json(json!({ "ok": true, "files": b.files.len() + b.deleted.len() })))
}

#[derive(Deserialize, Default)]
struct RevertBody {
    path: Option<String>,
    confirm: Option<bool>,
}

async fn revert_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<RevertBody>,
) -> Result<Json<Value>, ApiError> {
    let c = ctx(&state, &headers, &uuid).await?;
    if !body.confirm.unwrap_or(false) {
        return Err(ApiError::message("Confirmation requise pour annuler ce fichier."));
    }
    let path = body.path.unwrap_or_default().trim().to_string();
    if path.is_empty() {
        return Err(ApiError::message("Fichier manquant."));
    }
    let root = backups_root(&c.project.uuid);
    let (wd, br) = (c.workdir.clone(), c.branch.clone());
    let p = path.clone();
    let b = blocking(move || {
        let st = draft::status(&wd, &br, None);
        let file: DraftFile = st
            .files
            .into_iter()
            .find(|f| f.path == p)
            .ok_or_else(|| draft::DraftError("Ce fichier ne fait pas partie du brouillon.".into()))?;
        let b = draft::backup(&wd, &root, std::slice::from_ref(&file), "revert-file")?;
        draft::revert_file(&wd, &br, &file)?;
        Ok(b)
    })
    .await?;
    audit(&state, &c, "file_reverted", &b.id, &path).await;
    Ok(Json(json!({ "ok": true, "backup_id": b.id, "path": path })))
}

async fn update_from_github(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let c = ctx(&state, &headers, &uuid).await?;
    let Some(url) = remote_url(&state, &c).await else {
        return Err(ApiError::message("Cette app n'est pas reliée à un dépôt GitHub."));
    };
    let (wd, br) = (c.workdir.clone(), c.branch.clone());
    let (name, email) = (author_name(&c), author_email(&c));
    let u = blocking(move || draft::update_from_github(&wd, &br, Some(&url), (&name, &email))).await?;
    if u.merged > 0 {
        audit(&state, &c, "updated", &u.head, &format!("{} commit(s) récupérés depuis GitHub", u.merged)).await;
    }
    Ok(Json(json!({ "ok": true, "merged": u.merged, "head": u.head })))
}

/// Vue globale : toutes les apps de l'espace qui ont un brouillon (sans réseau).
async fn list_drafts(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, ApiError> {
    let (_user, ws) = crate::auth_routes::current_workspace(&state, &headers)
        .await
        .map_err(ApiError::from_auth)?;
    let projects = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE workspace_uuid = $1 ORDER BY name")
        .bind(&ws.uuid)
        .fetch_all(&state.pool)
        .await
        .map_err(ApiError::from)?;
    let items = tokio::task::spawn_blocking(move || {
        projects
            .into_iter()
            .filter_map(|p| {
                let wd = workdir_of(&p)?;
                if !wd.is_dir() {
                    return None;
                }
                let st = draft::status(&wd, &branch_of(&p), None);
                if !st.dirty {
                    return None;
                }
                Some(json!({
                    "project_uuid": p.uuid,
                    "project_name": p.name,
                    "production_url": p.production_url,
                    "git_repository": p.git_repository,
                    "branch": st.branch,
                    "count": st.files.len(),
                    "added": st.files.iter().filter(|f| f.status == "added").count(),
                    "deleted": st.files.iter().filter(|f| f.status == "deleted").count(),
                    "behind": st.behind,
                    "updated_at": st.updated_at,
                    "sample": st.files.iter().take(3).map(|f| f.path.clone()).collect::<Vec<_>>(),
                }))
            })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|e| ApiError::message(e.to_string()))?;
    Ok(Json(json!({ "ok": true, "drafts": items })))
}
