use async_trait::async_trait;
use devforge_deploy::{docker, RemoteExecutor};
use devforge_shared::{DevForgeError, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

/// Reverse-proxy route (labels / router rules).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyRoute {
    pub id: String,
    pub project_uuid: String,
    pub host: String,
    pub path_prefix: String,
    pub target_port: u16,
    pub https_redirect: bool,
}

#[async_trait]
pub trait ProxyStore: Send + Sync {
    async fn list(&self, project_uuid: &str) -> Result<Vec<ProxyRoute>>;
    async fn upsert(&self, route: ProxyRoute) -> Result<ProxyRoute>;
    async fn delete(&self, project_uuid: &str, id: &str) -> Result<bool>;
}

#[derive(Default, Clone)]
pub struct MemoryProxyStore {
    inner: Arc<RwLock<HashMap<String, Vec<ProxyRoute>>>>,
}

impl MemoryProxyStore {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl ProxyStore for MemoryProxyStore {
    async fn list(&self, project_uuid: &str) -> Result<Vec<ProxyRoute>> {
        Ok(self
            .inner
            .read()
            .await
            .get(project_uuid)
            .cloned()
            .unwrap_or_default())
    }

    async fn upsert(&self, mut route: ProxyRoute) -> Result<ProxyRoute> {
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
        let mut guard = self.inner.write().await;
        let list = guard.entry(route.project_uuid.clone()).or_default();
        if let Some(existing) = list.iter_mut().find(|r| r.id == route.id) {
            *existing = route.clone();
        } else {
            list.push(route.clone());
        }
        Ok(route)
    }

    async fn delete(&self, project_uuid: &str, id: &str) -> Result<bool> {
        let mut guard = self.inner.write().await;
        if let Some(list) = guard.get_mut(project_uuid) {
            let before = list.len();
            list.retain(|r| r.id != id);
            return Ok(list.len() != before);
        }
        Ok(false)
    }
}

pub struct ProxyFacade {
    store: Arc<dyn ProxyStore>,
    executor: Option<Arc<dyn RemoteExecutor>>,
    /// server_id used when applying labels (default `default`).
    apply_server_id: String,
}

impl ProxyFacade {
    pub fn new(store: Arc<dyn ProxyStore>) -> Self {
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

    pub async fn list(&self, project_uuid: &str) -> Result<Value> {
        Ok(json!({"ok": true, "routes": self.store.list(project_uuid).await?}))
    }

    pub async fn upsert(&self, route: ProxyRoute) -> Result<Value> {
        Ok(json!({"ok": true, "route": self.store.upsert(route).await?}))
    }

    pub async fn delete(&self, project_uuid: &str, id: &str) -> Result<Value> {
        Ok(json!({"ok": self.store.delete(project_uuid, id).await?}))
    }

    /// Generate Traefik labels and apply via `docker update` when an executor is wired.
    pub async fn sync(&self, project_uuid: &str) -> Result<Value> {
        let routes = self.store.list(project_uuid).await?;
        let mut labels = serde_json::Map::new();
        for route in &routes {
            let piece = docker::traefik_labels(
                project_uuid,
                &route.host,
                &route.path_prefix,
                route.target_port,
            );
            if let Some(obj) = piece.as_object() {
                for (k, v) in obj {
                    labels.insert(k.clone(), v.clone());
                }
            }
        }
        let labels_val = Value::Object(labels.clone());
        let container = format!("df-{}", project_uuid.chars().take(12).collect::<String>());

        if let Some(exec) = &self.executor {
            let cmd = docker::docker_update_labels(&container, &labels_val);
            let res = exec
                .exec(&self.apply_server_id, "", &cmd, 60)
                .await?;
            return Ok(json!({
                "ok": res.ok,
                "project_uuid": project_uuid,
                "synced": routes.len(),
                "container": container,
                "labels": labels_val,
                "command": cmd,
                "output": res.output,
            }));
        }

        Ok(json!({
            "ok": true,
            "project_uuid": project_uuid,
            "synced": routes.len(),
            "labels": labels_val,
            "note": "executor non branché — labels générés seulement"
        }))
    }
}
