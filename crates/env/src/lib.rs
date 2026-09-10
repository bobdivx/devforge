use async_trait::async_trait;
use devforge_shared::{DevForgeError, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvVar {
    pub key: String,
    pub value: String,
    #[serde(default)]
    pub secret: bool,
}

impl EnvVar {
    /// Never leak secret values into agent/tool logs.
    pub fn public_view(&self) -> Value {
        json!({
            "key": self.key,
            "secret": self.secret,
            "value": if self.secret { "********" } else { self.value.as_str() }
        })
    }
}

/// Parse a `.env` file body into key/value pairs (comments & blank lines ignored).
pub fn parse_dotenv(content: &str) -> Result<Vec<EnvVar>> {
    let mut out = Vec::new();
    for (i, raw) in content.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line).trim();
        let Some((key, value)) = line.split_once('=') else {
            return Err(DevForgeError::Message(format!(
                "ligne {}: format invalide (attendu KEY=value)",
                i + 1
            )));
        };
        let key = key.trim();
        if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return Err(DevForgeError::Message(format!(
                "ligne {}: clé invalide « {key} »",
                i + 1
            )));
        }
        let mut value = value.trim().to_string();
        if (value.starts_with('"') && value.ends_with('"') && value.len() >= 2)
            || (value.starts_with('\'') && value.ends_with('\'') && value.len() >= 2)
        {
            value = value[1..value.len() - 1].to_string();
        }
        out.push(EnvVar {
            key: key.to_string(),
            value,
            secret: true,
        });
    }
    Ok(out)
}

#[async_trait]
pub trait EnvStore: Send + Sync {
    async fn list(&self, project_uuid: &str) -> Result<Vec<EnvVar>>;
    async fn get(&self, project_uuid: &str, key: &str) -> Result<Option<EnvVar>>;
    async fn upsert(&self, project_uuid: &str, var: EnvVar) -> Result<EnvVar>;
    async fn delete(&self, project_uuid: &str, key: &str) -> Result<bool>;
}

/// In-memory store (swap for SQLite/Postgres-backed impl in server).
#[derive(Default, Clone)]
pub struct MemoryEnvStore {
    inner: Arc<RwLock<HashMap<String, HashMap<String, EnvVar>>>>,
}

impl MemoryEnvStore {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl EnvStore for MemoryEnvStore {
    async fn list(&self, project_uuid: &str) -> Result<Vec<EnvVar>> {
        let map = self.inner.read().await;
        let mut vars: Vec<_> = map
            .get(project_uuid)
            .map(|m| m.values().cloned().collect())
            .unwrap_or_default();
        vars.sort_by(|a, b| a.key.cmp(&b.key));
        Ok(vars)
    }

    async fn get(&self, project_uuid: &str, key: &str) -> Result<Option<EnvVar>> {
        Ok(self
            .inner
            .read()
            .await
            .get(project_uuid)
            .and_then(|m| m.get(key).cloned()))
    }

    async fn upsert(&self, project_uuid: &str, var: EnvVar) -> Result<EnvVar> {
        let key = var.key.trim().to_string();
        if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return Err(DevForgeError::Message(
                "clé env invalide (A-Z, 0-9, _)".into(),
            ));
        }
        let clean = EnvVar {
            key: key.clone(),
            value: var.value,
            secret: var.secret,
        };
        self.inner
            .write()
            .await
            .entry(project_uuid.to_string())
            .or_default()
            .insert(key, clean.clone());
        Ok(clean)
    }

    async fn delete(&self, project_uuid: &str, key: &str) -> Result<bool> {
        Ok(self
            .inner
            .write()
            .await
            .get_mut(project_uuid)
            .map(|m| m.remove(key).is_some())
            .unwrap_or(false))
    }
}

pub struct EnvFacade {
    store: Arc<dyn EnvStore>,
}

impl EnvFacade {
    pub fn new(store: Arc<dyn EnvStore>) -> Self {
        Self { store }
    }

    pub async fn list_public(&self, project_uuid: &str) -> Result<Vec<Value>> {
        Ok(self
            .store
            .list(project_uuid)
            .await?
            .into_iter()
            .map(|v| v.public_view())
            .collect())
    }

    /// Valeur réelle pour l’UI authentifiée (voir / modifier).
    pub async fn get(&self, project_uuid: &str, key: &str) -> Result<Option<EnvVar>> {
        self.store.get(project_uuid, key).await
    }

    pub async fn upsert(&self, project_uuid: &str, var: EnvVar) -> Result<Value> {
        Ok(self.store.upsert(project_uuid, var).await?.public_view())
    }

    pub async fn delete(&self, project_uuid: &str, key: &str) -> Result<bool> {
        self.store.delete(project_uuid, key).await
    }

    pub async fn import_dotenv(
        &self,
        project_uuid: &str,
        content: &str,
        overwrite: bool,
    ) -> Result<Value> {
        let parsed = parse_dotenv(content)?;
        let existing = self.store.list(project_uuid).await?;
        let existing_keys: std::collections::HashSet<_> =
            existing.into_iter().map(|v| v.key).collect();
        let mut imported = 0u32;
        let mut skipped = 0u32;
        for var in parsed {
            if !overwrite && existing_keys.contains(&var.key) {
                skipped += 1;
                continue;
            }
            self.store.upsert(project_uuid, var).await?;
            imported += 1;
        }
        Ok(json!({
            "ok": true,
            "imported": imported,
            "skipped": skipped,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_dotenv() {
        let vars = parse_dotenv(
            r#"
# comment
FOO=bar
export BAZ="hello world"
EMPTY=
"#,
        )
        .unwrap();
        assert_eq!(vars.len(), 3);
        assert_eq!(vars[0].key, "FOO");
        assert_eq!(vars[0].value, "bar");
        assert_eq!(vars[1].key, "BAZ");
        assert_eq!(vars[1].value, "hello world");
    }
}
