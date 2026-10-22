//! API + planification du nettoyage Docker (voir `docker_gc.rs`).
//!
//! - `GET/PUT /api/v1/admin/docker-gc` : réglages, prochain passage, état ;
//! - `GET  /api/v1/admin/docker-gc/nodes` : disque de chaque nœud ;
//! - `POST /api/v1/admin/docker-gc/preview` : simulation (lecture seule) ;
//! - `POST /api/v1/admin/docker-gc/run` `{confirm: true}` : nettoyage maintenant ;
//! - `GET  /api/v1/admin/docker-gc/runs` : historique.
//!
//! Le planificateur tourne sur le leader : passage selon le cron (défaut
//! 03:00 Europe/Paris chaque jour) et nettoyage d'urgence d'un nœud dont le
//! disque Docker dépasse le seuil (au plus une fois par heure et par nœud).

use std::collections::HashMap;
use std::sync::{Mutex as StdMutex, OnceLock};
use std::time::Instant;

use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::docker_gc::{self, GcSettings};
use crate::state::AppState;
use devforge_cluster::NodeRole;

type ApiErr = (StatusCode, Json<Value>);

fn bad(status: StatusCode, msg: impl Into<String>) -> ApiErr {
    (status, Json(json!({ "error": msg.into() })))
}

/// Un seul nettoyage à la fois (manuel, planifié ou urgence).
static RUN_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
/// Dernier nettoyage d'urgence par nœud.
fn emergency_marks() -> &'static StdMutex<HashMap<String, Instant>> {
    static M: OnceLock<StdMutex<HashMap<String, Instant>>> = OnceLock::new();
    M.get_or_init(|| StdMutex::new(HashMap::new()))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/admin/docker-gc",
            get(get_settings).put(put_settings),
        )
        .route("/api/v1/admin/docker-gc/nodes", get(nodes_disk))
        .route("/api/v1/admin/docker-gc/preview", post(preview))
        .route("/api/v1/admin/docker-gc/run", post(run_now))
        .route("/api/v1/admin/docker-gc/runs", get(list_runs))
}

async fn require_admin(state: &AppState, headers: &HeaderMap) -> Result<(), ApiErr> {
    let (user, _) = crate::auth_routes::current_workspace(state, headers).await?;
    if user.role != "instance_admin" {
        return Err(bad(
            StatusCode::FORBIDDEN,
            "Réservé à l’administrateur d’instance",
        ));
    }
    Ok(())
}

// ───────────────────────── Stockage ─────────────────────────

pub async fn ensure_tables(pool: &sqlx::PgPool) {
    for sql in [
        r#"CREATE TABLE IF NOT EXISTS docker_gc_settings (
            id INTEGER PRIMARY KEY, config TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now())"#,
        r#"CREATE TABLE IF NOT EXISTS docker_gc_runs (
            id BIGSERIAL PRIMARY KEY, started_at TIMESTAMPTZ NOT NULL,
            finished_at TIMESTAMPTZ NOT NULL, trigger TEXT NOT NULL,
            node_id TEXT NOT NULL, node_name TEXT NOT NULL,
            ok BOOLEAN NOT NULL, freed_bytes BIGINT NOT NULL DEFAULT 0,
            images_removed INTEGER NOT NULL DEFAULT 0, duration_ms BIGINT NOT NULL DEFAULT 0,
            disk_percent_before DOUBLE PRECISION, disk_percent_after DOUBLE PRECISION,
            errors TEXT NOT NULL DEFAULT '')"#,
    ] {
        if let Err(e) = sqlx::query(sql).execute(pool).await {
            tracing::warn!(error = %e, "docker gc: création des tables");
        }
    }
}

pub async fn load_settings(pool: &sqlx::PgPool) -> GcSettings {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT config FROM docker_gc_settings WHERE id = 1")
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    row.and_then(|(c,)| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

async fn save_settings(pool: &sqlx::PgPool, s: &GcSettings) -> Result<(), String> {
    let cfg = serde_json::to_string(s).map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO docker_gc_settings (id, config, updated_at) VALUES (1, $1, now())
         ON CONFLICT (id) DO UPDATE SET config = excluded.config, updated_at = now()",
    )
    .bind(cfg)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn apply_log_rotation(s: &GcSettings) {
    devforge_deploy::docker::set_container_log_rotation(
        s.log_rotation
            .then_some((s.log_max_size_mb, s.log_max_files)),
    );
}

// ───────────────────────── Nœuds ─────────────────────────

#[derive(Clone, Debug)]
struct GcNode {
    /// Id passé à l'executor (`default` pour le leader).
    exec_id: String,
    id: String,
    name: String,
    online: bool,
}

async fn gc_nodes(state: &AppState) -> Vec<GcNode> {
    let nodes = state.cluster.list_nodes().await.unwrap_or_default();
    if nodes.is_empty() {
        return vec![GcNode {
            exec_id: "default".into(),
            id: "default".into(),
            name: "Ce serveur".into(),
            online: true,
        }];
    }
    nodes
        .into_iter()
        .map(|n| {
            let leader = n.role == NodeRole::Leader;
            GcNode {
                exec_id: if leader {
                    "default".into()
                } else {
                    n.id.clone()
                },
                online: leader || n.status.as_str() == "online",
                id: n.id,
                name: n.name,
            }
        })
        .collect()
}

async fn exec(state: &AppState, node: &GcNode, cmd: &str, timeout: u64) -> Result<String, String> {
    if !node.online {
        return Err("nœud hors ligne".into());
    }
    state
        .deploy
        .exec(&node.exec_id, "", cmd, timeout)
        .await
        .map(|r| r.output)
        .map_err(|e| e.to_string())
}

async fn node_disk(state: &AppState, node: &GcNode) -> Value {
    match exec(state, node, &docker_gc::disk_command(), 30).await {
        Ok(out) => {
            let d = docker_gc::parse_disk(&out);
            json!({
                "node_id": node.id, "name": node.name, "ok": d.total_bytes > 0,
                "disk": d,
                "log_rotation_supported": log_driver_supports_rotation(&d.logging_driver),
            })
        }
        Err(e) => json!({ "node_id": node.id, "name": node.name, "ok": false, "error": e }),
    }
}

fn log_driver_supports_rotation(driver: &str) -> bool {
    matches!(driver.trim(), "json-file" | "local" | "")
}

// ───────────────────────── Handlers ─────────────────────────

async fn get_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiErr> {
    require_admin(&state, &headers).await?;
    let s = load_settings(&state.pool).await;
    let last: Option<(DateTime<Utc>, bool, i64, String)> = sqlx::query_as(
        "SELECT finished_at, ok, freed_bytes, trigger FROM docker_gc_runs ORDER BY id DESC LIMIT 1",
    )
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    Ok(Json(json!({
        "settings": s,
        "cron_expression": s.cron_expression(),
        "next_run_at": s.enabled.then(|| s.next_run()).flatten(),
        "running": RUN_LOCK.try_lock().is_err(),
        "log_rotation_active": devforge_deploy::docker::container_log_rotation().is_some(),
        "last_run": last.map(|(at, ok, freed, trigger)| json!({
            "finished_at": at, "ok": ok, "freed_bytes": freed, "trigger": trigger,
        })),
    })))
}

async fn put_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<GcSettings>,
) -> Result<Json<Value>, ApiErr> {
    require_admin(&state, &headers).await?;
    let mut s = body;
    s.cron = s
        .cron
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty());
    s.validate().map_err(|e| bad(StatusCode::BAD_REQUEST, e))?;
    if s.log_rotation {
        // `--log-opt max-size` n'existe que pour json-file / local : un autre
        // driver ferait échouer chaque `docker run`.
        for node in gc_nodes(&state).await.iter().filter(|n| n.online) {
            if let Ok(out) = exec(&state, node, &docker_gc::disk_command(), 30).await {
                let d = docker_gc::parse_disk(&out);
                if !log_driver_supports_rotation(&d.logging_driver) {
                    return Err(bad(
                        StatusCode::BAD_REQUEST,
                        format!(
                            "Rotation impossible : le nœud {} utilise le driver de logs « {} » (json-file ou local requis).",
                            node.name, d.logging_driver
                        ),
                    ));
                }
            }
        }
    }
    save_settings(&state.pool, &s)
        .await
        .map_err(|e| bad(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    apply_log_rotation(&s);
    Ok(Json(json!({
        "ok": true,
        "settings": s,
        "cron_expression": s.cron_expression(),
        "next_run_at": s.enabled.then(|| s.next_run()).flatten(),
    })))
}

async fn nodes_disk(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiErr> {
    require_admin(&state, &headers).await?;
    let s = load_settings(&state.pool).await;
    let mut out = Vec::new();
    for node in gc_nodes(&state).await {
        let mut v = node_disk(&state, &node).await;
        let pct = v.pointer("/disk/percent").and_then(Value::as_f64);
        v["alert"] = json!(pct.is_some_and(|p| p >= f64::from(s.disk_alert_percent)));
        out.push(v);
    }
    Ok(Json(
        json!({ "nodes": out, "alert_percent": s.disk_alert_percent }),
    ))
}

/// Plan d'un nœud : inventaire + images sélectionnées + cache récupérable.
struct NodePlan {
    inventory: docker_gc::Inventory,
    plan: docker_gc::ImagePlan,
    cache: Vec<(String, u64)>,
}

async fn plan_node(
    state: &AppState,
    node: &GcNode,
    s: &GcSettings,
    cache_hours: Option<u32>,
    measure_cache: bool,
) -> Result<NodePlan, String> {
    let out = exec(state, node, &docker_gc::inventory_command(), 120).await?;
    let inventory = docker_gc::parse_inventory(&out);
    if inventory.disk.total_bytes == 0 && inventory.images.is_empty() {
        return Err("Docker injoignable sur ce nœud".into());
    }
    let plan = docker_gc::select_images(
        &inventory.images,
        &inventory.containers,
        Utc::now(),
        s.retention_hours,
        s.keep_per_project,
    );
    let cache =
        if measure_cache && (!inventory.builders.is_empty() || !inventory.buildkit.is_empty()) {
            exec(
                state,
                node,
                &docker_gc::cache_du_command(&inventory.builders, &inventory.buildkit, cache_hours),
                180,
            )
            .await
            .map(|o| docker_gc::parse_cache_du(&o))
            .unwrap_or_default()
        } else {
            Vec::new()
        };
    Ok(NodePlan {
        inventory,
        plan,
        cache,
    })
}

async fn preview(State(state): State<AppState>, headers: HeaderMap) -> Result<Json<Value>, ApiErr> {
    require_admin(&state, &headers).await?;
    let s = load_settings(&state.pool).await;
    let mut nodes = Vec::new();
    for node in gc_nodes(&state).await {
        match plan_node(&state, &node, &s, Some(s.retention_hours), true).await {
            Ok(p) => {
                let cache_bytes: u64 = p.cache.iter().map(|(_, b)| *b).sum();
                let build_cache_df = p
                    .inventory
                    .system_df
                    .iter()
                    .find(|(t, _, _)| t.eq_ignore_ascii_case("Build Cache"))
                    .map(|(_, size, rec)| json!({ "size": size, "reclaimable": rec }));
                nodes.push(json!({
                    "node_id": node.id, "name": node.name, "ok": true,
                    "disk": p.inventory.disk,
                    "images": p.plan.remove.iter().map(|c| json!({
                        "id": c.id.trim_start_matches("sha256:").chars().take(12).collect::<String>(),
                        "refs": c.refs.iter().filter(|r| !r.starts_with("sha256:")).collect::<Vec<_>>(),
                        "size": c.size, "created": c.created, "project": c.project, "reason": c.reason,
                    })).collect::<Vec<_>>(),
                    "images_bytes": p.plan.bytes(),
                    "kept_count": p.plan.kept.len(),
                    "protected_running": p.plan.kept.iter().filter(|k| k.reason.contains("en cours")).count(),
                    "containers_untouched": p.inventory.containers.len(),
                    "builders": p.inventory.builders,
                    "buildkit_containers": p.inventory.buildkit,
                    "cache": p.cache.iter().map(|(b, n)| json!({ "builder": b, "bytes": n })).collect::<Vec<_>>(),
                    "cache_bytes": cache_bytes,
                    "build_cache_total": build_cache_df,
                    "total_bytes": cache_bytes + p.plan.bytes(),
                }));
            }
            Err(e) => nodes.push(json!({
                "node_id": node.id, "name": node.name, "ok": false, "error": e,
            })),
        }
    }
    Ok(Json(json!({
        "dry_run": true,
        "retention_hours": s.retention_hours,
        "keep_per_project": s.keep_per_project,
        "nodes": nodes,
    })))
}

#[cfg(test)]
#[path = "docker_gc_tests.rs"]
mod tests;

#[derive(Deserialize)]
struct RunBody {
    #[serde(default)]
    confirm: bool,
}

async fn run_now(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RunBody>,
) -> Result<(StatusCode, Json<Value>), ApiErr> {
    require_admin(&state, &headers).await?;
    if !body.confirm {
        return Err(bad(
            StatusCode::BAD_REQUEST,
            "Confirmation requise (confirm: true).",
        ));
    }
    let Ok(guard) = RUN_LOCK.try_lock() else {
        return Err(bad(StatusCode::CONFLICT, "Un nettoyage est déjà en cours."));
    };
    drop(guard);
    let st = state.clone();
    tokio::spawn(async move {
        run_all(&st, "manual", None).await;
    });
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({ "ok": true, "started": true })),
    ))
}

#[derive(Deserialize)]
struct RunsQuery {
    limit: Option<i64>,
}

async fn list_runs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<RunsQuery>,
) -> Result<Json<Value>, ApiErr> {
    require_admin(&state, &headers).await?;
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    #[allow(clippy::type_complexity)]
    let rows: Vec<(
        i64,
        DateTime<Utc>,
        DateTime<Utc>,
        String,
        String,
        String,
        bool,
        i64,
        i32,
        i64,
        Option<f64>,
        Option<f64>,
        String,
    )> = sqlx::query_as(
        "SELECT id, started_at, finished_at, trigger, node_id, node_name, ok, freed_bytes,
                images_removed, duration_ms, disk_percent_before, disk_percent_after, errors
         FROM docker_gc_runs ORDER BY id DESC LIMIT $1",
    )
    .bind(limit)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| bad(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let runs: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.0, "started_at": r.1, "finished_at": r.2, "trigger": r.3,
                "node_id": r.4, "node_name": r.5, "ok": r.6, "freed_bytes": r.7,
                "images_removed": r.8, "duration_ms": r.9,
                "disk_percent_before": r.10, "disk_percent_after": r.11,
                "errors": r.12.lines().filter(|l| !l.is_empty()).collect::<Vec<_>>(),
            })
        })
        .collect();
    Ok(Json(json!({ "runs": runs })))
}

// ───────────────────────── Exécution ─────────────────────────

/// Nettoie tous les nœuds (ou `only` : un nœud). `trigger` : manual,
/// schedule, emergency. L'urgence vide tout le cache de build inutilisé.
async fn run_all(state: &AppState, trigger: &str, only: Option<&str>) {
    let _guard = RUN_LOCK.lock().await;
    let s = load_settings(&state.pool).await;
    for node in gc_nodes(state).await {
        if only.is_some_and(|id| id != node.id) {
            continue;
        }
        run_node(state, &node, &s, trigger).await;
    }
}

async fn run_node(state: &AppState, node: &GcNode, s: &GcSettings, trigger: &str) {
    let started = Utc::now();
    let t0 = Instant::now();
    let cache_hours = (trigger != "emergency").then_some(s.retention_hours);
    let mut errors: Vec<String> = Vec::new();
    let mut ok = false;
    let mut freed = 0u64;
    let mut removed = 0u32;
    let mut before = None;
    let mut after = None;
    match plan_node(state, node, s, cache_hours, false).await {
        Ok(p) => {
            before = Some(p.inventory.disk.percent);
            let cmd = docker_gc::cleanup_command(
                &p.inventory.builders,
                &p.inventory.buildkit,
                cache_hours,
                &p.plan,
            );
            match exec(state, node, &cmd, 1800).await {
                Ok(out) => {
                    let o = docker_gc::parse_cleanup(&out);
                    freed = o.freed_bytes;
                    removed = o.images_removed;
                    ok = o.errors.is_empty();
                    errors.extend(o.errors);
                }
                Err(e) => errors.push(e),
            }
            if let Ok(out) = exec(state, node, &docker_gc::disk_command(), 30).await {
                after = Some(docker_gc::parse_disk(&out).percent);
            }
        }
        Err(e) => errors.push(e),
    }
    let errors: Vec<String> = errors.into_iter().take(30).collect();
    tracing::info!(
        node = %node.name, trigger, ok, freed_bytes = freed, images_removed = removed,
        "docker gc terminé"
    );
    let _ = sqlx::query(
        "INSERT INTO docker_gc_runs (started_at, finished_at, trigger, node_id, node_name, ok,
            freed_bytes, images_removed, duration_ms, disk_percent_before, disk_percent_after, errors)
         VALUES ($1, now(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    )
    .bind(started)
    .bind(trigger)
    .bind(&node.id)
    .bind(&node.name)
    .bind(ok)
    .bind(freed.min(i64::MAX as u64) as i64)
    .bind(removed as i32)
    .bind(t0.elapsed().as_millis().min(i64::MAX as u128) as i64)
    .bind(before)
    .bind(after)
    .bind(errors.join("\n"))
    .execute(&state.pool)
    .await;
    let _ = sqlx::query(
        "DELETE FROM docker_gc_runs WHERE id NOT IN (SELECT id FROM docker_gc_runs ORDER BY id DESC LIMIT 500)",
    )
    .execute(&state.pool)
    .await;
}

// ───────────────────────── Planificateur ─────────────────────────

/// Urgence due pour un nœud ? (seuil atteint, pas d'urgence depuis 1 h).
pub fn emergency_due(percent: f64, threshold: u32, last: Option<Instant>, now: Instant) -> bool {
    let cooled = match last {
        None => true,
        Some(t) => now.duration_since(t) >= std::time::Duration::from_secs(3600),
    };
    percent >= f64::from(threshold) && cooled
}

/// Désactive l'ancien cron `devforge-disk-guard` sur les nœuds où il est
/// visible (DevForge sur l'hôte). Conteneurisé : signalé dans l'admin.
async fn retire_legacy_guards(state: &AppState) {
    for node in gc_nodes(state).await.iter().filter(|n| n.online) {
        match exec(state, node, &docker_gc::retire_legacy_guard_command(), 20).await {
            Ok(out) if out.contains("retired") => tracing::warn!(
                node = %node.name,
                "ancien cron {} désactivé (remplacé par le nettoyage Docker intégré)",
                docker_gc::LEGACY_GUARD_CRON
            ),
            Ok(out) if out.contains("failed") => tracing::warn!(
                node = %node.name,
                "ancien cron {} présent mais non déplaçable",
                docker_gc::LEGACY_GUARD_CRON
            ),
            _ => {}
        }
    }
}

pub fn spawn_loop(state: AppState) {
    tokio::spawn(async move {
        ensure_tables(&state.pool).await;
        retire_legacy_guards(&state).await;
        let mut s = load_settings(&state.pool).await;
        apply_log_rotation(&s);
        let mut next = s.next_run();
        let mut last_disk_check = Instant::now() - std::time::Duration::from_secs(3600);
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            tick.tick().await;
            let fresh = load_settings(&state.pool).await;
            if fresh != s {
                s = fresh;
                apply_log_rotation(&s);
                next = s.next_run();
            }
            if !s.enabled {
                continue;
            }
            if next.is_some_and(|t| Utc::now() >= t) {
                run_all(&state, "schedule", None).await;
                next = s.next_run();
                continue;
            }
            if last_disk_check.elapsed() >= std::time::Duration::from_secs(300) {
                last_disk_check = Instant::now();
                for node in gc_nodes(&state).await.iter().filter(|n| n.online) {
                    let Ok(out) = exec(&state, node, &docker_gc::disk_command(), 30).await else {
                        continue;
                    };
                    let pct = docker_gc::parse_disk(&out).percent;
                    let last = emergency_marks()
                        .lock()
                        .ok()
                        .and_then(|m| m.get(&node.id).copied());
                    if emergency_due(pct, s.disk_alert_percent, last, Instant::now()) {
                        tracing::warn!(node = %node.name, percent = pct, "disque Docker au-dessus du seuil : nettoyage d'urgence");
                        if let Ok(mut m) = emergency_marks().lock() {
                            m.insert(node.id.clone(), Instant::now());
                        }
                        run_all(&state, "emergency", Some(&node.id)).await;
                    }
                }
            }
        }
    });
}
