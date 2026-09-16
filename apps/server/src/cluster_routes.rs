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
    LeaderClient, LocalClusterState, NodeRole,
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
        .route("/api/v1/cluster/invites", get(list_invites).post(create_invite))
        .route("/api/v1/cluster/invites/{id}", delete(revoke_invite))
        .route("/api/v1/cluster/join", post(join_node))
        .route("/api/v1/cluster/heartbeat", post(heartbeat))
        .route("/api/v1/cluster/local", get(local_state).post(local_join).patch(local_patch))
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
    let mut nodes = state.cluster.list_nodes().await.map_err(map_err)?;
    let counts = project_counts_by_node(&state).await;
    let leader_metrics = collect_node_metrics();
    for n in &mut nodes {
        if n.role == NodeRole::Leader {
            n.metrics = leader_metrics.clone();
        }
    }
    Ok(Json(json!({
        "ok": true,
        "nodes": nodes.iter().map(|n| {
            let mut v = devforge_cluster::ClusterFacade::node_json(n);
            let key = normalize_server_id(&n.id);
            v["project_count"] = json!(counts.get(&key).copied().unwrap_or(0));
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
}

async fn patch_node(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(body): Json<PatchNodeBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    if body.name.is_none() && body.drained.is_none() && body.advertise_url.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Rien à modifier (name / drained / advertise_url)"})),
        ));
    }
    let node = state
        .cluster
        .patch_node(&id, body.name, body.drained, body.advertise_url)
        .await
        .map_err(map_err)?;
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
    let node = state
        .cluster
        .heartbeat(&secret, body)
        .await
        .map_err(map_err)?;
    Ok(Json(json!({
        "ok": true,
        "node": devforge_cluster::ClusterFacade::node_json(&node),
    })))
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
        instance_url(&state).await
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

fn normalize_server_id(id: &str) -> String {
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
