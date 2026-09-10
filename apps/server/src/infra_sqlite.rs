//! Persistance SQLite pour ports / domains / proxy (survie au restart).

use async_trait::async_trait;
use devforge_domain::{DomainRecord, DomainStore};
use devforge_ports::{PortMapping, PortStore};
use devforge_proxy::{ProxyRoute, ProxyStore};
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
