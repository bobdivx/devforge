//! Persistance SQLite pour ports, domaines, proxy et WireGuard (survie au restart).

use async_trait::async_trait;
use devforge_domain::{DomainRecord, DomainStore};
use devforge_ports::{PortMapping, PortStore};
use devforge_proxy::{ProxyRoute, ProxyStore};
use devforge_wireguard::{WireguardStore, WgNetwork, WgPeer};
use devforge_shared::{DevForgeError, Result as DfResult};
use sqlx::SqlitePool;
use uuid::Uuid;

pub struct SqlitePortStore {
    pub pool: SqlitePool,
}

#[async_trait]
impl PortStore for SqlitePortStore {
    async fn list(&self, project_uuid: &str) -> DfResult<Vec<PortMapping>> {
        let rows: Vec<(String, String, i64, Option<i64>, String, i64)> = sqlx::query_as(
            r#"SELECT id, project_uuid, container_port, public_port, protocol, public
               FROM project_ports WHERE project_uuid = ? ORDER BY container_port"#,
        )
        .bind(project_uuid)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(rows
            .into_iter()
            .map(|(id, project_uuid, container_port, public_port, protocol, public)| {
                PortMapping {
                    id,
                    project_uuid,
                    container_port: container_port as u16,
                    public_port: public_port.map(|p| p as u16),
                    protocol,
                    public: public != 0,
                }
            })
            .collect())
    }

    async fn upsert(&self, mut mapping: PortMapping) -> DfResult<PortMapping> {
        if mapping.container_port == 0 {
            return Err(DevForgeError::Message("container_port invalide".into()));
        }
        if mapping.id.is_empty() {
            mapping.id = format!("port_{}", &Uuid::new_v4().to_string()[..8]);
        }
        if mapping.protocol.is_empty() {
            mapping.protocol = "tcp".into();
        }
        sqlx::query(
            r#"INSERT INTO project_ports (id, project_uuid, container_port, public_port, protocol, public)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 container_port=excluded.container_port,
                 public_port=excluded.public_port,
                 protocol=excluded.protocol,
                 public=excluded.public"#,
        )
        .bind(&mapping.id)
        .bind(&mapping.project_uuid)
        .bind(mapping.container_port as i64)
        .bind(mapping.public_port.map(|p| p as i64))
        .bind(&mapping.protocol)
        .bind(if mapping.public { 1i64 } else { 0 })
        .execute(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(mapping)
    }

    async fn delete(&self, project_uuid: &str, id: &str) -> DfResult<bool> {
        let res = sqlx::query("DELETE FROM project_ports WHERE project_uuid = ? AND id = ?")
            .bind(project_uuid)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(res.rows_affected() > 0)
    }
}

pub struct SqliteDomainStore {
    pub pool: SqlitePool,
}

#[async_trait]
impl DomainStore for SqliteDomainStore {
    async fn list(&self, project_uuid: &str) -> DfResult<Vec<DomainRecord>> {
        let rows: Vec<(String, String, String, i64, String)> = sqlx::query_as(
            r#"SELECT id, project_uuid, fqdn, tls, status FROM project_domains
               WHERE project_uuid = ? ORDER BY fqdn"#,
        )
        .bind(project_uuid)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(rows
            .into_iter()
            .map(|(id, project_uuid, fqdn, tls, status)| DomainRecord {
                id,
                project_uuid,
                fqdn,
                tls: tls != 0,
                status,
            })
            .collect())
    }

    async fn attach(&self, mut record: DomainRecord) -> DfResult<DomainRecord> {
        let fqdn = record.fqdn.trim().to_lowercase();
        if fqdn.is_empty() || !fqdn.contains('.') {
            return Err(DevForgeError::Message("fqdn invalide".into()));
        }
        record.fqdn = fqdn;
        if record.id.is_empty() {
            record.id = format!("dom_{}", &Uuid::new_v4().to_string()[..8]);
        }
        if record.status.is_empty() {
            record.status = if record.tls {
                "provisioning_tls".into()
            } else {
                "active".into()
            };
        }
        sqlx::query(
            r#"INSERT INTO project_domains (id, project_uuid, fqdn, tls, status)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET fqdn=excluded.fqdn, tls=excluded.tls, status=excluded.status"#,
        )
        .bind(&record.id)
        .bind(&record.project_uuid)
        .bind(&record.fqdn)
        .bind(if record.tls { 1i64 } else { 0 })
        .bind(&record.status)
        .execute(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(record)
    }

    async fn detach(&self, project_uuid: &str, id: &str) -> DfResult<bool> {
        let res = sqlx::query("DELETE FROM project_domains WHERE project_uuid = ? AND id = ?")
            .bind(project_uuid)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(res.rows_affected() > 0)
    }

    async fn update_status(&self, project_uuid: &str, id: &str, status: &str) -> DfResult<()> {
        sqlx::query("UPDATE project_domains SET status = ? WHERE project_uuid = ? AND id = ?")
            .bind(status)
            .bind(project_uuid)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(())
    }
}

pub struct SqliteProxyStore {
    pub pool: SqlitePool,
}

#[async_trait]
impl ProxyStore for SqliteProxyStore {
    async fn list(&self, project_uuid: &str) -> DfResult<Vec<ProxyRoute>> {
        let rows: Vec<(String, String, String, String, i64, i64)> = sqlx::query_as(
            r#"SELECT id, project_uuid, host, path_prefix, target_port, https_redirect
               FROM project_proxy_routes WHERE project_uuid = ? ORDER BY host"#,
        )
        .bind(project_uuid)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(rows
            .into_iter()
            .map(
                |(id, project_uuid, host, path_prefix, target_port, https_redirect)| ProxyRoute {
                    id,
                    project_uuid,
                    host,
                    path_prefix,
                    target_port: target_port as u16,
                    https_redirect: https_redirect != 0,
                },
            )
            .collect())
    }

    async fn upsert(&self, mut route: ProxyRoute) -> DfResult<ProxyRoute> {
        if route.host.trim().is_empty() {
            return Err(DevForgeError::Message("host requis".into()));
        }
        if route.target_port == 0 {
            return Err(DevForgeError::Message("target_port invalide".into()));
        }
        if route.id.is_empty() {
            route.id = format!("px_{}", &Uuid::new_v4().to_string()[..8]);
        }
        if route.path_prefix.is_empty() {
            route.path_prefix = "/".into();
        }
        sqlx::query(
            r#"INSERT INTO project_proxy_routes
               (id, project_uuid, host, path_prefix, target_port, https_redirect)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 host=excluded.host,
                 path_prefix=excluded.path_prefix,
                 target_port=excluded.target_port,
                 https_redirect=excluded.https_redirect"#,
        )
        .bind(&route.id)
        .bind(&route.project_uuid)
        .bind(&route.host)
        .bind(&route.path_prefix)
        .bind(route.target_port as i64)
        .bind(if route.https_redirect { 1i64 } else { 0 })
        .execute(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(route)
    }

    async fn delete(&self, project_uuid: &str, id: &str) -> DfResult<bool> {
        let res = sqlx::query("DELETE FROM project_proxy_routes WHERE project_uuid = ? AND id = ?")
            .bind(project_uuid)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(res.rows_affected() > 0)
    }
}

pub struct SqliteWireguardStore {
    pub pool: SqlitePool,
}

#[async_trait]
impl WireguardStore for SqliteWireguardStore {
    async fn list_networks(&self) -> DfResult<Vec<WgNetwork>> {
        let rows: Vec<(String, String, String, i64, String)> = sqlx::query_as(
            "SELECT id, name, subnet, listen_port, interface FROM wg_networks ORDER BY name",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        let mut nets = Vec::with_capacity(rows.len());
        for (id, name, subnet, listen_port, interface) in rows {
            let peers = self.peers_of(&id).await?;
            nets.push(WgNetwork {
                id,
                name,
                subnet,
                listen_port: listen_port as u16,
                peers,
                interface,
            });
        }
        Ok(nets)
    }

    async fn create_network(
        &self,
        name: &str,
        subnet: &str,
        listen_port: u16,
    ) -> DfResult<WgNetwork> {
        if name.trim().is_empty() {
            return Err(DevForgeError::Message("name requis".into()));
        }
        let id = format!("wg_{}", &Uuid::new_v4().to_string()[..8]);
        let interface = format!("wg-{}", &id[3..]);
        let subnet = if subnet.is_empty() {
            "10.10.0.0/24".to_string()
        } else {
            subnet.to_string()
        };
        let listen_port = if listen_port == 0 { 51820 } else { listen_port };
        sqlx::query(
            "INSERT INTO wg_networks (id, name, subnet, listen_port, interface) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(name)
        .bind(&subnet)
        .bind(listen_port as i64)
        .bind(&interface)
        .execute(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(WgNetwork {
            id,
            name: name.into(),
            subnet,
            listen_port,
            peers: vec![],
            interface,
        })
    }

    async fn add_peer(&self, network_id: &str, mut peer: WgPeer) -> DfResult<WgPeer> {
        let exists: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM wg_networks WHERE id = ?")
            .bind(network_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| DevForgeError::Message(e.to_string()))?;
        if exists.is_none() {
            return Err(DevForgeError::NotFound(format!("network {network_id}")));
        }
        if peer.id.is_empty() {
            peer.id = format!("peer_{}", &Uuid::new_v4().to_string()[..8]);
        }
        if peer.status.is_empty() {
            peer.status = "pending".into();
        }
        sqlx::query(
            r#"INSERT INTO wg_peers (id, network_id, name, public_key, allowed_ips, endpoint, status)
               VALUES (?, ?, ?, ?, ?, ?, ?)"#,
        )
        .bind(&peer.id)
        .bind(network_id)
        .bind(&peer.name)
        .bind(&peer.public_key)
        .bind(&peer.allowed_ips)
        .bind(&peer.endpoint)
        .bind(&peer.status)
        .execute(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(peer)
    }

    async fn remove_peer(&self, network_id: &str, peer_id: &str) -> DfResult<bool> {
        let res = sqlx::query("DELETE FROM wg_peers WHERE network_id = ? AND id = ?")
            .bind(network_id)
            .bind(peer_id)
            .execute(&self.pool)
            .await
            .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(res.rows_affected() > 0)
    }

    async fn get_network(&self, network_id: &str) -> DfResult<Option<WgNetwork>> {
        let row: Option<(String, String, String, i64, String)> = sqlx::query_as(
            "SELECT id, name, subnet, listen_port, interface FROM wg_networks WHERE id = ?",
        )
        .bind(network_id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        let Some((id, name, subnet, listen_port, interface)) = row else {
            return Ok(None);
        };
        let peers = self.peers_of(&id).await?;
        Ok(Some(WgNetwork {
            id,
            name,
            subnet,
            listen_port: listen_port as u16,
            peers,
            interface,
        }))
    }

    async fn set_peer_status(
        &self,
        network_id: &str,
        peer_id: &str,
        status: &str,
    ) -> DfResult<()> {
        sqlx::query("UPDATE wg_peers SET status = ? WHERE network_id = ? AND id = ?")
            .bind(status)
            .bind(network_id)
            .bind(peer_id)
            .execute(&self.pool)
            .await
            .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(())
    }
}

impl SqliteWireguardStore {
    async fn peers_of(&self, network_id: &str) -> DfResult<Vec<WgPeer>> {
        let rows: Vec<(String, String, String, String, Option<String>, String)> = sqlx::query_as(
            r#"SELECT id, name, public_key, allowed_ips, endpoint, status
               FROM wg_peers WHERE network_id = ? ORDER BY name"#,
        )
        .bind(network_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(rows
            .into_iter()
            .map(
                |(id, name, public_key, allowed_ips, endpoint, status)| WgPeer {
                    id,
                    name,
                    public_key,
                    allowed_ips,
                    endpoint,
                    status,
                },
            )
            .collect())
    }
}

#[cfg(test)]
mod wg_tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn network_and_peer_survive_a_new_store() {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            r#"CREATE TABLE wg_networks (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, subnet TEXT NOT NULL,
                listen_port INTEGER NOT NULL, interface TEXT NOT NULL
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"CREATE TABLE wg_peers (
                id TEXT PRIMARY KEY, network_id TEXT NOT NULL, name TEXT NOT NULL,
                public_key TEXT NOT NULL, allowed_ips TEXT NOT NULL,
                endpoint TEXT, status TEXT NOT NULL DEFAULT 'pending'
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        let store = SqliteWireguardStore { pool: pool.clone() };
        let net = store
            .create_network("edge", "10.8.0.0/24", 51820)
            .await
            .unwrap();
        store
            .add_peer(
                &net.id,
                WgPeer {
                    id: String::new(),
                    name: "worker".into(),
                    public_key: "pk".into(),
                    allowed_ips: "10.8.0.2/32".into(),
                    endpoint: Some("1.2.3.4:51820".into()),
                    status: String::new(),
                },
            )
            .await
            .unwrap();
        let reloaded = SqliteWireguardStore { pool };
        let again = reloaded.get_network(&net.id).await.unwrap().unwrap();
        assert_eq!(again.peers.len(), 1);
        assert_eq!(again.peers[0].status, "pending");
        assert_eq!(again.subnet, "10.8.0.0/24");
    }
}
