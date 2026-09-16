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
            leader_url: joined.leader_url,
            node_id: joined.node.id,
            node_secret: joined.secret,
            node_name: pending.name,
            advertise_url: pending.advertise_url,
        })
        .await?;
    let _ = clear_pending_join().await;
    tracing::info!("nœud worker enregistré auprès du leader");
    Ok(())
}

pub async fn maybe_start_heartbeat(state: &AppState) {
    if let Ok(local) = state.cluster.local().await {
        if local.role == NodeRole::Worker && !local.node_secret.is_empty() {
            crate::cluster_routes::spawn_heartbeat(state.cluster.clone());
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
        .with_state(state)
}

pub fn exec_route() -> Router<AppState> {
    Router::new().route("/internal/exec", post(internal_exec))
}

async fn worker_health(State(state): State<AppState>) -> Json<Value> {
    let local = state.cluster.local().await.ok();
    Json(json!({
        "ok": true,
        "service": "devforge-worker",
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
