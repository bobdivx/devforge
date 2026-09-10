use async_trait::async_trait;
use devforge_deploy::RemoteExecutor;
use devforge_shared::{DevForgeError, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WgPeer {
    pub id: String,
    pub name: String,
    pub public_key: String,
    pub allowed_ips: String,
    pub endpoint: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WgNetwork {
    pub id: String,
    pub name: String,
    pub subnet: String,
    pub listen_port: u16,
    pub peers: Vec<WgPeer>,
    pub interface: String,
}

#[async_trait]
pub trait WireguardStore: Send + Sync {
    async fn list_networks(&self) -> Result<Vec<WgNetwork>>;
    async fn create_network(&self, name: &str, subnet: &str, listen_port: u16) -> Result<WgNetwork>;
    async fn add_peer(&self, network_id: &str, peer: WgPeer) -> Result<WgPeer>;
    async fn remove_peer(&self, network_id: &str, peer_id: &str) -> Result<bool>;
    async fn get_network(&self, network_id: &str) -> Result<Option<WgNetwork>>;
    async fn set_peer_status(&self, network_id: &str, peer_id: &str, status: &str) -> Result<()>;
}

#[derive(Default, Clone)]
pub struct MemoryWireguardStore {
    inner: Arc<RwLock<HashMap<String, WgNetwork>>>,
}

impl MemoryWireguardStore {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl WireguardStore for MemoryWireguardStore {
    async fn list_networks(&self) -> Result<Vec<WgNetwork>> {
        let mut v: Vec<_> = self.inner.read().await.values().cloned().collect();
        v.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(v)
    }

    async fn create_network(&self, name: &str, subnet: &str, listen_port: u16) -> Result<WgNetwork> {
        if name.trim().is_empty() {
            return Err(DevForgeError::Message("name requis".into()));
        }
        let id = format!("wg_{}", &Uuid::new_v4().to_string()[..8]);
        let iface = format!("wg-{}", &id[3..]);
        let net = WgNetwork {
            id: id.clone(),
            name: name.into(),
            subnet: if subnet.is_empty() {
                "10.10.0.0/24".into()
            } else {
                subnet.into()
            },
            listen_port: if listen_port == 0 { 51820 } else { listen_port },
            peers: vec![],
            interface: iface,
        };
        self.inner.write().await.insert(id, net.clone());
        Ok(net)
    }

    async fn add_peer(&self, network_id: &str, mut peer: WgPeer) -> Result<WgPeer> {
        let mut guard = self.inner.write().await;
        let net = guard
            .get_mut(network_id)
            .ok_or_else(|| DevForgeError::NotFound(format!("network {network_id}")))?;
        if peer.id.is_empty() {
            peer.id = format!("peer_{}", &Uuid::new_v4().to_string()[..8]);
        }
        if peer.status.is_empty() {
            peer.status = "pending".into();
        }
        net.peers.push(peer.clone());
        Ok(peer)
    }

    async fn remove_peer(&self, network_id: &str, peer_id: &str) -> Result<bool> {
        let mut guard = self.inner.write().await;
        let Some(net) = guard.get_mut(network_id) else {
            return Ok(false);
        };
        let before = net.peers.len();
        net.peers.retain(|p| p.id != peer_id);
        Ok(net.peers.len() != before)
    }

    async fn get_network(&self, network_id: &str) -> Result<Option<WgNetwork>> {
        Ok(self.inner.read().await.get(network_id).cloned())
    }

    async fn set_peer_status(&self, network_id: &str, peer_id: &str, status: &str) -> Result<()> {
        let mut guard = self.inner.write().await;
        if let Some(net) = guard.get_mut(network_id) {
            if let Some(p) = net.peers.iter_mut().find(|p| p.id == peer_id) {
                p.status = status.into();
            }
        }
        Ok(())
    }
}

fn render_wg_conf(net: &WgNetwork) -> String {
    let address = {
        let base = net.subnet.split('/').next().unwrap_or("10.10.0.0");
        let parts: Vec<&str> = base.split('.').collect();
        if parts.len() == 4 {
            format!("{}.{}.{}.1/24", parts[0], parts[1], parts[2])
        } else {
            "10.10.0.1/24".into()
        }
    };
    let mut conf = format!(
        "[Interface]\nAddress = {address}\nListenPort = {}\n# PrivateKey must already exist on host\n\n",
        net.listen_port
    );
    for peer in &net.peers {
        conf.push_str(&format!(
            "[Peer]\nPublicKey = {}\nAllowedIPs = {}\n",
            peer.public_key, peer.allowed_ips
        ));
        if let Some(ep) = &peer.endpoint {
            conf.push_str(&format!("Endpoint = {ep}\n"));
        }
        conf.push('\n');
    }
    conf
}

fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

pub struct WireguardFacade {
    store: Arc<dyn WireguardStore>,
    executor: Option<Arc<dyn RemoteExecutor>>,
    apply_server_id: String,
}

impl WireguardFacade {
    pub fn new(store: Arc<dyn WireguardStore>) -> Self {
        Self {
            store,
            executor: None,
            apply_server_id: "default".into(),
        }
    }

    pub fn with_executor(
        mut self,
        executor: Arc<dyn RemoteExecutor>,
        server_id: impl Into<String>,
    ) -> Self {
        self.executor = Some(executor);
        self.apply_server_id = server_id.into();
        self
    }

    pub async fn list(&self) -> Result<Value> {
        Ok(json!({"ok": true, "networks": self.store.list_networks().await?}))
    }

    pub async fn create(&self, name: &str, subnet: Option<&str>, listen_port: Option<u16>) -> Result<Value> {
        let net = self
            .store
            .create_network(name, subnet.unwrap_or(""), listen_port.unwrap_or(51820))
            .await?;
        Ok(json!({"ok": true, "network": net}))
    }

    pub async fn add_peer(
        &self,
        network_id: &str,
        name: &str,
        public_key: &str,
        allowed_ips: &str,
        endpoint: Option<String>,
    ) -> Result<Value> {
        let peer = self
            .store
            .add_peer(
                network_id,
                WgPeer {
                    id: String::new(),
                    name: name.into(),
                    public_key: public_key.into(),
                    allowed_ips: allowed_ips.into(),
                    endpoint,
                    status: String::new(),
                },
            )
            .await?;
        Ok(json!({"ok": true, "peer": peer}))
    }

    /// Write config under `/etc/wireguard/{iface}.conf` and `wg-quick up`.
    pub async fn apply(&self, network_id: &str) -> Result<Value> {
        let net = self
            .store
            .get_network(network_id)
            .await?
            .ok_or_else(|| DevForgeError::NotFound(format!("network {network_id}")))?;
        let conf = render_wg_conf(&net);
        let path = format!("/etc/wireguard/{}.conf", net.interface);

        if let Some(exec) = &self.executor {
            let write = format!(
                "umask 077; cat > {} <<'DEVFORGE_WG'\n{}DEVFORGE_WG",
                path, conf
            );
            let up = format!(
                "wg-quick down {} 2>/dev/null; wg-quick up {}",
                shell_escape(&net.interface),
                shell_escape(&net.interface)
            );
            let cmd = format!("{write}\n{up}");
            let res = exec
                .exec(&self.apply_server_id, "", &cmd, 120)
                .await?;
            for p in &net.peers {
                self.store
                    .set_peer_status(network_id, &p.id, if res.ok { "active" } else { "failed" })
                    .await?;
            }
            return Ok(json!({
                "ok": res.ok,
                "network_id": network_id,
                "interface": net.interface,
                "path": path,
                "output": res.output.chars().take(4000).collect::<String>(),
            }));
        }

        Ok(json!({
            "ok": true,
            "network_id": network_id,
            "interface": net.interface,
            "config": conf,
            "note": "executor non branché — config générée seulement"
        }))
    }
}
