//! P3 : API de la surveillance de page (espace de travail courant).
//!
//! - `GET    /api/v1/watches`                    liste
//! - `POST   /api/v1/watches`                    créer (première vérification lancée aussitôt)
//! - `GET    /api/v1/watches/{uuid}`             détail + vérifications récentes
//! - `PATCH  /api/v1/watches/{uuid}`             modifier
//! - `POST   /api/v1/watches/{uuid}/pause`       mettre en pause
//! - `POST   /api/v1/watches/{uuid}/resume`      reprendre (vérifie tout de suite)
//! - `POST   /api/v1/watches/{uuid}/run`         vérifier maintenant
//! - `DELETE /api/v1/watches/{uuid}?confirm=true` supprimer (confirmation obligatoire)
//! - `GET    /api/v1/watches/{uuid}/checks`      vérifications récentes
//! - `GET    /api/v1/watch-alerts`               alertes (in-app), `?unread=true`
//! - `POST   /api/v1/watch-alerts/read`          marquer lues (`{uuids?: [...]}`)

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::page_watch::{self as core, FetchPolicy, WatchSpec};
use crate::routes::ApiError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/watches", get(list).post(create))
        .route(
            "/api/v1/watches/{uuid}",
            get(detail).patch(update).delete(remove),
        )
        .route("/api/v1/watches/{uuid}/pause", post(pause))
        .route("/api/v1/watches/{uuid}/resume", post(resume))
        .route("/api/v1/watches/{uuid}/run", post(run_now))
        .route("/api/v1/watches/{uuid}/checks", get(checks))
        .route("/api/v1/watch-alerts", get(alerts))
        .route("/api/v1/watch-alerts/read", post(mark_read))
}

async fn workspace(state: &AppState, headers: &HeaderMap) -> Result<(String, String), ApiError> {
    let (user, ws) = crate::auth_routes::current_workspace(state, headers)
        .await
        .map_err(ApiError::from_auth)?;
    Ok((user.uuid, ws.uuid))
}

fn conflict(msg: &str) -> ApiError {
    ApiError {
        status: StatusCode::CONFLICT,
        message: msg.into(),
    }
}

#[derive(Deserialize, Default)]
pub struct WatchBody {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    /// Texte guetté (`text`) ou repère près du prix (`price`, facultatif).
    #[serde(default, alias = "needle")]
    pub text: Option<String>,
    #[serde(default)]
    pub text_mode: Option<String>,
    #[serde(default)]
    pub price_op: Option<String>,
    #[serde(default)]
    pub threshold: Option<f64>,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub interval_minutes: Option<i32>,
}

/// Nom par défaut : le domaine sans « www. ».
pub fn default_name(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| {
            u.host_str()
                .map(|h| h.trim_start_matches("www.").to_string())
        })
        .unwrap_or_else(|| "Page".into())
}

/// Validation complète d'une création : URL publique (DNS compris), condition, intervalle.
pub async fn validate_new(
    body: &WatchBody,
    policy: &FetchPolicy,
) -> Result<(String, String, WatchSpec, i32), String> {
    let url = core::validate_url(body.url.as_deref().unwrap_or(""), policy)?;
    let host = url
        .host_str()
        .unwrap_or("")
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_string();
    if host.parse::<std::net::IpAddr>().is_err() {
        core::resolve_public(&host, url.port_or_known_default().unwrap_or(443), policy).await?;
    }
    let spec = WatchSpec {
        kind: body.kind.clone().unwrap_or_default(),
        needle: body.text.clone(),
        text_mode: body.text_mode.clone(),
        price_op: body.price_op.clone(),
        threshold: body.threshold,
        currency: body.currency.clone(),
    }
    .normalized()?;
    let interval = core::normalize_interval(body.interval_minutes)?;
    let name = body
        .name
        .as_deref()
        .map(|n| n.trim().chars().take(80).collect::<String>())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| default_name(url.as_str()));
    Ok((url.to_string(), name, spec, interval))
}

async fn list(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, ApiError> {
    let (_u, ws) = workspace(&state, &headers).await?;
    let rows = core::list(&state.pool, &ws).await.map_err(ApiError::from)?;
    let unread = core::unread_count(&state.pool, &ws).await.unwrap_or(0);
    Ok(Json(json!({"data": rows, "unread_alerts": unread})))
}

fn spawn_check(state: &AppState, uuid: String) {
    let pool = state.pool.clone();
    tokio::spawn(async move {
        let owner = crate::agent_runs::instance_id();
        if let Ok(Some(w)) = core::claim_one(&pool, &uuid, owner).await {
            let _ = core::run_claimed(&pool, &w, owner, &FetchPolicy::default()).await;
        }
    });
}

pub async fn insert(
    pool: &sqlx::PgPool,
    ws: &str,
    user: &str,
    url: &str,
    name: &str,
    spec: &WatchSpec,
    interval: i32,
) -> Result<core::PageWatch, sqlx::Error> {
    sqlx::query_as::<_, core::PageWatch>(
        r#"INSERT INTO page_watches
               (uuid, workspace_uuid, created_by, name, url, kind, needle, text_mode, price_op,
                threshold, currency, interval_minutes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING *"#,
    )
    .bind(core::new_uuid())
    .bind(ws)
    .bind(user)
    .bind(name)
    .bind(url)
    .bind(&spec.kind)
    .bind(spec.needle.as_deref())
    .bind(spec.text_mode.as_deref())
    .bind(spec.price_op.as_deref())
    .bind(spec.threshold)
    .bind(spec.currency.as_deref())
    .bind(interval)
    .fetch_one(pool)
    .await
}

async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<WatchBody>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let (user, ws) = workspace(&state, &headers).await?;
    let (count,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM page_watches WHERE workspace_uuid = $1")
            .bind(&ws)
            .fetch_one(&state.pool)
            .await
            .map_err(ApiError::from)?;
    if count >= core::MAX_WATCHES_PER_WORKSPACE {
        return Err(ApiError::message(format!(
            "{} surveillances au maximum : supprime celles qui ne servent plus.",
            core::MAX_WATCHES_PER_WORKSPACE
        )));
    }
    let (url, name, spec, interval) = validate_new(&body, &FetchPolicy::default())
        .await
        .map_err(ApiError::message)?;
    let w = insert(&state.pool, &ws, &user, &url, &name, &spec, interval)
        .await
        .map_err(ApiError::from)?;
    spawn_check(&state, w.uuid.clone());
    Ok((StatusCode::CREATED, Json(json!({"data": w}))))
}

async fn detail(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (_u, ws) = workspace(&state, &headers).await?;
    let w = core::get(&state.pool, &ws, &uuid)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("watch"))?;
    let checks = core::checks(&state.pool, &uuid, 20)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(json!({"data": w, "checks": checks})))
}

/// Modifie une surveillance. Changer l'adresse ou la condition repart d'une nouvelle référence.
pub async fn apply_update(
    pool: &sqlx::PgPool,
    ws: &str,
    current: &core::PageWatch,
    body: &WatchBody,
    policy: &FetchPolicy,
) -> Result<core::PageWatch, ApiError> {
    let merged = WatchBody {
        name: body.name.clone().or_else(|| Some(current.name.clone())),
        url: body.url.clone().or_else(|| Some(current.url.clone())),
        kind: body.kind.clone().or_else(|| Some(current.kind.clone())),
        text: if body.text.is_some() {
            body.text.clone()
        } else {
            current.needle.clone()
        },
        text_mode: body.text_mode.clone().or_else(|| current.text_mode.clone()),
        price_op: body.price_op.clone().or_else(|| current.price_op.clone()),
        threshold: body.threshold.or(current.threshold),
        currency: body.currency.clone().or_else(|| current.currency.clone()),
        interval_minutes: body.interval_minutes.or(Some(current.interval_minutes)),
    };
    let (url, name, spec, interval) = validate_new(&merged, policy)
        .await
        .map_err(ApiError::message)?;
    let reset = url != current.url || spec != current.spec();
    let w = sqlx::query_as::<_, core::PageWatch>(
        r#"UPDATE page_watches SET name = $3, url = $4, kind = $5, needle = $6, text_mode = $7,
               price_op = $8, threshold = $9, currency = $10, interval_minutes = $11,
               last_hash = CASE WHEN $12 THEN NULL ELSE last_hash END,
               last_snapshot = CASE WHEN $12 THEN NULL ELSE last_snapshot END,
               last_alert_hash = CASE WHEN $12 THEN NULL ELSE last_alert_hash END,
               last_value = CASE WHEN $12 THEN NULL ELSE last_value END,
               last_summary = CASE WHEN $12 THEN NULL ELSE last_summary END,
               condition_met = CASE WHEN $12 THEN FALSE ELSE condition_met END,
               failure_streak = CASE WHEN $12 THEN 0 ELSE failure_streak END,
               last_error = CASE WHEN $12 THEN NULL ELSE last_error END,
               next_check_at = CASE WHEN $12 THEN now()
                   ELSE LEAST(next_check_at, COALESCE(last_check_at, now()) + make_interval(mins => $11)) END,
               updated_at = now()
           WHERE uuid = $1 AND workspace_uuid = $2
           RETURNING *"#,
    )
    .bind(&current.uuid)
    .bind(ws)
    .bind(&name)
    .bind(&url)
    .bind(&spec.kind)
    .bind(spec.needle.as_deref())
    .bind(spec.text_mode.as_deref())
    .bind(spec.price_op.as_deref())
    .bind(spec.threshold)
    .bind(spec.currency.as_deref())
    .bind(interval)
    .bind(reset)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::from)?
    .ok_or_else(|| ApiError::not_found("watch"))?;
    Ok(w)
}

async fn update(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<WatchBody>,
) -> Result<Json<Value>, ApiError> {
    let (_u, ws) = workspace(&state, &headers).await?;
    let current = core::get(&state.pool, &ws, &uuid)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("watch"))?;
    let w = apply_update(&state.pool, &ws, &current, &body, &FetchPolicy::default()).await?;
    if w.status == "active" && w.last_hash.is_none() {
        spawn_check(&state, w.uuid.clone());
    }
    Ok(Json(json!({"data": w})))
}

async fn reload(state: &AppState, ws: &str, uuid: &str) -> Result<Json<Value>, ApiError> {
    let w = core::get(&state.pool, ws, uuid)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("watch"))?;
    Ok(Json(json!({"data": w, "ok": true})))
}

async fn pause(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (_u, ws) = workspace(&state, &headers).await?;
    let w = core::get(&state.pool, &ws, &uuid)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("watch"))?;
    if w.status == "paused" {
        return reload(&state, &ws, &uuid).await; // idempotent
    }
    core::pause(&state.pool, &ws, &uuid)
        .await
        .map_err(ApiError::from)?;
    reload(&state, &ws, &uuid).await
}

async fn resume(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (_u, ws) = workspace(&state, &headers).await?;
    let w = core::get(&state.pool, &ws, &uuid)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("watch"))?;
    if w.status == "active" {
        return reload(&state, &ws, &uuid).await;
    }
    core::resume(&state.pool, &ws, &uuid)
        .await
        .map_err(ApiError::from)?;
    spawn_check(&state, uuid.clone());
    reload(&state, &ws, &uuid).await
}

async fn run_now(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (_u, ws) = workspace(&state, &headers).await?;
    let w = core::get(&state.pool, &ws, &uuid)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("watch"))?;
    if w.status != "active" {
        return Err(conflict(
            "Surveillance en pause : reprends-la pour la vérifier.",
        ));
    }
    let owner = crate::agent_runs::instance_id();
    let claimed = core::claim_one(&state.pool, &uuid, owner)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| conflict("Une vérification est déjà en cours."))?;
    let check = core::run_claimed(&state.pool, &claimed, owner, &FetchPolicy::default())
        .await
        .map_err(ApiError::from)?;
    let w = core::get(&state.pool, &ws, &uuid)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("watch"))?;
    Ok(Json(json!({"data": w, "check": check})))
}

#[derive(Deserialize)]
struct DeleteQuery {
    #[serde(default)]
    confirm: Option<String>,
}

async fn remove(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Query(q): Query<DeleteQuery>,
) -> Result<Json<Value>, ApiError> {
    let (_u, ws) = workspace(&state, &headers).await?;
    if !matches!(q.confirm.as_deref(), Some("true") | Some("1")) {
        return Err(ApiError::message("Confirme la suppression (confirm=true)."));
    }
    if !core::delete(&state.pool, &ws, &uuid)
        .await
        .map_err(ApiError::from)?
    {
        return Err(ApiError::not_found("watch"));
    }
    Ok(Json(json!({"ok": true})))
}

#[derive(Deserialize)]
struct ChecksQuery {
    #[serde(default)]
    limit: Option<i64>,
}

async fn checks(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Query(q): Query<ChecksQuery>,
) -> Result<Json<Value>, ApiError> {
    let (_u, ws) = workspace(&state, &headers).await?;
    core::get(&state.pool, &ws, &uuid)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("watch"))?;
    let rows = core::checks(&state.pool, &uuid, q.limit.unwrap_or(20))
        .await
        .map_err(ApiError::from)?;
    Ok(Json(json!({"data": rows})))
}

#[derive(Deserialize)]
struct AlertsQuery {
    #[serde(default)]
    unread: Option<bool>,
    #[serde(default)]
    limit: Option<i64>,
}

async fn alerts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<AlertsQuery>,
) -> Result<Json<Value>, ApiError> {
    let (_u, ws) = workspace(&state, &headers).await?;
    let rows = core::alerts(
        &state.pool,
        &ws,
        q.unread.unwrap_or(false),
        q.limit.unwrap_or(30),
    )
    .await
    .map_err(ApiError::from)?;
    let unread = core::unread_count(&state.pool, &ws)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(json!({"data": rows, "unread": unread})))
}

#[derive(Deserialize, Default)]
struct ReadBody {
    #[serde(default)]
    uuids: Option<Vec<String>>,
}

async fn mark_read(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Option<Json<ReadBody>>,
) -> Result<Json<Value>, ApiError> {
    let (_u, ws) = workspace(&state, &headers).await?;
    let body = body.map(|Json(b)| b).unwrap_or_default();
    let n = core::mark_read(&state.pool, &ws, body.uuids.as_deref())
        .await
        .map_err(ApiError::from)?;
    Ok(Json(json!({"ok": true, "marked": n})))
}
