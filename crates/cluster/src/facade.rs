use crate::crypto::{hash_secret, new_join_token, new_node_id, new_node_secret};
use crate::models::{
    AddNodeRequest, ClusterNode, ClusterSummary, CreatedInvite, HeartbeatPayload, JoinRequest,
    JoinResponse, JoinTokenRow, LocalClusterState, NodeMetrics, NodeRole, NodeStatus,
    HEARTBEAT_STALE_SECS, LEADER_NODE_ID,
};
use crate::store::ClusterStore;
use chrono::{Duration, Utc};
use devforge_deploy::{RemoteExecutor, SshRemoteExecutor, SshTarget};
use devforge_shared::{DevForgeError, Result};
use serde_json::json;
use std::path::PathBuf;
use std::sync::Arc;
use uuid::Uuid;

pub struct ClusterFacade {
    store: Arc<dyn ClusterStore>,
}

impl ClusterFacade {
    pub fn new(store: Arc<dyn ClusterStore>) -> Self {
        Self { store }
    }

    pub fn store(&self) -> Arc<dyn ClusterStore> {
        self.store.clone()
    }

    pub async fn ensure_leader(&self, name: &str, advertise_url: &str) -> Result<ClusterNode> {
        if let Some(existing) = self.store.get_node(LEADER_NODE_ID).await? {
            let mut local = self.store.get_local().await?;
            if local.role == NodeRole::Leader && local.node_id.is_empty() {
                local.node_id = LEADER_NODE_ID.into();
                self.store.set_local(&local).await?;
            }
            return Ok(existing);
        }
        let now = Utc::now().to_rfc3339();
        let node = ClusterNode {
            id: LEADER_NODE_ID.into(),
            name: if name.trim().is_empty() {
                "Leader".into()
            } else {
                name.trim().into()
            },
            role: NodeRole::Leader,
            advertise_url: advertise_url.into(),
            status: NodeStatus::Online,
            os: std::env::consts::OS.into(),
            arch: std::env::consts::ARCH.into(),
            capabilities: vec!["docker".into()],
            ssh_host: None,
            ssh_user: None,
            ssh_port: None,
            last_seen_at: Some(now.clone()),
            last_error: None,
            drained: false,
            metrics: NodeMetrics::default(),
            created_at: now.clone(),
            updated_at: now,
        };
        self.store.upsert_node(&node).await?;
        let mut local = self.store.get_local().await?;
        if local.role != NodeRole::Worker {
            local.role = NodeRole::Leader;
            local.node_id = LEADER_NODE_ID.into();
            local.node_name = node.name.clone();
            if local.leader_url.is_empty() {
                local.leader_url = advertise_url.into();
            }
            self.store.set_local(&local).await?;
        }
        Ok(node)
    }

    pub async fn local(&self) -> Result<LocalClusterState> {
        self.store.get_local().await
    }

    pub async fn set_local(&self, state: &LocalClusterState) -> Result<()> {
        self.store.set_local(state).await
    }

    pub async fn summary(&self) -> Result<ClusterSummary> {
        let local = self.store.get_local().await?;
        let nodes = self.list_nodes().await?;
        let online = nodes
            .iter()
            .filter(|n| n.status == NodeStatus::Online)
            .count();
        Ok(ClusterSummary {
            role: local.role,
            nodes: nodes.len(),
            online,
        })
    }

    pub async fn list_nodes(&self) -> Result<Vec<ClusterNode>> {
        let mut nodes = self.store.list_nodes().await?;
        let now = Utc::now();
        for node in &mut nodes {
            if node.role == NodeRole::Leader {
                node.status = NodeStatus::Online;
                continue;
            }
            if node.status == NodeStatus::Joining {
                continue;
            }
            let stale = node
                .last_seen_at
                .as_deref()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .map(|t| now.signed_duration_since(t.with_timezone(&Utc)) > Duration::seconds(HEARTBEAT_STALE_SECS))
                .unwrap_or(true);
            node.status = if stale {
                NodeStatus::Offline
            } else {
                NodeStatus::Online
            };
        }
        Ok(nodes)
    }

    pub async fn create_invite(
        &self,
        created_by: &str,
        leader_url: &str,
        ttl_hours: i64,
    ) -> Result<CreatedInvite> {
        let url = leader_url.trim();
        if url.is_empty() {
            return Err(DevForgeError::Message(
                "URL du leader requise (Settings → Général)".into(),
            ));
        }
        let token = new_join_token();
        let now = Utc::now();
        let expires = now + Duration::hours(ttl_hours.max(1));
        let row = JoinTokenRow {
            id: format!("inv_{}", &Uuid::new_v4().simple().to_string()[..10]),
            token_hash: hash_secret(&token),
            expires_at: expires.to_rfc3339(),
            revoked_at: None,
            created_by: created_by.into(),
            created_at: now.to_rfc3339(),
        };
        self.store.insert_token(&row).await?;
        Ok(CreatedInvite {
            id: row.id,
            token,
            leader_url: url.trim_end_matches('/').into(),
            expires_at: row.expires_at,
        })
    }

    pub async fn list_invites(&self) -> Result<Vec<JoinTokenRow>> {
        self.store.list_tokens().await
    }

    pub async fn revoke_invite(&self, id: &str) -> Result<bool> {
        self.store.revoke_token(id).await
    }

    pub async fn join(&self, req: JoinRequest, leader_url: &str) -> Result<JoinResponse> {
        let token = req.token.trim();
        if token.is_empty() {
            return Err(DevForgeError::Message("token requis".into()));
        }
        let hash = hash_secret(token);
        let row = self
            .store
            .get_token_by_hash(&hash)
            .await?
            .ok_or_else(|| DevForgeError::Message("invitation invalide".into()))?;
        if row.revoked_at.is_some() {
            return Err(DevForgeError::Message("invitation révoquée".into()));
        }
        let exp = chrono::DateTime::parse_from_rfc3339(&row.expires_at)
            .map_err(|_| DevForgeError::Message("invitation expirée".into()))?;
        if exp.with_timezone(&Utc) < Utc::now() {
            return Err(DevForgeError::Message("invitation expirée".into()));
        }

        let name = req.name.trim();
        if name.is_empty() {
            return Err(DevForgeError::Message("nom du nœud requis".into()));
        }

        let advertise = req.advertise_url.trim().trim_end_matches('/').to_string();
        let existing = self.store.list_nodes().await?;
        let reuse = existing.into_iter().find(|n| {
            n.role == NodeRole::Worker
                && (n.status == NodeStatus::Joining || n.status == NodeStatus::Offline)
                && (n.name == name
                    || (!advertise.is_empty() && n.advertise_url == advertise)
                    || (req.ssh_host.as_deref().is_some_and(|h| n.ssh_host.as_deref() == Some(h))))
        });

        let now = Utc::now().to_rfc3339();
        let id = reuse
            .as_ref()
            .map(|n| n.id.clone())
            .unwrap_or_else(new_node_id);
        let secret = new_node_secret();
        let node = ClusterNode {
            id: id.clone(),
            name: name.into(),
            role: NodeRole::Worker,
            advertise_url: advertise,
            status: NodeStatus::Online,
            os: req.os,
            arch: req.arch,
            capabilities: if req.capabilities.is_empty() {
                vec!["docker".into()]
            } else {
                req.capabilities
            },
            ssh_host: req
                .ssh_host
                .filter(|s| !s.trim().is_empty())
                .or_else(|| reuse.as_ref().and_then(|n| n.ssh_host.clone())),
            ssh_user: req
                .ssh_user
                .filter(|s| !s.trim().is_empty())
                .or_else(|| reuse.as_ref().and_then(|n| n.ssh_user.clone())),
            ssh_port: req
                .ssh_port
                .filter(|p| *p > 0)
                .or_else(|| reuse.as_ref().and_then(|n| n.ssh_port)),
            last_seen_at: Some(now.clone()),
            last_error: None,
            drained: reuse.as_ref().map(|n| n.drained).unwrap_or(false),
            metrics: reuse
                .as_ref()
                .map(|n| n.metrics.clone())
                .unwrap_or_default(),
            created_at: reuse
                .as_ref()
                .map(|n| n.created_at.clone())
                .unwrap_or_else(|| now.clone()),
            updated_at: now,
        };
        self.store.upsert_node(&node).await?;
        self.store
            .set_node_secret(&id, &secret, &hash_secret(&secret))
            .await?;
        Ok(JoinResponse {
            ok: true,
            node,
            secret,
            leader_url: leader_url.trim().trim_end_matches('/').into(),
        })
    }

    pub async fn heartbeat(&self, secret: &str, payload: HeartbeatPayload) -> Result<ClusterNode> {
        let node = self
            .store
            .get_node(&payload.node_id)
            .await?
            .ok_or_else(|| DevForgeError::NotFound(format!("nœud {}", payload.node_id)))?;
        let stored = self
            .store
            .get_node_secret(&node.id)
            .await?
            .ok_or_else(|| DevForgeError::Message("secret nœud manquant".into()))?;
        if !crate::executor::verify_node_secret(secret, &stored) {
            return Err(DevForgeError::Message("secret nœud invalide".into()));
        }
        let now = Utc::now().to_rfc3339();
        let mut updated = node;
        updated.status = NodeStatus::Online;
        updated.last_seen_at = Some(now.clone());
        updated.updated_at = now;
        updated.last_error = None;
        if let Some(url) = payload.advertise_url {
            if !url.trim().is_empty() {
                updated.advertise_url = url.trim().trim_end_matches('/').into();
            }
        }
        if let Some(os) = payload.os {
            if !os.is_empty() {
                updated.os = os;
            }
        }
        if let Some(arch) = payload.arch {
            if !arch.is_empty() {
                updated.arch = arch;
            }
        }
        if let Some(caps) = payload.capabilities {
            if !caps.is_empty() {
                updated.capabilities = caps;
            }
        }
        if let Some(metrics) = payload.metrics {
            updated.metrics = metrics;
        }
        self.store.upsert_node(&updated).await?;
        Ok(updated)
    }

    pub async fn patch_node(
        &self,
        id: &str,
        name: Option<String>,
        drained: Option<bool>,
    ) -> Result<ClusterNode> {
        let mut node = self
            .store
            .get_node(id)
            .await?
            .ok_or_else(|| DevForgeError::NotFound(format!("nœud {id}")))?;
        if let Some(n) = name {
            let t = n.trim();
            if t.is_empty() {
                return Err(DevForgeError::Message("nom du nœud requis".into()));
            }
            node.name = t.into();
            if node.role == NodeRole::Leader {
                let mut local = self.store.get_local().await?;
                local.node_name = node.name.clone();
                self.store.set_local(&local).await?;
            }
        }
        if let Some(d) = drained {
            if node.role == NodeRole::Leader && d {
                return Err(DevForgeError::Message(
                    "Le leader ne peut pas être drainé — il exécute encore en local".into(),
                ));
            }
            node.drained = d;
        }
        node.updated_at = Utc::now().to_rfc3339();
        self.store.upsert_node(&node).await?;
        Ok(node)
    }

    pub async fn remove_node(&self, id: &str) -> Result<bool> {
        if id == LEADER_NODE_ID {
            return Err(DevForgeError::Message(
                "Impossible de retirer le nœud leader".into(),
            ));
        }
        self.store.delete_node_secret(id).await?;
        self.store.delete_node(id).await
    }

    pub async fn add_via_ssh(
        &self,
        req: AddNodeRequest,
        leader_url: &str,
        identity_file: Option<PathBuf>,
        docker_image: &str,
        created_by: &str,
    ) -> Result<ClusterNode> {
        let host = req.host.trim();
        if host.is_empty() {
            return Err(DevForgeError::Message("hôte SSH requis".into()));
        }
        let name = if req.name.trim().is_empty() {
            host.to_string()
        } else {
            req.name.trim().to_string()
        };
        let user = if req.user.trim().is_empty() {
            "root".into()
        } else {
            req.user.trim().to_string()
        };
        let port = if req.port == 0 { 22 } else { req.port };
        let advertise = req
            .advertise_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.trim_end_matches('/').to_string())
            .unwrap_or_else(|| format!("http://{host}:8000"));

        let invite = self.create_invite(created_by, leader_url, 24).await?;
        let script = bootstrap_script(
            leader_url,
            &invite.token,
            &name,
            &advertise,
            docker_image,
        );
        let ssh = SshRemoteExecutor::new(SshTarget {
            host: host.into(),
            user: user.clone(),
            port,
            identity_file,
        });
        let res = ssh.exec("default", "", &script, 360).await;
        match res {
            Ok(out) if out.ok => {
                let now = Utc::now().to_rfc3339();
                let node = ClusterNode {
                    id: new_node_id(),
                    name: name.clone(),
                    role: NodeRole::Worker,
                    advertise_url: advertise.clone(),
                    status: NodeStatus::Joining,
                    os: String::new(),
                    arch: String::new(),
                    capabilities: vec!["docker".into()],
                    ssh_host: Some(host.into()),
                    ssh_user: Some(user),
                    ssh_port: Some(port),
                    last_seen_at: None,
                    last_error: None,
                    drained: false,
                    metrics: NodeMetrics::default(),
                    created_at: now.clone(),
                    updated_at: now,
                };
                self.store.upsert_node(&node).await?;
                Ok(node)
            }
            Ok(out) => Err(DevForgeError::Message(format!(
                "Bootstrap SSH échoué (exit {}) : {}",
                out.exit_code,
                out.output.chars().take(800).collect::<String>()
            ))),
            Err(e) => Err(e),
        }
    }

    pub fn node_json(node: &ClusterNode) -> serde_json::Value {
        json!({
            "id": node.id,
            "name": node.name,
            "role": node.role,
            "advertise_url": node.advertise_url,
            "status": node.status,
            "os": node.os,
            "arch": node.arch,
            "capabilities": node.capabilities,
            "ssh_host": node.ssh_host,
            "ssh_user": node.ssh_user,
            "ssh_port": node.ssh_port,
            "last_seen_at": node.last_seen_at,
            "last_error": node.last_error,
            "drained": node.drained,
            "metrics": node.metrics,
            "created_at": node.created_at,
            "updated_at": node.updated_at,
        })
    }
}

fn shell_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

pub fn bootstrap_script(
    leader_url: &str,
    token: &str,
    name: &str,
    advertise_url: &str,
    docker_image: &str,
) -> String {
    let payload = json!({
        "leader_url": leader_url.trim().trim_end_matches('/'),
        "token": token,
        "name": name,
        "advertise_url": advertise_url.trim().trim_end_matches('/'),
    });
    let b64 = base64_encode(payload.to_string().as_bytes());
    let image = if docker_image.contains(':') {
        docker_image.to_string()
    } else {
        format!("{docker_image}:latest")
    };
    format!(
        r#"set -euo pipefail
mkdir -p /opt/devforge/data
echo {b64} | base64 -d > /opt/devforge/data/cluster-pending-join.json
if ! command -v docker >/dev/null 2>&1; then
  echo "docker introuvable sur le nœud" >&2
  exit 1
fi
docker pull {image}
docker rm -f devforge-worker >/dev/null 2>&1 || true
docker run -d --name devforge-worker --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /opt/devforge/data:/data \
  -e DATABASE_URL=sqlite:/data/devforge.db?mode=rwc \
  -e DEVFORGE_DATA_DIR=/data \
  -e HOST=0.0.0.0 \
  -e PORT=8000 \
  -p 8000:8000 \
  {image}
echo BOOTSTRAP_OK
"#,
        b64 = shell_single_quote(&b64),
        image = shell_single_quote(&image),
    )
}

fn base64_encode(bytes: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    let mut i = 0;
    while i < bytes.len() {
        let b0 = bytes[i];
        let b1 = if i + 1 < bytes.len() { bytes[i + 1] } else { 0 };
        let b2 = if i + 2 < bytes.len() { bytes[i + 2] } else { 0 };
        let n = ((b0 as u32) << 16) | ((b1 as u32) << 8) | (b2 as u32);
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        if i + 1 < bytes.len() {
            out.push(T[((n >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if i + 2 < bytes.len() {
            out.push(T[(n & 63) as usize] as char);
        } else {
            out.push('=');
        }
        i += 3;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::MemoryClusterStore;

    #[tokio::test]
    async fn join_requires_valid_token() {
        let store = Arc::new(MemoryClusterStore::new());
        store.seed_leader("L", "http://127.0.0.1:8000").await;
        let facade = ClusterFacade::new(store);
        let err = facade
            .join(
                JoinRequest {
                    token: "dfjoin_nope".into(),
                    name: "w1".into(),
                    advertise_url: "http://10.0.0.2:8000".into(),
                    os: "linux".into(),
                    arch: "x86_64".into(),
                    capabilities: vec![],
                    ssh_host: None,
                    ssh_user: None,
                    ssh_port: None,
                },
                "http://127.0.0.1:8000",
            )
            .await
            .unwrap_err();
        assert!(err.to_string().contains("invalide"));
    }

    #[tokio::test]
    async fn join_and_heartbeat() {
        let store = Arc::new(MemoryClusterStore::new());
        store.seed_leader("L", "http://127.0.0.1:8000").await;
        let facade = ClusterFacade::new(store);
        let inv = facade
            .create_invite("admin", "http://127.0.0.1:8000", 2)
            .await
            .unwrap();
        let joined = facade
            .join(
                JoinRequest {
                    token: inv.token.clone(),
                    name: "zimacube".into(),
                    advertise_url: "http://10.1.0.58:8000".into(),
                    os: "linux".into(),
                    arch: "x86_64".into(),
                    capabilities: vec!["docker".into()],
                    ssh_host: None,
                    ssh_user: None,
                    ssh_port: None,
                },
                "http://127.0.0.1:8000",
            )
            .await
            .unwrap();
        assert_eq!(joined.node.name, "zimacube");
        assert!(joined.secret.starts_with("dfnode_"));

        let hb = facade
            .heartbeat(
                &joined.secret,
                HeartbeatPayload {
                    node_id: joined.node.id.clone(),
                    advertise_url: None,
                    os: None,
                    arch: None,
                    capabilities: None,
                    metrics: Some(NodeMetrics {
                        cpu_percent: Some(12.0),
                        docker_ok: Some(true),
                        ..Default::default()
                    }),
                },
            )
            .await
            .unwrap();
        assert_eq!(hb.status, NodeStatus::Online);
        assert_eq!(hb.metrics.cpu_percent, Some(12.0));

        let bad = facade
            .heartbeat(
                "wrong",
                HeartbeatPayload {
                    node_id: joined.node.id.clone(),
                    advertise_url: None,
                    os: None,
                    arch: None,
                    capabilities: None,
                    metrics: None,
                },
            )
            .await
            .unwrap_err();
        assert!(bad.to_string().contains("invalide"));
    }

    #[tokio::test]
    async fn revoked_and_expired_tokens() {
        let store = Arc::new(MemoryClusterStore::new());
        store.seed_leader("L", "http://127.0.0.1:8000").await;
        let facade = ClusterFacade::new(store.clone());
        let inv = facade
            .create_invite("admin", "http://leader", 2)
            .await
            .unwrap();
        assert!(facade.revoke_invite(&inv.id).await.unwrap());
        let err = facade
            .join(
                JoinRequest {
                    token: inv.token,
                    name: "x".into(),
                    advertise_url: "http://x".into(),
                    os: String::new(),
                    arch: String::new(),
                    capabilities: vec![],
                    ..Default::default()
                },
                "http://leader",
            )
            .await
            .unwrap_err();
        assert!(err.to_string().contains("révoquée"));

        let inv2 = facade
            .create_invite("admin", "http://leader", 2)
            .await
            .unwrap();
        let mut row = store.get_token(&inv2.id).await.unwrap().unwrap();
        row.expires_at = (Utc::now() - Duration::hours(1)).to_rfc3339();
        store.insert_token(&row).await.unwrap();
        let err = facade
            .join(
                JoinRequest {
                    token: inv2.token,
                    name: "x".into(),
                    advertise_url: "http://x".into(),
                    os: String::new(),
                    arch: String::new(),
                    capabilities: vec![],
                    ..Default::default()
                },
                "http://leader",
            )
            .await
            .unwrap_err();
        assert!(err.to_string().contains("expirée"));
    }

    #[tokio::test]
    async fn join_reuses_joining_placeholder() {
        let store = Arc::new(MemoryClusterStore::new());
        store.seed_leader("L", "http://127.0.0.1:8000").await;
        let facade = ClusterFacade::new(store);
        let now = Utc::now().to_rfc3339();
        facade
            .store()
            .upsert_node(&ClusterNode {
                id: "node_pending".into(),
                name: "nas".into(),
                role: NodeRole::Worker,
                advertise_url: "http://10.1.0.58:8000".into(),
                status: NodeStatus::Joining,
                os: String::new(),
                arch: String::new(),
                capabilities: vec!["docker".into()],
                ssh_host: Some("10.1.0.58".into()),
                ssh_user: Some("root".into()),
                ssh_port: Some(22),
                last_seen_at: None,
                last_error: None,
                drained: false,
                metrics: NodeMetrics::default(),
                created_at: now.clone(),
                updated_at: now,
            })
            .await
            .unwrap();
        let inv = facade
            .create_invite("admin", "http://127.0.0.1:8000", 2)
            .await
            .unwrap();
        let joined = facade
            .join(
                JoinRequest {
                    token: inv.token,
                    name: "nas".into(),
                    advertise_url: "http://10.1.0.58:8000".into(),
                    os: "linux".into(),
                    arch: "x86_64".into(),
                    capabilities: vec!["docker".into()],
                    ..Default::default()
                },
                "http://127.0.0.1:8000",
            )
            .await
            .unwrap();
        assert_eq!(joined.node.id, "node_pending");
        assert_eq!(joined.node.status, NodeStatus::Online);
        assert_eq!(joined.node.ssh_host.as_deref(), Some("10.1.0.58"));
        let nodes = facade.list_nodes().await.unwrap();
        assert_eq!(
            nodes.iter().filter(|n| n.role == NodeRole::Worker).count(),
            1
        );
    }

    #[tokio::test]
    async fn cannot_remove_leader() {
        let store = Arc::new(MemoryClusterStore::new());
        store.seed_leader("L", "http://127.0.0.1:8000").await;
        let facade = ClusterFacade::new(store);
        let err = facade.remove_node(LEADER_NODE_ID).await.unwrap_err();
        assert!(err.to_string().contains("leader"));
    }

    #[tokio::test]
    async fn patch_renames_and_drains() {
        let store = Arc::new(MemoryClusterStore::new());
        store.seed_leader("L", "http://127.0.0.1:8000").await;
        let facade = ClusterFacade::new(store);
        let renamed = facade
            .patch_node(LEADER_NODE_ID, Some("Forge".into()), None)
            .await
            .unwrap();
        assert_eq!(renamed.name, "Forge");
        let local = facade.local().await.unwrap();
        assert_eq!(local.node_name, "Forge");

        let err = facade
            .patch_node(LEADER_NODE_ID, None, Some(true))
            .await
            .unwrap_err();
        assert!(err.to_string().contains("leader"));

        let inv = facade
            .create_invite("admin", "http://127.0.0.1:8000", 2)
            .await
            .unwrap();
        let joined = facade
            .join(
                JoinRequest {
                    token: inv.token,
                    name: "nas".into(),
                    advertise_url: "http://10.1.0.58:8000".into(),
                    os: "linux".into(),
                    arch: "x86_64".into(),
                    capabilities: vec!["docker".into()],
                    ..Default::default()
                },
                "http://127.0.0.1:8000",
            )
            .await
            .unwrap();
        let n = facade
            .patch_node(&joined.node.id, None, Some(true))
            .await
            .unwrap();
        assert!(n.drained);
    }

    #[test]
    fn bootstrap_script_contains_pending_file() {
        let s = bootstrap_script(
            "http://10.1.0.88:8000",
            "dfjoin_abc",
            "nas",
            "http://10.1.0.58:8000",
            "ghcr.io/bobdivx/devforge",
        );
        assert!(s.contains("cluster-pending-join.json"));
        assert!(s.contains("devforge-worker"));
        assert!(!s.contains("DEVFORGE_CLUSTER"));
        assert!(!s.contains("DEVFORGE_ROLE"));
    }
}
