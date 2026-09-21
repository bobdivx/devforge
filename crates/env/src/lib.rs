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

/// Format a single env var for Docker `--env-file` consumption.
///
/// Docker `docker run --env-file` does **not** strip outer quotes. If you write `KEY="value"`,
/// the container gets the literal string `"value"` including quote characters.
///
/// This function:
/// - Emits `KEY=value` (no outer quotes) when the value is safe (no newlines/special chars)
/// - Escapes embedded newlines as `\n`, backslashes as `\\`, etc. per Docker env-file spec
/// - Does **not** wrap the value in `"…"` that would become part of the runtime value
///
/// References:
/// - https://docs.docker.com/engine/reference/commandline/run/#env-file
/// - Docker env-file format: each line is `VAR=val` with backslash escapes, no outer quotes
pub fn format_docker_env_line(key: &str, value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            _ => escaped.push(ch),
        }
    }
    format!("{key}={escaped}\n")
}

/// Serialize a list of env vars into Docker `--env-file` format.
pub fn serialize_docker_env_file(vars: &[(String, String)]) -> String {
    vars.iter()
        .map(|(k, v)| format_docker_env_line(k, v))
        .collect()
}

/// Stats d’un merge env (import / sync workdir → projet).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EnvMergeStats {
    /// Clés absentes du projet, ajoutées.
    pub imported: u32,
    /// Clés existantes dont la valeur a réellement changé.
    pub updated: u32,
    /// Clés déjà présentes avec la même valeur (non réécrites).
    pub unchanged: u32,
    /// Clés ignorées car `overwrite=false`.
    pub skipped: u32,
}

impl EnvMergeStats {
    pub fn to_json(&self) -> Value {
        json!({
            "ok": true,
            "imported": self.imported,
            "updated": self.updated,
            "unchanged": self.unchanged,
            "skipped": self.skipped,
        })
    }
}

/// Compare incoming vars to existing project vars.
/// Retourne uniquement les variables à upsert (nouvelles ou valeur différente).
pub fn env_vars_needing_write(
    existing: &[EnvVar],
    incoming: &[EnvVar],
    overwrite: bool,
) -> (Vec<EnvVar>, EnvMergeStats) {
    let map: HashMap<&str, &str> = existing
        .iter()
        .map(|v| (v.key.as_str(), v.value.as_str()))
        .collect();
    let mut stats = EnvMergeStats::default();
    let mut to_write = Vec::new();
    for var in incoming {
        match map.get(var.key.as_str()) {
            None => {
                stats.imported += 1;
                to_write.push(var.clone());
            }
            Some(prev) if *prev == var.value.as_str() => {
                stats.unchanged += 1;
            }
            Some(_) if overwrite => {
                stats.updated += 1;
                to_write.push(var.clone());
            }
            Some(_) => {
                stats.skipped += 1;
            }
        }
    }
    (to_write, stats)
}

/// Écrit (ou remplace) le fichier `.env` d’un workdir depuis les vars projet.
/// Si `vars` est vide, supprime `.env` pour éviter un leftover d’un autre projet.
pub fn materialize_dotenv_file(
    workdir: &std::path::Path,
    vars: &[(String, String)],
) -> std::io::Result<MaterializeOutcome> {
    let env_path = workdir.join(".env");
    if vars.is_empty() {
        if env_path.exists() {
            std::fs::remove_file(&env_path)?;
            return Ok(MaterializeOutcome::Removed);
        }
        return Ok(MaterializeOutcome::Absent);
    }
    let body = serialize_docker_env_file(vars);
    if let Some(parent) = env_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&env_path, body)?;
    Ok(MaterializeOutcome::Written)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MaterializeOutcome {
    Written,
    Removed,
    Absent,
}

/// Lit un `.env` workdir s’il existe.
pub fn read_dotenv_file(workdir: &std::path::Path) -> Result<Option<Vec<EnvVar>>> {
    let env_path = workdir.join(".env");
    if !env_path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&env_path)
        .map_err(|e| DevForgeError::Message(format!("lecture .env: {e}")))?;
    Ok(Some(parse_dotenv(&content)?))
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

    /// Import `.env` : n’écrase une clé projet que si la valeur a vraiment changé.
    pub async fn import_dotenv(
        &self,
        project_uuid: &str,
        content: &str,
        overwrite: bool,
    ) -> Result<Value> {
        let parsed = parse_dotenv(content)?;
        let existing = self.store.list(project_uuid).await?;
        let (to_write, stats) = env_vars_needing_write(&existing, &parsed, overwrite);
        for var in to_write {
            self.store.upsert(project_uuid, var).await?;
        }
        Ok(stats.to_json())
    }

    /// Merge une liste déjà parsée (ex. `.env` workdir) — même règle only-if-changed.
    pub async fn merge_vars(
        &self,
        project_uuid: &str,
        incoming: Vec<EnvVar>,
        overwrite: bool,
    ) -> Result<EnvMergeStats> {
        let existing = self.store.list(project_uuid).await?;
        let (to_write, stats) = env_vars_needing_write(&existing, &incoming, overwrite);
        for var in to_write {
            self.store.upsert(project_uuid, var).await?;
        }
        Ok(stats)
    }

    pub async fn list_raw(&self, project_uuid: &str) -> Result<Vec<EnvVar>> {
        self.store.list(project_uuid).await
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

    #[test]
    fn docker_env_line_no_outer_quotes() {
        let line = format_docker_env_line("KEY", "value");
        assert_eq!(line, "KEY=value\n");
        assert!(!line.contains('"'), "Docker env-file must not wrap value in quotes");
    }

    #[test]
    fn docker_env_line_escapes_special_chars() {
        let line = format_docker_env_line("URL", "libsql://host\nline2");
        assert_eq!(line, "URL=libsql://host\\nline2\n");
        
        let line = format_docker_env_line("PATH", "C:\\Users\\test");
        assert_eq!(line, "PATH=C:\\\\Users\\\\test\n");
    }

    #[test]
    fn docker_env_round_trip_no_literal_quotes() {
        let input = vec![
            ("TURSO_DATABASE_URL".to_string(), "libsql://turso.io/db".to_string()),
            ("API_KEY".to_string(), "secret-key-123".to_string()),
        ];
        let serialized = serialize_docker_env_file(&input);
        
        assert!(!serialized.contains("=\""), "Must not contain =\"");
        assert!(!serialized.contains("\""), "Must not contain any quotes");
        
        assert!(serialized.contains("TURSO_DATABASE_URL=libsql://turso.io/db\n"));
        assert!(serialized.contains("API_KEY=secret-key-123\n"));
    }

    #[test]
    fn docker_env_preserves_embedded_quotes() {
        let line = format_docker_env_line("JSON", r#"{"key":"value"}"#);
        assert_eq!(line, "JSON={\"key\":\"value\"}\n");
        assert!(!line.starts_with("JSON=\""), "Must not wrap in outer quotes");
    }

    #[test]
    fn docker_env_escapes_all_special_chars() {
        let line = format_docker_env_line("MULTI", "line1\nline2\rline3\tline4\\end");
        assert_eq!(line, "MULTI=line1\\nline2\\rline3\\tline4\\\\end\n");
    }

    #[test]
    fn merge_only_writes_changed_values() {
        let existing = vec![
            EnvVar {
                key: "SCW_BUCKET".into(),
                value: "sonozz".into(),
                secret: true,
            },
            EnvVar {
                key: "PORT".into(),
                value: "4321".into(),
                secret: false,
            },
        ];
        let incoming = vec![
            EnvVar {
                key: "SCW_BUCKET".into(),
                value: "starbasefr".into(), // changé
                secret: true,
            },
            EnvVar {
                key: "PORT".into(),
                value: "4321".into(), // identique
                secret: false,
            },
            EnvVar {
                key: "NEW_KEY".into(),
                value: "x".into(),
                secret: true,
            },
        ];
        let (to_write, stats) = env_vars_needing_write(&existing, &incoming, true);
        assert_eq!(stats.updated, 1);
        assert_eq!(stats.unchanged, 1);
        assert_eq!(stats.imported, 1);
        assert_eq!(to_write.len(), 2);
        assert!(to_write.iter().any(|v| v.key == "SCW_BUCKET" && v.value == "starbasefr"));
        assert!(to_write.iter().any(|v| v.key == "NEW_KEY"));
    }

    #[test]
    fn merge_no_overwrite_skips_existing() {
        let existing = vec![EnvVar {
            key: "A".into(),
            value: "1".into(),
            secret: true,
        }];
        let incoming = vec![EnvVar {
            key: "A".into(),
            value: "2".into(),
            secret: true,
        }];
        let (to_write, stats) = env_vars_needing_write(&existing, &incoming, false);
        assert!(to_write.is_empty());
        assert_eq!(stats.skipped, 1);
        assert_eq!(stats.updated, 0);
    }
}
