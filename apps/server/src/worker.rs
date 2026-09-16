//! Worker boot: pending join file, heartbeat, /internal/exec, UI statut.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use devforge_cluster::{
    clear_pending_join, collect_node_metrics, load_pending_join, ExecBody, JoinRequest,
    LeaderClient, LocalClusterState, NodeRole,
};
use devforge_deploy::{LocalShellExecutor, RemoteExecutor};
use serde::Deserialize;
use serde_json::{json, Value};
use tower_http::services::{ServeDir, ServeFile};

use crate::state::AppState;

pub async fn consume_pending_join(state: &AppState) -> Result<(), Box<dyn std::error::Error>> {
    let local = state.cluster.local().await?;
    if local.role == NodeRole::Worker && !local.node_secret.is_empty() {
        return Ok(());
    }
    let Some(pending) = load_pending_join().await? else {
        return Ok(());
    };
    tracing::info!(leader = %pending.leader_url, "cluster pending join trouvé");
    let client = LeaderClient::new(&pending.leader_url);
    let joined = client
        .join(&JoinRequest {
            token: pending.token,
            name: pending.name.clone(),
            advertise_url: pending.advertise_url.clone(),
            os: std::env::consts::OS.into(),
            arch: std::env::consts::ARCH.into(),
            capabilities: vec!["docker".into()],
            ..Default::default()
        })
        .await?;
    state
        .cluster
        .set_local(&LocalClusterState {
            role: NodeRole::Worker,
            leader_url: joined.leader_url.clone(),
            node_id: joined.node.id,
            node_secret: joined.secret,
            node_name: pending.name,
            advertise_url: pending.advertise_url,
            preferred_leader_id: devforge_cluster::LEADER_NODE_ID.into(),
            preferred_leader_url: joined.leader_url,
            ..Default::default()
        })
        .await?;
    let _ = clear_pending_join().await;
    tracing::info!("nœud worker enregistré auprès du leader");
    Ok(())
}

pub async fn maybe_start_heartbeat(state: &AppState) {
    if let Ok(local) = state.cluster.local().await {
        if local.role == NodeRole::Worker && !local.node_secret.is_empty() {
            spawn_worker_loop(state.clone());
        }
    }
}

pub fn worker_router(state: AppState) -> Router {
    Router::new()
        .route("/api/v1/health", get(worker_health))
        .route("/api/v1/bootstrap", get(worker_bootstrap))
        .route(
            "/api/v1/cluster/local",
            get(worker_local).patch(worker_local_patch),
        )
        .route("/internal/exec", post(internal_exec))
        .route("/internal/update/status", get(internal_update_status))
        .route("/internal/update/start", post(internal_update_start))
        .merge(crate::cluster_routes::internal_cluster_routes())
        .with_state(state)
}

pub fn exec_route() -> Router<AppState> {
    Router::new()
        .route("/internal/exec", post(internal_exec))
        .route("/internal/update/status", get(internal_update_status))
        .route("/internal/update/start", post(internal_update_start))
        .merge(crate::cluster_routes::internal_cluster_routes())
}

async fn worker_health(State(state): State<AppState>) -> Json<Value> {
    let local = state.cluster.local().await.ok();
    Json(json!({
        "ok": true,
        "service": "devforge-worker",
        "version": state.updater.current_version(),
        "role": local.as_ref().map(|l| l.role).unwrap_or(NodeRole::Worker),
        "node_id": local.as_ref().map(|l| l.node_id.clone()),
        "leader_url": local.as_ref().map(|l| l.leader_url.clone()),
    }))
}

async fn worker_bootstrap(State(state): State<AppState>) -> Json<Value> {
    let local = state.cluster.local().await.ok();
    Json(json!({
        "ok": true,
        "needs_setup": false,
        "authenticated": false,
        "onboarding": { "required": false, "steps": {} },
        "settings": {
            "instance_name": local.as_ref().map(|l| l.node_name.clone()).unwrap_or_default(),
            "instance_url": "",
            "wildcard_domain": "",
            "github_connected": false,
            "ssh_host": "",
            "ssh_user": "",
        },
        "cluster": local.as_ref().map(|l| json!({
            "role": l.role,
            "leader_url": l.leader_url,
            "node_id": l.node_id,
            "node_name": l.node_name,
        })),
    }))
}

async fn worker_local(State(state): State<AppState>) -> Json<Value> {
    let local = state.cluster.local().await.ok();
    Json(json!({
        "ok": true,
        "role": local.as_ref().map(|l| l.role),
        "leader_url": local.as_ref().map(|l| l.leader_url.clone()).unwrap_or_default(),
        "advertise_url": local.as_ref().map(|l| l.advertise_url.clone()).unwrap_or_default(),
        "node_id": local.as_ref().map(|l| l.node_id.clone()).unwrap_or_default(),
        "node_name": local.as_ref().map(|l| l.node_name.clone()).unwrap_or_default(),
        "metrics": collect_node_metrics(),
    }))
}

#[derive(Deserialize)]
struct WorkerLocalPatch {
    #[serde(default)]
    leader_url: Option<String>,
    #[serde(default)]
    advertise_url: Option<String>,
}

async fn worker_local_patch(
    State(state): State<AppState>,
    Json(body): Json<WorkerLocalPatch>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if body.leader_url.is_none() && body.advertise_url.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Rien à modifier (leader_url / advertise_url)"})),
        ));
    }
    let local = state
        .cluster
        .patch_local(body.leader_url, body.advertise_url)
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": e.to_string()})),
            )
        })?;
    let cluster = state.cluster.clone();
    tokio::spawn(async move {
        for attempt in 0..6u32 {
            if crate::cluster_routes::send_heartbeat(&cluster, true).await {
                break;
            }
            if attempt + 1 < 6 {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            }
        }
    });
    Ok(Json(json!({
        "ok": true,
        "role": local.role,
        "leader_url": local.leader_url,
        "advertise_url": local.advertise_url,
        "node_id": local.node_id,
        "node_name": local.node_name,
    })))
}

pub async fn internal_exec(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ExecBody>,
) -> Result<Json<devforge_deploy::ExecResult>, (StatusCode, Json<Value>)> {
    let local = state.cluster.local().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    if local.role != NodeRole::Worker || local.node_secret.is_empty() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({"error": "pas un nœud worker"})),
        ));
    }
    let provided = crate::auth_routes::bearer_from(&headers).unwrap_or_default();
    if provided != local.node_secret {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "secret nœud invalide"})),
        ));
    }
    if body.command.trim().is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "command requise"})),
        ));
    }
    let timeout = if body.timeout_secs == 0 {
        120
    } else {
        body.timeout_secs
    };
    let result = LocalShellExecutor
        .exec("default", &body.workdir, &body.command, timeout)
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error": e.to_string()})),
            )
        })?;
    Ok(Json(result))
}

async fn require_node_secret(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<LocalClusterState, (StatusCode, Json<Value>)> {
    let local = state.cluster.local().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    if local.node_secret.is_empty() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({"error": "secret nœud absent"})),
        ));
    }
    let provided = crate::auth_routes::bearer_from(headers).unwrap_or_default();
    if provided != local.node_secret {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "secret nœud invalide"})),
        ));
    }
    Ok(local)
}

async fn internal_update_status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let _ = require_node_secret(&state, &headers).await?;
    Ok(Json(json!({
        "ok": true,
        "data": state.updater.current_job().await,
        "version": state.updater.current_version(),
        "mode": state.updater.config().mode.as_str(),
    })))
}

#[derive(Deserialize)]
struct InternalUpdateStart {
    #[serde(default)]
    target_version: Option<String>,
}

async fn internal_update_start(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<InternalUpdateStart>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let _ = require_node_secret(&state, &headers).await?;
    let job = state
        .updater
        .start(body.target_version)
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": e.to_string()})),
            )
        })?;
    Ok(Json(json!({
        "ok": true,
        "data": job,
    })))
}

pub fn with_static_fallback(mut app: Router) -> Router {
    if let Some(root) = crate::paths::web_dir() {
        let index = root.join("index.html");
        if index.is_file() {
            app = app.fallback_service(
                ServeDir::new(&root).not_found_service(ServeFile::new(index)),
            );
        } else {
            app = app.fallback_service(ServeDir::new(&root));
        }
    }
    app
}

pub fn is_worker_role(local: &LocalClusterState) -> bool {
    local.role == NodeRole::Worker && !local.node_secret.is_empty()
}

pub async fn apply_promote_flag(state: &AppState) {
    let flag = devforge_cluster::promote_flag_path();
    if !flag.is_file() {
        return;
    }
    let ident = tokio::fs::read_to_string(devforge_cluster::failover_identity_path())
        .await
        .ok()
        .and_then(|s| serde_json::from_str::<LocalClusterState>(&s).ok());
    let Some(ident) = ident else {
        let _ = tokio::fs::remove_file(&flag).await;
        return;
    };
    let mut local = ident;
    local.role = NodeRole::Leader;
    local.acting_leader = true;
    local.leader_url = local.advertise_url.clone();
    if let Err(e) = state.cluster.set_local(&local).await {
        tracing::error!(error = %e, "échec promotion intérim");
        return;
    }
    let _ = tokio::fs::remove_file(&flag).await;
    tracing::warn!(node = %local.node_id, "leader intérimaire — en attendant le leader d’origine");
}

pub async fn apply_reclaim_flag(state: &AppState) {
    let flag = devforge_cluster::reclaim_flag_path();
    if !flag.is_file() {
        return;
    }
    let ident = tokio::fs::read_to_string(&flag)
        .await
        .ok()
        .and_then(|s| serde_json::from_str::<LocalClusterState>(&s).ok());
    let Some(mut ident) = ident else {
        tracing::error!("cluster-reclaim.json illisible — identity non restaurée");
        return;
    };
    ident.role = NodeRole::Leader;
    ident.acting_leader = false;
    if !ident.advertise_url.trim().is_empty() {
        ident.leader_url = ident.advertise_url.clone();
    }
    if let Err(e) = state.cluster.set_local(&ident).await {
        tracing::error!(error = %e, "échec restauration identité leader d’origine");
        return;
    }
    let _ = tokio::fs::remove_file(&flag).await;
    tracing::info!(node = %ident.node_id, "leader d’origine repris après intérim");
}

fn spawn_worker_loop(state: AppState) {
    tokio::spawn(async move {
        let mut fail = 0u32;
        let mut last_snap = std::time::Instant::now()
            .checked_sub(std::time::Duration::from_secs(90))
            .unwrap_or_else(std::time::Instant::now);
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(15)).await;
            let local = match state.cluster.local().await {
                Ok(l) => l,
                Err(_) => continue,
            };
            if local.role != NodeRole::Worker || local.node_secret.is_empty() {
                continue;
            }
            let client = LeaderClient::new(&local.leader_url);
            match client
                .heartbeat(
                    &local.node_secret,
                    &devforge_cluster::HeartbeatPayload {
                        node_id: local.node_id.clone(),
                        metrics: Some(collect_node_metrics()),
                        ..Default::default()
                    },
                )
                .await
            {
                Ok(ack) => {
                    fail = 0;
                    let need_snap = ack.generation > local.snapshot_generation
                        || last_snap.elapsed() > std::time::Duration::from_secs(60);
                    persist_ack(&state, &local, &ack).await;
                    if need_snap {
                        let secret = if ack.failover_secret.is_empty() {
                            local.node_secret.clone()
                        } else {
                            ack.failover_secret.clone()
                        };
                        if let Ok(bytes) = client.fetch_snapshot(&secret).await {
                            if bytes.len() >= 100 && bytes.starts_with(b"SQLite format 3\0") {
                                let dest = devforge_cluster::snapshot_path();
                                if let Some(parent) = dest.parent() {
                                    let _ = tokio::fs::create_dir_all(parent).await;
                                }
                                let _ = tokio::fs::write(&dest, bytes).await;
                                last_snap = std::time::Instant::now();
                            }
                        }
                    }
                }
                Err(_) => {
                    fail += 1;
                    let preferred = if local.preferred_leader_url.trim().is_empty() {
                        local.leader_url.clone()
                    } else {
                        local.preferred_leader_url.clone()
                    };
                    let pref = LeaderClient::new(&preferred);
                    if preferred != local.leader_url && pref.ping_health().await {
                        tracing::info!(url = %preferred, "leader d’origine de retour");
                        let mut n = local.clone();
                        n.leader_url = preferred;
                        n.acting_leader = false;
                        let _ = state.cluster.set_local(&n).await;
                        fail = 0;
                        continue;
                    }
                    if fail >= devforge_cluster::FAILOVER_FAIL_STREAK {
                        try_elect(&state, &local).await;
                        fail = 0;
                    }
                }
            }
        }
    });
}

async fn persist_ack(state: &AppState, local: &LocalClusterState, ack: &devforge_cluster::HeartbeatAck) {
    let mut n = local.clone();
    if !ack.preferred_leader_id.is_empty() {
        n.preferred_leader_id = ack.preferred_leader_id.clone();
    }
    if !ack.preferred_leader_url.is_empty() {
        n.preferred_leader_url = ack.preferred_leader_url.clone();
    }
    if !ack.failover_secret.is_empty() {
        n.failover_secret = ack.failover_secret.clone();
    }
    n.snapshot_generation = ack.generation;
    let _ = state.cluster.set_local(&n).await;
    if !ack.roster.is_empty() {
        if let Ok(json) = serde_json::to_string_pretty(&ack.roster) {
            let _ = tokio::fs::write(devforge_cluster::roster_path(), json).await;
        }
    }
    if let Ok(json) = serde_json::to_string_pretty(&n) {
        let _ = tokio::fs::write(devforge_cluster::failover_identity_path(), json).await;
    }
}

async fn try_elect(state: &AppState, local: &LocalClusterState) {
    let roster: Vec<devforge_cluster::RosterEntry> =
        tokio::fs::read_to_string(devforge_cluster::roster_path())
            .await
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
    if roster.is_empty() {
        return;
    }
    if !local.failover_secret.is_empty() {
        for peer in devforge_cluster::earlier_candidates(&local.node_id, &roster) {
            let c = LeaderClient::new(&peer.advertise_url);
            if let Ok(st) = c.failover_status(&local.failover_secret).await {
                if st.acting_leader {
                    tracing::info!(peer = %peer.id, "suivi du leader intérimaire");
                    let mut n = local.clone();
                    n.leader_url = peer.advertise_url.clone();
                    let _ = state.cluster.set_local(&n).await;
                    return;
                }
            }
        }
    }
    if !devforge_cluster::i_am_failover_winner(&local.node_id, &roster) {
        return;
    }
    let snap = devforge_cluster::snapshot_path();
    if !snap.is_file() {
        tracing::warn!("élection gagnée mais pas de snapshot SQLite — impossible de promouvoir");
        return;
    }
    if let Ok(json) = serde_json::to_string_pretty(local) {
        if let Err(e) = tokio::fs::write(devforge_cluster::failover_identity_path(), json).await {
            tracing::error!(error = %e, "écriture identité failover");
            return;
        }
    } else {
        return;
    }
    let pending = format!("{}.pending-restore", state.db_path.display());
    if let Err(e) = tokio::fs::copy(&snap, &pending).await {
        tracing::error!(error = %e, "copie snapshot failover");
        return;
    }
    if let Err(e) = tokio::fs::write(devforge_cluster::promote_flag_path(), "1").await {
        tracing::error!(error = %e, "écriture flag promotion");
        return;
    }
    tracing::warn!(node = %local.node_id, "promotion leader intérimaire, redémarrage");
    devforge_cluster::restart_current_process();
}

pub async fn maybe_reclaim_preferred(state: &AppState) {
    let local = match state.cluster.local().await {
        Ok(l) => l,
        Err(_) => return,
    };
    if local.role != NodeRole::Leader || local.acting_leader {
        return;
    }
    if local.node_id != local.preferred_leader_id
        && local.node_id != devforge_cluster::LEADER_NODE_ID
    {
        return;
    }
    let nodes = match state.cluster.list_nodes().await {
        Ok(n) => n,
        Err(_) => return,
    };
    for n in nodes {
        if n.advertise_url.trim().is_empty() || n.id == local.node_id {
            continue;
        }
        let c = LeaderClient::new(&n.advertise_url);
        let Ok(st) = c.failover_status(&local.failover_secret).await else {
            continue;
        };
        if !st.acting_leader {
            continue;
        }
        tracing::warn!(interim = %n.id, "récupération du control plane auprès de l’intérim");
        let secret = if local.failover_secret.is_empty() {
            local.node_secret.clone()
        } else {
            local.failover_secret.clone()
        };
        let Ok(bytes) = c.fetch_snapshot(&secret).await else {
            tracing::error!(interim = %n.id, "snapshot intérim injoignable — pas de démotion");
            continue;
        };
        if bytes.len() < 100 || !bytes.starts_with(b"SQLite format 3\0") {
            tracing::error!(interim = %n.id, "snapshot intérim invalide — pas de démotion");
            continue;
        }
        let pending = format!("{}.pending-restore", state.db_path.display());
        if let Err(e) = tokio::fs::write(&pending, &bytes).await {
            tracing::error!(error = %e, "écriture pending-restore");
            continue;
        }
        if let Ok(json) = serde_json::to_string_pretty(&local) {
            let _ = tokio::fs::write(devforge_cluster::reclaim_flag_path(), json).await;
        }
        let pref_url = if local.advertise_url.is_empty() {
            local.leader_url.clone()
        } else {
            local.advertise_url.clone()
        };
        let _ = c.failover_demote(&secret, &pref_url).await;
        tracing::info!("restauration snapshot intérim, redémarrage");
        devforge_cluster::restart_current_process();
    }
}
