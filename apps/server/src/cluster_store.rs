//! SQLite persistence for DevForge cluster nodes / invites.

use async_trait::async_trait;
use chrono::Utc;
use devforge_cluster::{
    ClusterNode, ClusterStore, JoinTokenRow, LocalClusterState, NodeRole, NodeStatus,
};
use devforge_shared::{DevForgeError, Result as DfResult};
use serde_json::Value;
use sqlx::{FromRow, PgPool};

pub struct SqliteClusterStore {
    pub pool: PgPool,
}

#[derive(FromRow)]
struct LocalRow {
    role: String,
    leader_url: String,
    node_id: String,
    node_secret: String,
    node_name: String,
    #[sqlx(default)]
    advertise_url: String,
    #[sqlx(default)]
    preferred_leader_id: String,
    #[sqlx(default)]
    preferred_leader_url: String,
    #[sqlx(default)]
    failover_secret: String,
    #[sqlx(default)]
    snapshot_generation: i64,
    #[sqlx(default)]
    acting_leader: i64,
    #[sqlx(default)]
    leader_term: i64,
    #[sqlx(default)]
    writes_fenced: i64,
}

#[derive(FromRow)]
struct NodeRow {
    id: String,
    name: String,
    role: String,
    advertise_url: String,
    status: String,
    os: String,
    arch: String,
    capabilities_json: String,
    ssh_host: Option<String>,
    ssh_user: Option<String>,
    ssh_port: Option<i64>,
    last_seen_at: Option<String>,
    last_error: Option<String>,
    drained: i64,
    #[sqlx(default)]
    ingress_host: String,
    metrics_json: String,
    created_at: String,
    updated_at: String,
}

#[derive(FromRow)]
struct TokenRow {
    id: String,
    token_hash: String,
    expires_at: String,
    revoked_at: Option<String>,
    created_by: String,
    created_at: String,
}

fn caps_from_json(s: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(s).unwrap_or_else(|_| {
        serde_json::from_str::<Value>(s)
            .ok()
            .and_then(|v| v.as_array().cloned())
            .map(|a| {
                a.into_iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    })
}

impl From<NodeRow> for ClusterNode {
    fn from(r: NodeRow) -> Self {
        ClusterNode {
            id: r.id,
            name: r.name,
            role: NodeRole::parse(&r.role),
            advertise_url: r.advertise_url,
            status: NodeStatus::parse(&r.status),
            os: r.os,
            arch: r.arch,
            capabilities: caps_from_json(&r.capabilities_json),
            ssh_host: r.ssh_host,
            ssh_user: r.ssh_user,
            ssh_port: r.ssh_port.and_then(|p| u16::try_from(p).ok()),
            last_seen_at: r.last_seen_at,
            last_error: r.last_error,
            drained: r.drained != 0,
            ingress_host: r.ingress_host,
            metrics: serde_json::from_str(&r.metrics_json).unwrap_or_default(),
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

impl From<TokenRow> for JoinTokenRow {
    fn from(r: TokenRow) -> Self {
        JoinTokenRow {
            id: r.id,
            token_hash: r.token_hash,
            expires_at: r.expires_at,
            revoked_at: r.revoked_at,
            created_by: r.created_by,
            created_at: r.created_at,
        }
    }
}

const NODE_COLS: &str = r#"id, name, role, advertise_url, status, os, arch, capabilities_json,
            ssh_host, ssh_user, ssh_port, last_seen_at, last_error, drained, ingress_host, metrics_json, created_at, updated_at"#;

#[async_trait]
impl ClusterStore for SqliteClusterStore {
    async fn get_local(&self) -> DfResult<LocalClusterState> {
        let row: Option<LocalRow> = sqlx::query_as(
            "SELECT role, leader_url, node_id, node_secret, node_name, advertise_url,
                    preferred_leader_id, preferred_leader_url, failover_secret, snapshot_generation, acting_leader,
                    leader_term, writes_fenced
             FROM cluster_local WHERE id = 1",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(row
            .map(|r| LocalClusterState {
                role: NodeRole::parse(&r.role),
                leader_url: r.leader_url,
                node_id: r.node_id,
                node_secret: r.node_secret,
                node_name: r.node_name,
                advertise_url: r.advertise_url,
                preferred_leader_id: if r.preferred_leader_id.is_empty() {
                    "default".into()
                } else {
                    r.preferred_leader_id
                },
                preferred_leader_url: r.preferred_leader_url,
                failover_secret: r.failover_secret,
                snapshot_generation: r.snapshot_generation,
                acting_leader: r.acting_leader != 0,
                leader_term: if r.leader_term < 1 { 1 } else { r.leader_term },
                writes_fenced: r.writes_fenced != 0,
            })
            .unwrap_or_default())
    }

    async fn set_local(&self, state: &LocalClusterState) -> DfResult<()> {
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            r#"INSERT INTO cluster_local (id, role, leader_url, node_id, node_secret, node_name, advertise_url,
                    preferred_leader_id, preferred_leader_url, failover_secret, snapshot_generation, acting_leader,
                    leader_term, writes_fenced, updated_at)
               VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
               ON CONFLICT(id) DO UPDATE SET
                 role=excluded.role,
                 leader_url=excluded.leader_url,
                 node_id=excluded.node_id,
                 node_secret=excluded.node_secret,
                 node_name=excluded.node_name,
                 advertise_url=excluded.advertise_url,
                 preferred_leader_id=excluded.preferred_leader_id,
                 preferred_leader_url=excluded.preferred_leader_url,
                 failover_secret=excluded.failover_secret,
                 snapshot_generation=excluded.snapshot_generation,
                 acting_leader=excluded.acting_leader,
                 leader_term=excluded.leader_term,
                 writes_fenced=excluded.writes_fenced,
                 updated_at=excluded.updated_at"#,
        )
        .bind(state.role.as_str())
        .bind(&state.leader_url)
        .bind(&state.node_id)
        .bind(&state.node_secret)
        .bind(&state.node_name)
        .bind(&state.advertise_url)
        .bind(&state.preferred_leader_id)
        .bind(&state.preferred_leader_url)
        .bind(&state.failover_secret)
        .bind(state.snapshot_generation)
        .bind(if state.acting_leader { 1 } else { 0 })
        .bind(if state.leader_term < 1 { 1 } else { state.leader_term })
        .bind(if state.writes_fenced { 1 } else { 0 })
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(())
    }

    async fn list_nodes(&self) -> DfResult<Vec<ClusterNode>> {
        let rows: Vec<NodeRow> = sqlx::query_as(&format!(
            "SELECT {NODE_COLS} FROM cluster_nodes ORDER BY name"
        ))
        .fetch_all(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(rows.into_iter().map(ClusterNode::from).collect())
    }

    async fn get_node(&self, id: &str) -> DfResult<Option<ClusterNode>> {
        let row: Option<NodeRow> = sqlx::query_as(&format!(
            "SELECT {NODE_COLS} FROM cluster_nodes WHERE id = $1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(row.map(ClusterNode::from))
    }

    async fn upsert_node(&self, node: &ClusterNode) -> DfResult<()> {
        let caps = serde_json::to_string(&node.capabilities).unwrap_or_else(|_| "[]".into());
        let metrics = serde_json::to_string(&node.metrics).unwrap_or_else(|_| "{}".into());
        sqlx::query(
            r#"INSERT INTO cluster_nodes (
                id, name, role, advertise_url, status, os, arch, capabilities_json,
                ssh_host, ssh_user, ssh_port, last_seen_at, last_error, drained, ingress_host, metrics_json, created_at, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                role=excluded.role,
                advertise_url=excluded.advertise_url,
                status=excluded.status,
                os=excluded.os,
                arch=excluded.arch,
                capabilities_json=excluded.capabilities_json,
                ssh_host=excluded.ssh_host,
                ssh_user=excluded.ssh_user,
                ssh_port=excluded.ssh_port,
                last_seen_at=excluded.last_seen_at,
                last_error=excluded.last_error,
                drained=excluded.drained,
                ingress_host=excluded.ingress_host,
                metrics_json=excluded.metrics_json,
                updated_at=excluded.updated_at"#,
        )
        .bind(&node.id)
        .bind(&node.name)
        .bind(node.role.as_str())
        .bind(&node.advertise_url)
        .bind(node.status.as_str())
        .bind(&node.os)
        .bind(&node.arch)
        .bind(&caps)
        .bind(&node.ssh_host)
        .bind(&node.ssh_user)
        .bind(node.ssh_port.map(i64::from))
        .bind(&node.last_seen_at)
        .bind(&node.last_error)
        .bind(if node.drained { 1i64 } else { 0 })
        .bind(&node.ingress_host)
        .bind(&metrics)
        .bind(&node.created_at)
        .bind(&node.updated_at)
        .execute(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(())
    }

    async fn delete_node(&self, id: &str) -> DfResult<bool> {
        let r = sqlx::query("DELETE FROM cluster_nodes WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(r.rows_affected() > 0)
    }

    async fn insert_token(&self, token: &JoinTokenRow) -> DfResult<()> {
        sqlx::query(
            r#"INSERT INTO cluster_join_tokens (id, token_hash, expires_at, revoked_at, created_by, created_at)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT(id) DO UPDATE SET
                 token_hash=excluded.token_hash,
                 expires_at=excluded.expires_at,
                 revoked_at=excluded.revoked_at"#,
        )
        .bind(&token.id)
        .bind(&token.token_hash)
        .bind(&token.expires_at)
        .bind(&token.revoked_at)
        .bind(&token.created_by)
        .bind(&token.created_at)
        .execute(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(())
    }

    async fn get_token_by_hash(&self, hash: &str) -> DfResult<Option<JoinTokenRow>> {
        let row: Option<TokenRow> = sqlx::query_as(
            "SELECT id, token_hash, expires_at, revoked_at, created_by, created_at FROM cluster_join_tokens WHERE token_hash = $1",
        )
        .bind(hash)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(row.map(JoinTokenRow::from))
    }

    async fn get_token(&self, id: &str) -> DfResult<Option<JoinTokenRow>> {
        let row: Option<TokenRow> = sqlx::query_as(
            "SELECT id, token_hash, expires_at, revoked_at, created_by, created_at FROM cluster_join_tokens WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(row.map(JoinTokenRow::from))
    }

    async fn list_tokens(&self) -> DfResult<Vec<JoinTokenRow>> {
        let rows: Vec<TokenRow> = sqlx::query_as(
            "SELECT id, token_hash, expires_at, revoked_at, created_by, created_at FROM cluster_join_tokens ORDER BY created_at DESC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(rows.into_iter().map(JoinTokenRow::from).collect())
    }

    async fn revoke_token(&self, id: &str) -> DfResult<bool> {
        let now = Utc::now().to_rfc3339();
        let r = sqlx::query(
            "UPDATE cluster_join_tokens SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL",
        )
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(r.rows_affected() > 0)
    }

    async fn get_node_secret(&self, node_id: &str) -> DfResult<Option<String>> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT secret FROM cluster_node_secrets WHERE node_id = $1")
                .bind(node_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(row.map(|r| r.0))
    }

    async fn set_node_secret(&self, node_id: &str, secret: &str, hash: &str) -> DfResult<()> {
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            r#"INSERT INTO cluster_node_secrets (node_id, secret, secret_hash, created_at)
               VALUES ($1,$2,$3,$4)
               ON CONFLICT(node_id) DO UPDATE SET secret=excluded.secret, secret_hash=excluded.secret_hash"#,
        )
        .bind(node_id)
        .bind(secret)
        .bind(hash)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(())
    }

    async fn delete_node_secret(&self, node_id: &str) -> DfResult<()> {
        sqlx::query("DELETE FROM cluster_node_secrets WHERE node_id = $1")
            .bind(node_id)
            .execute(&self.pool)
            .await
            .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(())
    }
}
