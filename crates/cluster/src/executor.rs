use crate::crypto::hash_secret;
use crate::models::{ExecBody, NodeStatus, LEADER_NODE_ID};
use crate::store::ClusterStore;
use async_trait::async_trait;
use devforge_deploy::{ExecResult, RemoteExecutor};
use devforge_shared::{DevForgeError, Result};
use std::sync::Arc;

/// Dispatch `server_id` : ce process (son `node_id`, ou `default` s'il EST
/// le nœud d'origine) → inner (local ou SSH Settings) ;
/// autre nœud → HTTP `POST {advertise_url}/internal/exec`.
pub struct ClusterAwareExecutor {
    inner: Arc<dyn RemoteExecutor>,
    store: Arc<dyn ClusterStore>,
    http: reqwest::Client,
}

impl ClusterAwareExecutor {
    pub fn new(inner: Arc<dyn RemoteExecutor>, store: Arc<dyn ClusterStore>) -> Self {
        Self {
            inner,
            store,
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(310))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }

    /// `default` / vide / `*` n'est local que si CE process est le nœud d'origine.
    /// Un worker ou un leader intérimaire (`node_…`) ne doit pas exécuter chez lui
    /// les commandes du leader : sinon il démarre le `cloudflared` du tunnel du
    /// leader et Cloudflare répartit le trafic entre les deux connecteurs.
    fn runs_here(server_id: &str, local_node_id: &str) -> bool {
        let id = server_id.trim();
        let me = local_node_id.trim();
        if !me.is_empty() && id == me {
            return true;
        }
        let i_am_origin = me.is_empty() || me == LEADER_NODE_ID;
        id.is_empty() || id == "*" || (id == LEADER_NODE_ID && i_am_origin)
    }
}

#[async_trait]
impl RemoteExecutor for ClusterAwareExecutor {
    async fn exec(
        &self,
        server_id: &str,
        workdir: &str,
        command: &str,
        timeout_secs: u64,
    ) -> Result<ExecResult> {
        let local_id = self
            .store
            .get_local()
            .await
            .map(|l| l.node_id)
            .unwrap_or_default();
        if Self::runs_here(server_id, &local_id) {
            return self
                .inner
                .exec(server_id, workdir, command, timeout_secs)
                .await;
        }
        let node = self.store.get_node(server_id).await?;

        let node =
            node.ok_or_else(|| DevForgeError::Message(format!("Nœud inconnu: {server_id}")))?;
        if node.drained {
            return Err(DevForgeError::Message(format!(
                "Nœud {} en drain — pas de nouveaux jobs. Réassigne le projet ou désactive le drain.",
                node.name
            )));
        }
        if node.status == NodeStatus::Offline {
            return Err(DevForgeError::Message(format!(
                "Nœud {} hors ligne",
                node.name
            )));
        }
        let url = node.advertise_url.trim().trim_end_matches('/');
        if url.is_empty() {
            return Err(DevForgeError::Message(format!(
                "Nœud {} sans URL d’annonce",
                node.name
            )));
        }
        let secret = self
            .store
            .get_node_secret(&node.id)
            .await?
            .ok_or_else(|| DevForgeError::Message("secret nœud manquant".into()))?;

        let endpoint = format!("{url}/internal/exec");
        let body = ExecBody {
            workdir: workdir.into(),
            command: command.into(),
            timeout_secs,
        };
        let res = self
            .http
            .post(&endpoint)
            .bearer_auth(&secret)
            .json(&body)
            .timeout(std::time::Duration::from_secs(timeout_secs.max(10) + 5))
            .send()
            .await
            .map_err(|e| DevForgeError::Message(format!("exec HTTP {}: {e}", node.name)))?;

        if !res.status().is_success() {
            let status = res.status();
            let text = res.text().await.unwrap_or_default();
            return Err(DevForgeError::Message(format!(
                "exec {} HTTP {status}: {text}",
                node.name
            )));
        }

        let parsed: ExecResult = res
            .json()
            .await
            .map_err(|e| DevForgeError::Message(format!("exec {} JSON: {e}", node.name)))?;
        Ok(parsed)
    }
}

pub fn verify_node_secret(provided: &str, stored_plain: &str) -> bool {
    hash_secret(provided) == hash_secret(stored_plain) || provided == stored_plain
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ClusterNode, NodeRole};
    use crate::store::MemoryClusterStore;
    use chrono::Utc;
    use devforge_deploy::StubRemoteExecutor;

    #[tokio::test]
    async fn default_goes_to_inner() {
        let store = Arc::new(MemoryClusterStore::new());
        store.seed_leader("L", "http://127.0.0.1:8000").await;
        let inner = Arc::new(StubRemoteExecutor::new());
        let exec = ClusterAwareExecutor::new(inner, store);
        let r = exec.exec("default", "", "echo hi", 5).await.unwrap();
        assert!(r.ok);
        assert!(r.output.contains("stub"));
    }

    #[tokio::test]
    async fn unknown_worker_errors() {
        let store = Arc::new(MemoryClusterStore::new());
        let inner = Arc::new(StubRemoteExecutor::new());
        let exec = ClusterAwareExecutor::new(inner, store);
        let err = exec.exec("node_nope", "", "true", 5).await.unwrap_err();
        assert!(err.to_string().contains("inconnu"));
    }

    #[tokio::test]
    async fn other_leader_role_is_not_this_machine() {
        let store = Arc::new(MemoryClusterStore::new());
        let now = Utc::now().to_rfc3339();
        store
            .upsert_node(&ClusterNode {
                id: "other".into(),
                name: "L2".into(),
                role: NodeRole::Leader,
                advertise_url: String::new(),
                status: NodeStatus::Online,
                os: "linux".into(),
                arch: "x86_64".into(),
                capabilities: vec![],
                ssh_host: None,
                ssh_user: None,
                ssh_port: None,
                last_seen_at: Some(now.clone()),
                last_error: None,
                drained: false,
                ingress_host: String::new(),
                metrics: crate::models::NodeMetrics::default(),
                created_at: now.clone(),
                updated_at: now,
            })
            .await
            .unwrap();
        let inner = Arc::new(StubRemoteExecutor::new());
        let exec = ClusterAwareExecutor::new(inner, store);
        let err = exec.exec("other", "", "true", 5).await.unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("URL") || msg.contains("secret"),
            "un autre nœud leader ne s'exécute pas en local : {msg}"
        );
    }

    #[tokio::test]
    async fn interim_does_not_run_origin_commands_locally() {
        let store = Arc::new(MemoryClusterStore::new());
        store.seed_leader("NAS", "http://10.1.0.58:8000").await;
        let mut local = store.get_local().await.unwrap();
        local.node_id = "node_5658218ef601".into();
        local.role = NodeRole::Leader;
        local.acting_leader = true;
        store.set_local(&local).await.unwrap();
        let exec = ClusterAwareExecutor::new(Arc::new(StubRemoteExecutor::new()), store);
        let err = exec.exec("default", "", "echo hi", 5).await.unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("secret") || msg.contains("URL"),
            "le tunnel du leader ne doit pas partir sur l'intérim : {msg}"
        );
        let own = exec
            .exec("node_5658218ef601", "", "echo hi", 5)
            .await
            .unwrap();
        assert!(own.ok);
    }

    #[tokio::test]
    async fn drained_worker_rejects_exec() {
        let store = Arc::new(MemoryClusterStore::new());
        store.seed_leader("L", "http://127.0.0.1:8000").await;
        let now = Utc::now().to_rfc3339();
        store
            .upsert_node(&ClusterNode {
                id: "w1".into(),
                name: "cube".into(),
                role: NodeRole::Worker,
                advertise_url: "http://10.0.0.9:8000".into(),
                status: NodeStatus::Online,
                os: "linux".into(),
                arch: "x86_64".into(),
                capabilities: vec!["docker".into()],
                ssh_host: None,
                ssh_user: None,
                ssh_port: None,
                last_seen_at: Some(now.clone()),
                last_error: None,
                drained: true,
                ingress_host: String::new(),
                metrics: crate::models::NodeMetrics::default(),
                created_at: now.clone(),
                updated_at: now,
            })
            .await
            .unwrap();
        let exec = ClusterAwareExecutor::new(Arc::new(StubRemoteExecutor::new()), store);
        let err = exec.exec("w1", "", "true", 5).await.unwrap_err();
        assert!(err.to_string().contains("drain"));
    }
}
