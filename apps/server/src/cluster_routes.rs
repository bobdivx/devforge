//! Cluster HTTP API — invitations, join, heartbeat, add-via-SSH.

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{delete, get, patch, post},
    Json, Router,
};
use chrono::Utc;
use devforge_cluster::{
    collect_node_metrics, diagnostic_command, AddNodeRequest, HeartbeatPayload, JoinRequest,
    LeaderClient, LocalClusterState, NodeRole, NodeStatus, LEADER_NODE_ID,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::state::AppState;

static JOIN_HITS: once_cell::sync::Lazy<Mutex<HashMap<String, (u32, Instant)>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(HashMap::new()));

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/cluster/nodes", get(list_nodes).post(add_node))
        .route(
            "/api/v1/cluster/nodes/{id}",
            patch(patch_node).delete(remove_node),
        )
        .route("/api/v1/cluster/nodes/{id}/projects", get(node_projects))
        .route("/api/v1/cluster/nodes/{id}/reassign", post(reassign_projects))
        .route("/api/v1/cluster/nodes/{id}/logs", get(node_logs))
        .route(
            "/api/v1/cluster/nodes/{id}/update",
            get(node_update_status).post(node_update_start),
        )
        .route("/api/v1/cluster/update-workers", post(update_workers))
        .route("/api/v1/cluster/invites", get(list_invites).post(create_invite))
        .route("/api/v1/cluster/invites/{id}", delete(revoke_invite))
        .route("/api/v1/cluster/join", post(join_node))
        .route("/api/v1/cluster/heartbeat", post(heartbeat))
        .route("/api/v1/cluster/local", get(local_state).post(local_join).patch(local_patch))
        .route(
            "/api/v1/cluster/settings",
            get(cluster_settings).patch(patch_cluster_settings),
        )
        .route("/api/v1/cluster/rebalance", post(rebalance))
}

pub fn internal_cluster_routes() -> Router<AppState> {
    Router::new()
        .route("/internal/cluster-snapshot", get(cluster_snapshot))
        .route("/internal/failover/status", get(failover_status))
        .route("/internal/failover/demote", post(failover_demote))
}

async fn require_admin(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<crate::auth_routes::UserRow, (StatusCode, Json<Value>)> {
    let (user, _) = crate::auth_routes::current_workspace(state, headers).await?;
    if user.role != "instance_admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Réservé à l’administrateur d’instance"})),
        ));
    }
    Ok(user)
}

fn map_err(e: devforge_shared::DevForgeError) -> (StatusCode, Json<Value>) {
    let msg = e.to_string();
    let status = if msg.contains("not found") || msg.contains("inconnu") {
        StatusCode::NOT_FOUND
    } else if msg.contains("invalide") || msg.contains("révoquée") || msg.contains("expirée") {
        StatusCode::UNAUTHORIZED
    } else {
        StatusCode::BAD_REQUEST
    };
    (status, Json(json!({"error": msg})))
}

fn bearer(headers: &HeaderMap) -> Option<String> {
    crate::auth_routes::bearer_from(headers)
}

fn rate_limit_join(headers: &HeaderMap) -> Result<(), (StatusCode, Json<Value>)> {
    let ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or(s).trim().to_string())
        .unwrap_or_else(|| "local".into());
    let mut g = JOIN_HITS.lock().unwrap_or_else(|e| e.into_inner());
    let now = Instant::now();
    g.retain(|_, (_, t)| now.duration_since(*t) < Duration::from_secs(60));
    let entry = g.entry(ip).or_insert((0, now));
    if now.duration_since(entry.1) > Duration::from_secs(60) {
        *entry = (0, now);
    }
    entry.0 += 1;
    if entry.0 > 20 {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({"error": "Trop de tentatives de join"})),
        ));
    }
    Ok(())
}

async fn instance_url(state: &AppState) -> String {
    let row: Option<(String,)> =
        sqlx::query_as("SELECT instance_url FROM instance_settings WHERE id = 1")
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
    row.map(|r| r.0)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "http://127.0.0.1:8000".into())
}

async fn list_nodes(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let local = state.cluster.local().await.map_err(map_err)?;
    let mut nodes = state.cluster.list_nodes().await.map_err(map_err)?;
    let counts = project_counts_by_node(&state).await;
    let leader_metrics = collect_node_metrics();
    if let Some(ip) = leader_metrics.public_ip.as_deref() {
        crate::dns::note_public_ip(&state, "default", ip).await;
    }
    for n in &mut nodes {
        if n.role == NodeRole::Leader || n.id == local.node_id {
            n.metrics = leader_metrics.clone();
        }
    }
    Ok(Json(json!({
        "ok": true,
        "preferred_leader_id": local.preferred_leader_id,
        "preferred_leader_url": local.preferred_leader_url,
        "acting_leader": local.acting_leader,
        "acting_node_id": local.node_id,
        "leader_version": state.updater.current_version(),
        "placement_auto": placement_auto_enabled(&state).await,
        "nodes": nodes.iter().map(|n| {
            let mut v = devforge_cluster::ClusterFacade::node_json(n);
            let key = normalize_server_id(&n.id);
            v["project_count"] = json!(counts.get(&key).copied().unwrap_or(0));
            let advertise_ok = n.role == NodeRole::Leader
                || (!n.advertise_url.trim().is_empty()
                    && !devforge_cluster::is_loopback_advertise_url(&n.advertise_url));
            let ingress_ready = !n.ingress_host.trim().is_empty();
            v["advertise_ok"] = json!(advertise_ok);
            v["ingress_ready"] = json!(ingress_ready);
            v["placement_eligible"] = json!(
                !n.drained
                    && n.status == NodeStatus::Online
                    && (n.role == NodeRole::Leader || advertise_ok)
            );
            if n.role == NodeRole::Worker && !advertise_ok {
                v["advertise_hint"] = json!(
                    "URL d’annonce loopback ou vide — le leader ne peut pas joindre ce worker (corrige l’IP LAN)"
                );
            }
            v
        }).collect::<Vec<_>>(),
    })))
}

async fn add_node(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<AddNodeRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let admin = require_admin(&state, &headers).await?;
    let leader_url = instance_url(&state).await;
    let (key, _) = crate::auth_routes::ssh_key_paths();
    let identity = if key.is_file() { Some(key) } else { None };
    let image = state.updater.config().image.clone();
    let node = state
        .cluster
        .add_via_ssh(body, &leader_url, identity, &image, &admin.uuid)
        .await
        .map_err(map_err)?;
    Ok(Json(json!({
        "ok": true,
        "node": devforge_cluster::ClusterFacade::node_json(&node),
    })))
}

#[derive(Deserialize)]
struct RemoveQuery {
    #[serde(default)]
    reassign_to: Option<String>,
}

#[derive(Deserialize)]
struct PatchNodeBody {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    drained: Option<bool>,
    #[serde(default)]
    advertise_url: Option<String>,
    #[serde(default)]
    ingress_host: Option<String>,
}

async fn patch_node(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<PatchNodeBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    if body.name.is_none()
        && body.drained.is_none()
        && body.advertise_url.is_none()
        && body.ingress_host.is_none()
    {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Rien à modifier (name / drained / advertise_url / ingress_host)"})),
        ));
    }
    let node = state
        .cluster
        .patch_node(
            &id,
            body.name,
            body.drained,
            body.advertise_url,
            body.ingress_host.clone(),
        )
        .await
        .map_err(map_err)?;
    if body.ingress_host.is_some() {
        let rows: Vec<(String,)> = sqlx::query_as(
            r#"SELECT uuid FROM projects
               WHERE COALESCE(NULLIF(trim(COALESCE(server_id, '')), ''), 'default') = ?"#,
        )
        .bind(normalize_server_id(&id))
        .fetch_all(&state.pool)
        .await
        .unwrap_or_default();
        for (uuid,) in rows {
            crate::dns::sync_project(&state, &uuid).await;
        }
    }
    Ok(Json(json!({
        "ok": true,
        "node": devforge_cluster::ClusterFacade::node_json(&node),
    })))
}

async fn remove_node(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(q): Query<RemoveQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let count = count_projects_on_node(&state, &id).await.map_err(map_err_sql)?;
    if count > 0 {
        if let Some(target) = q
            .reassign_to
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            reassign_all_from(&state, &id, target).await?;
        } else {
            return Err((
                StatusCode::CONFLICT,
                Json(json!({
                    "error": format!("{count} projet(s) sont encore sur ce nœud. Réassigne-les ou passe reassign_to."),
                    "project_count": count,
                })),
            ));
        }
    }
    let deleted = state.cluster.remove_node(&id).await.map_err(map_err)?;
    if !deleted {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({"error": format!("nœud {id} introuvable")})),
        ));
    }
    Ok(Json(json!({"ok": true, "deleted": id})))
}

#[derive(Deserialize)]
struct InviteBody {
    #[serde(default)]
    leader_url: Option<String>,
    #[serde(default)]
    ttl_hours: Option<i64>,
}

async fn create_invite(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<InviteBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let admin = require_admin(&state, &headers).await?;
    let url = body
        .leader_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or(instance_url(&state).await);
    let invite = state
        .cluster
        .create_invite(&admin.uuid, &url, body.ttl_hours.unwrap_or(24))
        .await
        .map_err(map_err)?;
    Ok(Json(json!({
        "ok": true,
        "invite": {
            "id": invite.id,
            "token": invite.token,
            "leader_url": invite.leader_url,
            "code": invite.token,
            "expires_at": invite.expires_at,
        }
    })))
}

async fn list_invites(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let rows = state.cluster.list_invites().await.map_err(map_err)?;
    Ok(Json(json!({
        "ok": true,
        "invites": rows.iter().map(|t| json!({
            "id": t.id,
            "expires_at": t.expires_at,
            "revoked_at": t.revoked_at,
            "created_at": t.created_at,
        })).collect::<Vec<_>>(),
    })))
}

async fn revoke_invite(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let ok = state.cluster.revoke_invite(&id).await.map_err(map_err)?;
    Ok(Json(json!({"ok": ok})))
}

async fn join_node(
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(body): Json<JoinRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    rate_limit_join(&headers)?;
    let local = state.cluster.local().await.map_err(map_err)?;
    if local.role == NodeRole::Worker {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Cette instance est un worker, pas un leader"})),
        ));
    }
    let leader_url = instance_url(&state).await;
    let joined = state.cluster.join(body, &leader_url).await.map_err(map_err)?;
    let sid = joined.node.id.clone();
    let st = state.clone();
    tokio::spawn(async move {
        crate::dns::provision_node(&st, &sid).await;
    });
    Ok(Json(json!(joined)))
}

async fn heartbeat(
    headers: HeaderMap,
    State(state): State<AppState>,
    Json(body): Json<HeartbeatPayload>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let secret = bearer(&headers).ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "secret nœud requis"})),
        )
    })?;
    let ack = state
        .cluster
        .heartbeat_ack(&secret, body.clone())
        .await
        .map_err(map_err)?;
    if let Some(ip) = body
        .metrics
        .as_ref()
        .and_then(|m| m.public_ip.clone())
    {
        crate::dns::note_public_ip(&state, &body.node_id, &ip).await;
    }
    let need = state
        .cluster
        .store()
        .get_node(&body.node_id)
        .await
        .ok()
        .flatten()
        .map(|n| n.ingress_host.trim().is_empty())
        .unwrap_or(false);
    if need {
        let sid = body.node_id.clone();
        let st = state.clone();
        tokio::spawn(async move {
            crate::dns::provision_node(&st, &sid).await;
        });
    }
    Ok(Json(serde_json::to_value(&ack).unwrap_or_else(|_| json!({"ok": true}))))
}

async fn local_state(State(state): State<AppState>) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let local = state.cluster.local().await.map_err(map_err)?;
    Ok(Json(json!({
        "ok": true,
        "role": local.role,
        "leader_url": local.leader_url,
        "advertise_url": local.advertise_url,
        "node_id": local.node_id,
        "node_name": local.node_name,
        "metrics": collect_node_metrics(),
    })))
}

#[derive(Deserialize)]
struct LocalPatchBody {
    #[serde(default)]
    leader_url: Option<String>,
    #[serde(default)]
    advertise_url: Option<String>,
}

async fn local_patch(
    State(state): State<AppState>,
    Json(body): Json<LocalPatchBody>,
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
        .map_err(map_err)?;
    Ok(Json(json!({
        "ok": true,
        "role": local.role,
        "leader_url": local.leader_url,
        "advertise_url": local.advertise_url,
        "node_id": local.node_id,
        "node_name": local.node_name,
    })))
}

#[derive(Deserialize)]
struct LocalJoinBody {
    #[serde(default)]
    leader_url: String,
    token: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    advertise_url: Option<String>,
}

async fn local_join(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<LocalJoinBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let local = state.cluster.local().await.map_err(map_err)?;
    if local.role == NodeRole::Worker && !local.node_secret.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Cette instance a déjà rejoint un cluster"})),
        ));
    }
    let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM users")
        .fetch_one(&state.pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        })?;
    if count.0 > 0 {
        let _ = require_admin(&state, &headers).await?;
    }

    let name = body
        .name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(hostname_fallback);
    let advertise_url = if let Some(u) = body
        .advertise_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        u.trim_end_matches('/').to_string()
    } else {
        let from_settings = instance_url(&state).await;
        if !from_settings.is_empty()
            && !devforge_cluster::is_loopback_advertise_url(&from_settings)
        {
            from_settings
        } else {
            String::new()
        }
    };
    let advertise_url = match devforge_cluster::validate_worker_advertise_url(&advertise_url) {
        Ok(u) => u,
        Err(msg) => {
            let dns = crate::dns::load(&state).await;
            let hint = if crate::dns::configured(&dns) {
                format!(
                    "{msg}. DNS {} actif : utilise le hostname / domaine public du nœud (pas l’IP machine ni localhost).",
                    if dns.provider.is_empty() {
                        "domaine"
                    } else {
                        dns.provider.as_str()
                    }
                )
            } else {
                format!(
                    "{msg}. Indique une URL d’annonce (domaine public ou IP LAN joignable depuis le leader)."
                )
            };
            return Err((StatusCode::BAD_REQUEST, Json(json!({ "error": hint }))));
        }
    };

    let (leader_url, token) =
        devforge_cluster::parse_join_invite(&body.token, &body.leader_url).map_err(|msg| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": msg})),
            )
        })?;

    let client = LeaderClient::new(&leader_url);
    let joined = client
        .join(&JoinRequest {
            token,
            name: name.clone(),
            advertise_url: advertise_url.clone(),
            os: std::env::consts::OS.into(),
            arch: std::env::consts::ARCH.into(),
            capabilities: vec!["docker".into()],
            ..Default::default()
        })
        .await
        .map_err(map_err)?;

    let next = LocalClusterState {
        role: NodeRole::Worker,
        leader_url: joined.leader_url.clone(),
        node_id: joined.node.id.clone(),
        node_secret: joined.secret.clone(),
        node_name: name,
        advertise_url: advertise_url.clone(),
        preferred_leader_id: devforge_cluster::LEADER_NODE_ID.into(),
        preferred_leader_url: joined.leader_url.clone(),
        ..Default::default()
    };
    state.cluster.set_local(&next).await.map_err(map_err)?;
    spawn_heartbeat(state.cluster.clone());

    Ok(Json(json!({
        "ok": true,
        "role": "worker",
        "node": devforge_cluster::ClusterFacade::node_json(&joined.node),
        "leader_url": joined.leader_url,
    })))
}

fn hostname_fallback() -> String {
    std::env::var("HOSTNAME")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "worker".into())
}

pub fn spawn_heartbeat(cluster: Arc<devforge_cluster::ClusterFacade>) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(15)).await;
            let _ = send_heartbeat(&cluster, false).await;
        }
    });
}

/// `include_advertise` : n’envoyer l’URL du nœud que lors d’un PATCH local,
/// pour ne pas écraser une adresse corrigée depuis le leader.
pub async fn send_heartbeat(
    cluster: &devforge_cluster::ClusterFacade,
    include_advertise: bool,
) -> bool {
    let local = match cluster.local().await {
        Ok(l) => l,
        Err(_) => return false,
    };
    if local.role != NodeRole::Worker || local.node_secret.is_empty() {
        return false;
    }
    let client = LeaderClient::new(&local.leader_url);
    let advertise_url = if include_advertise && !local.advertise_url.trim().is_empty() {
        Some(local.advertise_url.clone())
    } else {
        None
    };
    if let Err(e) = client
        .heartbeat(
            &local.node_secret,
            &HeartbeatPayload {
                node_id: local.node_id.clone(),
                advertise_url,
                os: Some(std::env::consts::OS.into()),
                arch: Some(std::env::consts::ARCH.into()),
                capabilities: Some(vec!["docker".into()]),
                metrics: Some(collect_node_metrics()),
            },
        )
        .await
    {
        tracing::warn!(error = %e, "cluster heartbeat");
        return false;
    }
    true
}

pub(crate) fn normalize_server_id(id: &str) -> String {
    let t = id.trim();
    if t.is_empty() {
        "default".into()
    } else {
        t.to_string()
    }
}

fn map_err_sql(e: sqlx::Error) -> (StatusCode, Json<Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"error": e.to_string()})),
    )
}

async fn project_counts_by_node(state: &AppState) -> std::collections::HashMap<String, i64> {
    let rows: Vec<(Option<String>, i64)> = sqlx::query_as(
        r#"SELECT NULLIF(trim(COALESCE(server_id, '')), ''), COUNT(*) FROM projects GROUP BY 1"#,
    )
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default();
    let mut map = std::collections::HashMap::new();
    for (sid, n) in rows {
        let key = normalize_server_id(sid.as_deref().unwrap_or(""));
        *map.entry(key).or_insert(0) += n;
    }
    map
}

pub async fn placement_auto_enabled(state: &AppState) -> bool {
    let row: Option<(i64,)> =
        sqlx::query_as("SELECT COALESCE(placement_auto, 1) FROM instance_settings WHERE id = 1")
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
    row.map(|(v,)| v != 0).unwrap_or(true)
}

/// Résout le nœud cible : `auto` / vide → placement ; sinon id explicite.
pub async fn resolve_server_id(state: &AppState, requested: Option<&str>) -> String {
    let raw = requested.map(str::trim).unwrap_or("");
    let auto = raw.is_empty() || raw.eq_ignore_ascii_case("auto");
    if !auto {
        return normalize_server_id(raw);
    }
    if !placement_auto_enabled(state).await {
        return LEADER_NODE_ID.to_string();
    }
    let nodes = state.cluster.list_nodes().await.unwrap_or_default();
    let counts_i64 = project_counts_by_node(state).await;
    let counts: std::collections::HashMap<String, u32> = counts_i64
        .into_iter()
        .map(|(k, v)| (k, v.max(0) as u32))
        .collect();
    if let Some((id, _)) =
        devforge_cluster::pick_placement(&nodes, &counts, &devforge_cluster::PlacementWeights::default())
    {
        return normalize_server_id(&id);
    }
    LEADER_NODE_ID.to_string()
}

/// Si le nœud courant est mort / drainé / worker loopback, re-place (placement auto).
pub async fn ensure_live_server_id(state: &AppState, current: &str) -> String {
    let sid = normalize_server_id(current);
    let ok = match state.cluster.store().get_node(&sid).await {
        Ok(Some(n)) => {
            !n.drained
                && n.status == NodeStatus::Online
                && (n.role == NodeRole::Leader
                    || (!n.advertise_url.trim().is_empty()
                        && !devforge_cluster::is_loopback_advertise_url(&n.advertise_url)))
        }
        _ => false,
    };
    if ok {
        return sid;
    }
    if placement_auto_enabled(state).await {
        return resolve_server_id(state, Some("auto")).await;
    }
    sid
}

async fn cluster_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    Ok(Json(json!({
        "ok": true,
        "placement_auto": placement_auto_enabled(&state).await,
    })))
}

#[derive(Deserialize)]
struct PatchClusterSettings {
    #[serde(default)]
    placement_auto: Option<bool>,
}

async fn patch_cluster_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PatchClusterSettings>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    if body.placement_auto.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Rien à modifier (placement_auto)"})),
        ));
    }
    if let Some(v) = body.placement_auto {
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            "UPDATE instance_settings SET placement_auto = ?, updated_at = ? WHERE id = 1",
        )
        .bind(if v { 1i64 } else { 0 })
        .bind(&now)
        .execute(&state.pool)
        .await
        .map_err(map_err_sql)?;
    }
    Ok(Json(json!({
        "ok": true,
        "placement_auto": placement_auto_enabled(&state).await,
    })))
}

#[derive(Deserialize)]
struct RebalanceBody {
    #[serde(default)]
    apply: bool,
}

async fn rebalance(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RebalanceBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let nodes = state.cluster.list_nodes().await.map_err(map_err)?;
    let rows: Vec<(String, Option<String>, String)> = sqlx::query_as(
        "SELECT uuid, server_id, name FROM projects ORDER BY name",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(map_err_sql)?;

    let mut counts: HashMap<String, u32> = HashMap::new();
    for (_, sid, _) in &rows {
        let key = normalize_server_id(sid.as_deref().unwrap_or(""));
        *counts.entry(key).or_insert(0) += 1;
    }

    let weights = devforge_cluster::PlacementWeights::default();
    let mut suggestions = Vec::new();
    let mut moved = 0u32;
    let now = Utc::now().to_rfc3339();

    for (uuid, sid, name) in rows {
        let from = normalize_server_id(sid.as_deref().unwrap_or(""));
        // Simuler sans ce projet pour le score cible
        *counts.entry(from.clone()).or_insert(0) = counts.get(&from).copied().unwrap_or(0).saturating_sub(1);
        let Some((to, score)) = devforge_cluster::pick_placement(&nodes, &counts, &weights) else {
            *counts.entry(from).or_insert(0) += 1;
            continue;
        };
        let to = normalize_server_id(&to);
        *counts.entry(to.clone()).or_insert(0) += 1;
        if to == from {
            continue;
        }
        let item = json!({
            "project_uuid": uuid,
            "name": name,
            "from": from,
            "to": to,
            "score": score,
        });
        if body.apply {
            sqlx::query("UPDATE projects SET server_id = ?, updated_at = ? WHERE uuid = ?")
                .bind(&to)
                .bind(&now)
                .bind(&uuid)
                .execute(&state.pool)
                .await
                .map_err(map_err_sql)?;
            moved += 1;
            crate::dns::sync_project(&state, &uuid).await;
        }
        suggestions.push(item);
    }

    Ok(Json(json!({
        "ok": true,
        "dry_run": !body.apply,
        "moved": moved,
        "suggestions": suggestions,
    })))
}

async fn count_projects_on_node(state: &AppState, node_id: &str) -> Result<i64, sqlx::Error> {
    let key = normalize_server_id(node_id);
    let row: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*) FROM projects
           WHERE COALESCE(NULLIF(trim(COALESCE(server_id, '')), ''), 'default') = ?"#,
    )
    .bind(&key)
    .fetch_one(&state.pool)
    .await?;
    Ok(row.0)
}

async fn ensure_node_exists(
    state: &AppState,
    id: &str,
) -> Result<devforge_cluster::ClusterNode, (StatusCode, Json<Value>)> {
    state
        .cluster
        .list_nodes()
        .await
        .map_err(map_err)?
        .into_iter()
        .find(|n| n.id == id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": format!("nœud {id} introuvable")})),
            )
        })
}

async fn reassign_all_from(
    state: &AppState,
    from_id: &str,
    target: &str,
) -> Result<u64, (StatusCode, Json<Value>)> {
    let target = normalize_server_id(target);
    let _ = ensure_node_exists(state, &target).await?;
    let from = normalize_server_id(from_id);
    if from == target {
        return Ok(0);
    }
    let node = ensure_node_exists(state, &target).await?;
    if node.drained {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": format!("Le nœud {} est en drain", node.name)})),
        ));
    }
    let now = Utc::now().to_rfc3339();
    let r = sqlx::query(
        r#"UPDATE projects SET server_id = ?, updated_at = ?
           WHERE COALESCE(NULLIF(trim(COALESCE(server_id, '')), ''), 'default') = ?"#,
    )
    .bind(&target)
    .bind(&now)
    .bind(&from)
    .execute(&state.pool)
    .await
    .map_err(map_err_sql)?;
    Ok(r.rows_affected())
}

async fn node_projects(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let _ = ensure_node_exists(&state, &id).await?;
    let key = normalize_server_id(&id);
    let rows: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
        r#"SELECT uuid, name, status, server_id FROM projects
           WHERE COALESCE(NULLIF(trim(COALESCE(server_id, '')), ''), 'default') = ?
           ORDER BY name"#,
    )
    .bind(&key)
    .fetch_all(&state.pool)
    .await
    .map_err(map_err_sql)?;
    Ok(Json(json!({
        "ok": true,
        "projects": rows.into_iter().map(|(uuid, name, status, server_id)| json!({
            "uuid": uuid,
            "name": name,
            "status": status,
            "server_id": normalize_server_id(server_id.as_deref().unwrap_or("")),
        })).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize)]
struct ReassignBody {
    #[serde(default)]
    project_uuid: Option<String>,
    #[serde(default)]
    all: bool,
    target_node_id: String,
}

async fn reassign_projects(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<ReassignBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let _ = ensure_node_exists(&state, &id).await?;
    let target = normalize_server_id(&body.target_node_id);
    let dest = ensure_node_exists(&state, &target).await?;
    if dest.drained {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": format!("Le nœud {} est en drain", dest.name)})),
        ));
    }
    let now = Utc::now().to_rfc3339();
    let n = if body.all {
        reassign_all_from(&state, &id, &target).await? as i64
    } else {
        let uuid = body
            .project_uuid
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": "project_uuid ou all=true requis"})),
                )
            })?;
        let from = normalize_server_id(&id);
        let r = sqlx::query(
            r#"UPDATE projects SET server_id = ?, updated_at = ?
               WHERE uuid = ?
                 AND COALESCE(NULLIF(trim(COALESCE(server_id, '')), ''), 'default') = ?"#,
        )
        .bind(&target)
        .bind(&now)
        .bind(uuid)
        .bind(&from)
        .execute(&state.pool)
        .await
        .map_err(map_err_sql)?;
        if r.rows_affected() == 0 {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Projet introuvable sur ce nœud"})),
            ));
        }
        1
    };
    if body.all {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT uuid FROM projects WHERE updated_at = ? AND COALESCE(NULLIF(trim(COALESCE(server_id, '')), ''), 'default') = ?",
        )
        .bind(&now)
        .bind(&target)
        .fetch_all(&state.pool)
        .await
        .unwrap_or_default();
        for (uuid,) in rows {
            crate::dns::sync_project(&state, &uuid).await;
        }
    } else if let Some(uuid) = body.project_uuid.as_deref() {
        crate::dns::sync_project(&state, uuid).await;
    }
    Ok(Json(json!({
        "ok": true,
        "moved": n,
        "hint": "Le prochain déploiement ira sur le nœud cible. Les conteneurs déjà lancés restent où ils sont.",
    })))
}

async fn node_logs(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let node = ensure_node_exists(&state, &id).await?;
    let exec_id = if node.role == NodeRole::Leader {
        "default"
    } else {
        node.id.as_str()
    };
    let res = state
        .deploy
        .exec(exec_id, "", diagnostic_command(), 25)
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error": e.to_string()})),
            )
        })?;
    Ok(Json(json!({
        "ok": res.ok,
        "exit_code": res.exit_code,
        "output": res.output,
    })))
}

#[derive(Deserialize)]
struct NodeUpdateBody {
    #[serde(default)]
    target_version: Option<String>,
}

async fn worker_remote(
    state: &AppState,
    id: &str,
) -> Result<(devforge_cluster::ClusterNode, LeaderClient, String), (StatusCode, Json<Value>)> {
    let node = ensure_node_exists(state, id).await?;
    if node.role == NodeRole::Leader || node.id == "default" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Le leader se met à jour depuis Paramètres → Mise à jour."
            })),
        ));
    }
    let url = node.advertise_url.trim().to_string();
    if url.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "URL du nœud manquante — renseigne-la dans Infos."})),
        ));
    }
    let secret = state
        .cluster
        .store()
        .get_node_secret(&node.id)
        .await
        .map_err(map_err)?
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Secret du nœud manquant (nœud jamais enrôlé ?)"})),
            )
        })?;
    Ok((node, LeaderClient::new(&url), secret))
}

async fn resolve_update_target(
    state: &AppState,
    requested: Option<String>,
) -> Result<String, (StatusCode, Json<Value>)> {
    if let Some(t) = requested.filter(|s| !s.trim().is_empty()) {
        return Ok(t.trim().trim_start_matches('v').to_string());
    }
    let check = state.updater.check().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    check
        .latest
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().trim_start_matches('v').to_string())
        .ok_or_else(|| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error": "Impossible de déterminer la version cible."})),
            )
        })
}

async fn node_update_start(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<NodeUpdateBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let target = resolve_update_target(&state, body.target_version).await?;
    let (node, client, secret) = worker_remote(&state, &id).await?;
    let current = node
        .metrics
        .software_version
        .clone()
        .unwrap_or_default();
    if !current.is_empty() && !devforge_update::version_gt(&target, &current) {
        return Ok(Json(json!({
            "ok": true,
            "skipped": true,
            "node_id": node.id,
            "version": current,
            "target_version": target,
            "message": format!("{} est déjà en {}", node.name, current),
        })));
    }
    match client.node_update_start(&secret, Some(&target)).await {
        Ok(data) => Ok(Json(json!({
            "ok": true,
            "node_id": node.id,
            "target_version": target,
            "data": data.get("data").cloned().unwrap_or(data),
        }))),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("Déjà à jour") {
                return Ok(Json(json!({
                    "ok": true,
                    "skipped": true,
                    "node_id": node.id,
                    "target_version": target,
                    "message": msg,
                })));
            }
            let msg = if msg.contains("404") {
                format!(
                    "{} : ce nœud n’a pas encore l’API de MAJ distante (version trop ancienne). Fais une première mise à jour locale sur le worker, ensuite le leader pourra piloter les suivantes.",
                    node.name
                )
            } else {
                format!("{} : {msg}", node.name)
            };
            Err((StatusCode::BAD_GATEWAY, Json(json!({"error": msg}))))
        }
    }
}

async fn node_update_status(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let (node, client, secret) = worker_remote(&state, &id).await?;
    match client.node_update_status(&secret).await {
        Ok(data) => Ok(Json(json!({
            "ok": true,
            "reachable": true,
            "node_id": node.id,
            "version": data.get("version").cloned().unwrap_or(Value::Null),
            "data": data.get("data").cloned().unwrap_or(Value::Null),
        }))),
        Err(_) => Ok(Json(json!({
            "ok": true,
            "reachable": false,
            "node_id": node.id,
            "version": node.metrics.software_version,
            "data": {
                "status": "restarting",
                "message": "Nœud injoignable — redémarrage probable."
            },
        }))),
    }
}

async fn update_workers(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<NodeUpdateBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let target = resolve_update_target(&state, body.target_version).await?;
    let nodes = state.cluster.list_nodes().await.map_err(map_err)?;
    let mut results = Vec::new();
    for node in nodes {
        if node.role == NodeRole::Leader || node.id == "default" {
            continue;
        }
        if node.status != devforge_cluster::NodeStatus::Online {
            results.push(json!({
                "id": node.id,
                "name": node.name,
                "ok": false,
                "skipped": true,
                "error": "hors ligne",
            }));
            continue;
        }
        let current = node.metrics.software_version.clone().unwrap_or_default();
        if !current.is_empty() && !devforge_update::version_gt(&target, &current) {
            results.push(json!({
                "id": node.id,
                "name": node.name,
                "ok": true,
                "skipped": true,
                "version": current,
            }));
            continue;
        }
        match worker_remote(&state, &node.id).await {
            Ok((_, client, secret)) => match client.node_update_start(&secret, Some(&target)).await
            {
                Ok(data) => results.push(json!({
                    "id": node.id,
                    "name": node.name,
                    "ok": true,
                    "data": data.get("data").cloned().unwrap_or(data),
                })),
                Err(e) => {
                    let msg = e.to_string();
                    if msg.contains("Déjà à jour") {
                        results.push(json!({
                            "id": node.id,
                            "name": node.name,
                            "ok": true,
                            "skipped": true,
                            "message": msg,
                        }));
                    } else {
                        results.push(json!({
                            "id": node.id,
                            "name": node.name,
                            "ok": false,
                            "error": msg,
                        }));
                    }
                }
            },
            Err((_, Json(err))) => results.push(json!({
                "id": node.id,
                "name": node.name,
                "ok": false,
                "error": err.get("error").and_then(|v| v.as_str()).unwrap_or("erreur"),
            })),
        }
    }
    Ok(Json(json!({
        "ok": true,
        "target_version": target,
        "results": results,
    })))
}

fn cluster_auth_ok(local: &LocalClusterState, provided: &str) -> bool {
    if provided.is_empty() {
        return false;
    }
    if !local.node_secret.is_empty() && provided == local.node_secret {
        return true;
    }
    if !local.failover_secret.is_empty() && provided == local.failover_secret {
        return true;
    }
    false
}

async fn cluster_snapshot(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Vec<u8>, (StatusCode, Json<Value>)> {
    let local = state.cluster.local().await.map_err(map_err)?;
    let secret = bearer(&headers).unwrap_or_default();
    if !cluster_auth_ok(&local, &secret) {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "secret invalide"})),
        ));
    }
    let path = devforge_cluster::snapshot_path();
    if !path.is_file() {
        let _ = refresh_cluster_snapshot(&state).await;
    }
    let bytes = tokio::fs::read(&path).await.map_err(|e| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({"error": format!("snapshot: {e}")})),
        )
    })?;
    if bytes.len() < 100 || !bytes.starts_with(b"SQLite format 3\0") {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({"error": "snapshot indisponible"})),
        ));
    }
    Ok(bytes)
}

pub async fn refresh_cluster_snapshot(
    state: &AppState,
) -> Result<(), (StatusCode, Json<Value>)> {
    let bytes = devforge_backup::snapshot_sqlite_pool(&state.pool)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        })?;
    let dest = devforge_cluster::snapshot_path();
    if let Some(parent) = dest.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    tokio::fs::write(&dest, &bytes).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": format!("écriture snapshot: {e}")})),
        )
    })?;
    let mut local = state.cluster.local().await.map_err(map_err)?;
    local.snapshot_generation = local.snapshot_generation.saturating_add(1);
    state.cluster.set_local(&local).await.map_err(map_err)?;
    Ok(())
}

pub fn spawn_snapshot_loop(state: AppState) {
    tokio::spawn(async move {
        loop {
            if let Err((_, Json(err))) = refresh_cluster_snapshot(&state).await {
                tracing::warn!(
                    error = %err.get("error").and_then(|v| v.as_str()).unwrap_or("snapshot"),
                    "rafraîchissement snapshot cluster"
                );
            }
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });
}

async fn failover_status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let local = state.cluster.local().await.map_err(map_err)?;
    let secret = bearer(&headers).unwrap_or_default();
    if !cluster_auth_ok(&local, &secret) {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "secret invalide"})),
        ));
    }
    Ok(Json(json!({
        "ok": true,
        "role": local.role,
        "acting_leader": local.acting_leader,
        "node_id": local.node_id,
        "advertise_url": local.advertise_url,
        "preferred_leader_id": local.preferred_leader_id,
        "preferred_leader_url": local.preferred_leader_url,
        "generation": local.snapshot_generation,
    })))
}

#[derive(Deserialize)]
struct DemoteBody {
    #[serde(default)]
    preferred_leader_url: String,
}

async fn failover_demote(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<DemoteBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let mut local = state.cluster.local().await.map_err(map_err)?;
    let secret = bearer(&headers).unwrap_or_default();
    if !cluster_auth_ok(&local, &secret) {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "secret invalide"})),
        ));
    }
    if !local.acting_leader {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "pas un leader intérimaire"})),
        ));
    }
    let url = body.preferred_leader_url.trim().trim_end_matches('/');
    if !url.is_empty() {
        local.leader_url = url.into();
        local.preferred_leader_url = url.into();
    }
    local.role = NodeRole::Worker;
    local.acting_leader = false;
    state.cluster.set_local(&local).await.map_err(map_err)?;
    tokio::spawn(async {
        tokio::time::sleep(Duration::from_millis(400)).await;
        devforge_cluster::restart_current_process();
    });
    Ok(Json(json!({"ok": true, "role": "worker"})))
}
