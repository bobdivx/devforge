use crate::models::{EnvEntry, ManagedRunner};
use async_trait::async_trait;
use devforge_shared::Result;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[async_trait]
pub trait RunnerStore: Send + Sync {
    async fn list(&self) -> Result<Vec<ManagedRunner>>;
    async fn get(&self, id: &str) -> Result<Option<ManagedRunner>>;
    async fn get_by_container(
        &self,
        server_id: &str,
        container_name: &str,
    ) -> Result<Option<ManagedRunner>>;
    async fn upsert(&self, runner: &ManagedRunner) -> Result<()>;
    async fn delete(&self, id: &str) -> Result<bool>;
    async fn update_live(
        &self,
        id: &str,
        live_state: &str,
        live_status: &str,
        container_id: Option<&str>,
        github_status: Option<&str>,
        github_busy: Option<bool>,
        github_runner_id: Option<i64>,
        last_synced_at: &str,
        last_error: Option<&str>,
    ) -> Result<()>;
    async fn set_op_status(
        &self,
        id: &str,
        op_status: &str,
        last_error: Option<&str>,
    ) -> Result<()>;
}

#[derive(Default, Clone)]
pub struct MemoryRunnerStore {
    inner: Arc<RwLock<HashMap<String, ManagedRunner>>>,
}

impl MemoryRunnerStore {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl RunnerStore for MemoryRunnerStore {
    async fn list(&self) -> Result<Vec<ManagedRunner>> {
        let mut v: Vec<_> = self.inner.read().await.values().cloned().collect();
        v.sort_by(|a, b| a.runner_name.cmp(&b.runner_name));
        Ok(v)
    }

    async fn get(&self, id: &str) -> Result<Option<ManagedRunner>> {
        Ok(self.inner.read().await.get(id).cloned())
    }

    async fn get_by_container(
        &self,
        server_id: &str,
        container_name: &str,
    ) -> Result<Option<ManagedRunner>> {
        Ok(self
            .inner
            .read()
            .await
            .values()
            .find(|r| r.server_id == server_id && r.container_name == container_name)
            .cloned())
    }

    async fn upsert(&self, runner: &ManagedRunner) -> Result<()> {
        self.inner
            .write()
            .await
            .insert(runner.id.clone(), runner.clone());
        Ok(())
    }

    async fn delete(&self, id: &str) -> Result<bool> {
        Ok(self.inner.write().await.remove(id).is_some())
    }

    async fn update_live(
        &self,
        id: &str,
        live_state: &str,
        live_status: &str,
        container_id: Option<&str>,
        github_status: Option<&str>,
        github_busy: Option<bool>,
        github_runner_id: Option<i64>,
        last_synced_at: &str,
        last_error: Option<&str>,
    ) -> Result<()> {
        let mut guard = self.inner.write().await;
        if let Some(r) = guard.get_mut(id) {
            r.live_state = live_state.into();
            r.live_status = live_status.into();
            r.container_id = container_id.map(str::to_string);
            r.github_status = github_status.map(str::to_string);
            r.github_busy = github_busy;
            r.github_runner_id = github_runner_id;
            r.last_synced_at = Some(last_synced_at.into());
            r.last_error = last_error.map(str::to_string);
            r.updated_at = last_synced_at.into();
        }
        Ok(())
    }

    async fn set_op_status(
        &self,
        id: &str,
        op_status: &str,
        last_error: Option<&str>,
    ) -> Result<()> {
        let mut guard = self.inner.write().await;
        if let Some(r) = guard.get_mut(id) {
            r.op_status = op_status.into();
            if last_error.is_some() {
                r.last_error = last_error.map(str::to_string);
            } else if op_status == "idle" {
                r.last_error = None;
            }
            r.updated_at = chrono::Utc::now().to_rfc3339();
        }
        Ok(())
    }
}

pub fn encode_volumes(volumes: &[String]) -> String {
    serde_json::to_string(volumes).unwrap_or_else(|_| "[]".into())
}

pub fn decode_volumes(raw: &str) -> Vec<String> {
    serde_json::from_str(raw).unwrap_or_default()
}

pub fn encode_extra_env(env: &[EnvEntry]) -> String {
    serde_json::to_string(env).unwrap_or_else(|_| "[]".into())
}

pub fn decode_extra_env(raw: &str) -> Vec<EnvEntry> {
    serde_json::from_str(raw).unwrap_or_default()
}
