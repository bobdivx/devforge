mod porkbun;
mod cloudflare;

pub use porkbun::{
    delete_record, lookup as porkbun_lookup, ping as porkbun_ping, split_host, upsert_record,
    verify_zone as porkbun_verify_zone, PorkbunCreds,
};
pub use cloudflare::{
    connect as cloudflare_connect, infer_zone, parse_porkbun_token, ping as cloudflare_ping,
    CloudflareClient,
};

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
pub struct DomainRecord {
    pub id: String,
    pub project_uuid: String,
    pub fqdn: String,
    pub tls: bool,
    pub status: String,
}

#[async_trait]
pub trait DomainStore: Send + Sync {
    async fn list(&self, project_uuid: &str) -> Result<Vec<DomainRecord>>;
    async fn attach(&self, record: DomainRecord) -> Result<DomainRecord>;
    async fn detach(&self, project_uuid: &str, id: &str) -> Result<bool>;
    async fn update_status(&self, project_uuid: &str, id: &str, status: &str) -> Result<()>;
}

#[derive(Default, Clone)]
pub struct MemoryDomainStore {
    inner: Arc<RwLock<HashMap<String, Vec<DomainRecord>>>>,
}

impl MemoryDomainStore {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl DomainStore for MemoryDomainStore {
    async fn list(&self, project_uuid: &str) -> Result<Vec<DomainRecord>> {
        Ok(self
            .inner
            .read()
            .await
            .get(project_uuid)
            .cloned()
            .unwrap_or_default())
    }

    async fn attach(&self, mut record: DomainRecord) -> Result<DomainRecord> {
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
        let mut guard = self.inner.write().await;
        let list = guard.entry(record.project_uuid.clone()).or_default();
        list.push(record.clone());
        Ok(record)
    }

    async fn detach(&self, project_uuid: &str, id: &str) -> Result<bool> {
        let mut guard = self.inner.write().await;
        if let Some(list) = guard.get_mut(project_uuid) {
            let before = list.len();
            list.retain(|d| d.id != id);
            return Ok(list.len() != before);
        }
        Ok(false)
    }

    async fn update_status(&self, project_uuid: &str, id: &str, status: &str) -> Result<()> {
        let mut guard = self.inner.write().await;
        if let Some(list) = guard.get_mut(project_uuid) {
            if let Some(d) = list.iter_mut().find(|d| d.id == id) {
                d.status = status.into();
            }
        }
        Ok(())
    }
}

fn certbot_command(fqdn: &str, email: &str) -> String {
    format!(
        "certbot certonly --non-interactive --agree-tos --email {} -d {} --webroot -w /var/www/certbot || certbot certonly --non-interactive --agree-tos --email {} -d {} --standalone",
        shell_escape(email),
        shell_escape(fqdn),
        shell_escape(email),
        shell_escape(fqdn),
    )
}

fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

pub struct DomainFacade {
    store: Arc<dyn DomainStore>,
    executor: Option<Arc<dyn RemoteExecutor>>,
    apply_server_id: String,
    acme_email: String,
}

impl DomainFacade {
    pub fn new(store: Arc<dyn DomainStore>) -> Self {
        Self {
            store,
            executor: None,
            apply_server_id: "default".into(),
            acme_email: std::env::var("DEVFORGE_ACME_EMAIL")
                .unwrap_or_else(|_| "admin@localhost".into()),
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

    pub async fn list(&self, project_uuid: &str) -> Result<Value> {
        Ok(json!({"ok": true, "domains": self.store.list(project_uuid).await?}))
    }

    pub async fn attach(&self, project_uuid: &str, fqdn: &str, tls: bool) -> Result<Value> {
        let mut record = self
            .store
            .attach(DomainRecord {
                id: String::new(),
                project_uuid: project_uuid.into(),
                fqdn: fqdn.into(),
                tls,
                status: String::new(),
            })
            .await?;

        let mut acme: Option<Value> = None;
        let acme_enabled = std::env::var("DEVFORGE_ACME")
            .map(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
            .unwrap_or(false);
        if tls {
            if acme_enabled {
                if let Some(exec) = &self.executor {
                    let cmd = certbot_command(&record.fqdn, &self.acme_email);
                    let res = exec
                        .exec(&self.apply_server_id, "", &cmd, 300)
                        .await?;
                    let status = if res.ok { "tls_active" } else { "tls_failed" };
                    self.store
                        .update_status(project_uuid, &record.id, status)
                        .await?;
                    record.status = status.into();
                    acme = Some(json!({
                        "ok": res.ok,
                        "command": "certbot certonly …",
                        "output": res.output.chars().take(4000).collect::<String>(),
                    }));
                } else {
                    self.store
                        .update_status(project_uuid, &record.id, "tls_pending_no_executor")
                        .await?;
                    record.status = "tls_pending_no_executor".into();
                }
            } else {
                self.store
                    .update_status(project_uuid, &record.id, "dns_pending")
                    .await?;
                record.status = "dns_pending".into();
                acme = Some(json!({
                    "ok": true,
                    "skipped": true,
                    "hint": "TLS ACME désactivé (DEVFORGE_ACME=1 pour activer certbot)",
                }));
            }
        }

        Ok(json!({
            "ok": true,
            "domain": record,
            "acme": acme,
        }))
    }

    pub async fn detach(&self, project_uuid: &str, id: &str) -> Result<Value> {
        Ok(json!({"ok": self.store.detach(project_uuid, id).await?}))
    }
}
