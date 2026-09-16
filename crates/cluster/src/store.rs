use crate::models::{
    ClusterNode, JoinTokenRow, LocalClusterState, NodeRole, LEADER_NODE_ID,
};
use async_trait::async_trait;
use chrono::Utc;
use devforge_shared::Result;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[async_trait]
pub trait ClusterStore: Send + Sync {
    async fn get_local(&self) -> Result<LocalClusterState>;
    async fn set_local(&self, state: &LocalClusterState) -> Result<()>;

    async fn list_nodes(&self) -> Result<Vec<ClusterNode>>;
    async fn get_node(&self, id: &str) -> Result<Option<ClusterNode>>;
    async fn upsert_node(&self, node: &ClusterNode) -> Result<()>;
    async fn delete_node(&self, id: &str) -> Result<bool>;

    async fn insert_token(&self, token: &JoinTokenRow) -> Result<()>;
    async fn get_token_by_hash(&self, hash: &str) -> Result<Option<JoinTokenRow>>;
    async fn get_token(&self, id: &str) -> Result<Option<JoinTokenRow>>;
    async fn list_tokens(&self) -> Result<Vec<JoinTokenRow>>;
    async fn revoke_token(&self, id: &str) -> Result<bool>;

    async fn get_node_secret(&self, node_id: &str) -> Result<Option<String>>;
    async fn set_node_secret(&self, node_id: &str, secret: &str, hash: &str) -> Result<()>;
    async fn delete_node_secret(&self, node_id: &str) -> Result<()>;
}

#[derive(Clone)]
pub struct MemoryClusterStore {
    local: Arc<RwLock<LocalClusterState>>,
    nodes: Arc<RwLock<HashMap<String, ClusterNode>>>,
    tokens: Arc<RwLock<HashMap<String, JoinTokenRow>>>,
    secrets: Arc<RwLock<HashMap<String, (String, String)>>>,
}

impl MemoryClusterStore {
    pub fn new() -> Self {
        Self {
            local: Arc::new(RwLock::new(LocalClusterState::default())),
            nodes: Arc::new(RwLock::new(HashMap::new())),
            tokens: Arc::new(RwLock::new(HashMap::new())),
            secrets: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn seed_leader(&self, name: &str, advertise_url: &str) {
        let now = Utc::now().to_rfc3339();
        let node = ClusterNode {
            id: LEADER_NODE_ID.into(),
            name: if name.trim().is_empty() {
                "Leader".into()
            } else {
                name.into()
            },
            role: NodeRole::Leader,
            advertise_url: advertise_url.into(),
            status: crate::models::NodeStatus::Online,
            os: std::env::consts::OS.into(),
            arch: std::env::consts::ARCH.into(),
            capabilities: vec!["docker".into()],
            ssh_host: None,
            ssh_user: None,
            ssh_port: None,
            last_seen_at: Some(now.clone()),
            last_error: None,
            drained: false,
            metrics: crate::models::NodeMetrics::default(),
            created_at: now.clone(),
            updated_at: now,
        };
        self.nodes
            .write()
            .await
            .insert(node.id.clone(), node);
        let mut local = self.local.write().await;
        local.role = NodeRole::Leader;
        local.node_id = LEADER_NODE_ID.into();
        local.node_name = name.into();
        local.leader_url = advertise_url.into();
    }
}

impl Default for MemoryClusterStore {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ClusterStore for MemoryClusterStore {
    async fn get_local(&self) -> Result<LocalClusterState> {
        Ok(self.local.read().await.clone())
    }

    async fn set_local(&self, state: &LocalClusterState) -> Result<()> {
        *self.local.write().await = state.clone();
        Ok(())
    }

    async fn list_nodes(&self) -> Result<Vec<ClusterNode>> {
        let mut v: Vec<_> = self.nodes.read().await.values().cloned().collect();
        v.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(v)
    }

    async fn get_node(&self, id: &str) -> Result<Option<ClusterNode>> {
        Ok(self.nodes.read().await.get(id).cloned())
    }

    async fn upsert_node(&self, node: &ClusterNode) -> Result<()> {
        self.nodes
            .write()
            .await
            .insert(node.id.clone(), node.clone());
        Ok(())
    }

    async fn delete_node(&self, id: &str) -> Result<bool> {
        Ok(self.nodes.write().await.remove(id).is_some())
    }

    async fn insert_token(&self, token: &JoinTokenRow) -> Result<()> {
        self.tokens
            .write()
            .await
            .insert(token.id.clone(), token.clone());
        Ok(())
    }

    async fn get_token_by_hash(&self, hash: &str) -> Result<Option<JoinTokenRow>> {
        Ok(self
            .tokens
            .read()
            .await
            .values()
            .find(|t| t.token_hash == hash)
            .cloned())
    }

    async fn get_token(&self, id: &str) -> Result<Option<JoinTokenRow>> {
        Ok(self.tokens.read().await.get(id).cloned())
    }

    async fn list_tokens(&self) -> Result<Vec<JoinTokenRow>> {
        let mut v: Vec<_> = self.tokens.read().await.values().cloned().collect();
        v.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(v)
    }

    async fn revoke_token(&self, id: &str) -> Result<bool> {
        let mut g = self.tokens.write().await;
        if let Some(t) = g.get_mut(id) {
            t.revoked_at = Some(Utc::now().to_rfc3339());
            return Ok(true);
        }
        Ok(false)
    }

    async fn get_node_secret(&self, node_id: &str) -> Result<Option<String>> {
        Ok(self
            .secrets
            .read()
            .await
            .get(node_id)
            .map(|(plain, _)| plain.clone()))
    }

    async fn set_node_secret(&self, node_id: &str, secret: &str, hash: &str) -> Result<()> {
        self.secrets
            .write()
            .await
            .insert(node_id.into(), (secret.into(), hash.into()));
        Ok(())
    }

    async fn delete_node_secret(&self, node_id: &str) -> Result<()> {
        self.secrets.write().await.remove(node_id);
        Ok(())
    }
}
