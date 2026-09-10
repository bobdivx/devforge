use async_trait::async_trait;
use devforge_shared::{DevForgeError, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortMapping {
    pub id: String,
    pub project_uuid: String,
    pub container_port: u16,
    pub public_port: Option<u16>,
    pub protocol: String,
    pub public: bool,
}

#[async_trait]
pub trait PortStore: Send + Sync {
    async fn list(&self, project_uuid: &str) -> Result<Vec<PortMapping>>;
    async fn upsert(&self, mapping: PortMapping) -> Result<PortMapping>;
    async fn delete(&self, project_uuid: &str, id: &str) -> Result<bool>;
}

#[derive(Default, Clone)]
pub struct MemoryPortStore {
    inner: Arc<RwLock<HashMap<String, Vec<PortMapping>>>>,
}

impl MemoryPortStore {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl PortStore for MemoryPortStore {
    async fn list(&self, project_uuid: &str) -> Result<Vec<PortMapping>> {
        Ok(self
            .inner
            .read()
            .await
            .get(project_uuid)
            .cloned()
            .unwrap_or_default())
    }

    async fn upsert(&self, mut mapping: PortMapping) -> Result<PortMapping> {
        if mapping.container_port == 0 {
            return Err(DevForgeError::Message("container_port invalide".into()));
        }
        if mapping.id.is_empty() {
            mapping.id = format!("port_{}", &Uuid::new_v4().to_string()[..8]);
        }
        if mapping.protocol.is_empty() {
            mapping.protocol = "tcp".into();
        }
        let mut guard = self.inner.write().await;
        let list = guard.entry(mapping.project_uuid.clone()).or_default();
        if let Some(existing) = list.iter_mut().find(|p| p.id == mapping.id) {
            *existing = mapping.clone();
        } else {
            list.push(mapping.clone());
        }
        Ok(mapping)
    }

    async fn delete(&self, project_uuid: &str, id: &str) -> Result<bool> {
        let mut guard = self.inner.write().await;
        if let Some(list) = guard.get_mut(project_uuid) {
            let before = list.len();
            list.retain(|p| p.id != id);
            return Ok(list.len() != before);
        }
        Ok(false)
    }
}

pub struct PortsFacade {
    store: Arc<dyn PortStore>,
}

impl PortsFacade {
    pub fn new(store: Arc<dyn PortStore>) -> Self {
        Self { store }
    }

    pub async fn list(&self, project_uuid: &str) -> Result<Value> {
        let ports = self.store.list(project_uuid).await?;
        Ok(json!({"ok": true, "ports": ports}))
    }

    pub async fn upsert(
        &self,
        project_uuid: &str,
        container_port: u16,
        public_port: Option<u16>,
        protocol: Option<&str>,
        public: bool,
    ) -> Result<Value> {
        let mapping = self
            .store
            .upsert(PortMapping {
                id: String::new(),
                project_uuid: project_uuid.into(),
                container_port,
                public_port,
                protocol: protocol.unwrap_or("tcp").into(),
                public,
            })
            .await?;
        Ok(json!({"ok": true, "port": mapping}))
    }

    pub async fn delete(&self, project_uuid: &str, id: &str) -> Result<Value> {
        let ok = self.store.delete(project_uuid, id).await?;
        Ok(json!({"ok": ok}))
    }
}
