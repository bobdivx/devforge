mod catalog;
mod http_client;
mod turso;

pub use catalog::{
    catalog, catalog_as_json, find_preset, CatalogField, CatalogPreset, SetupSection,
};
pub use http_client::HttpMcpRemoteClient;
pub use turso::{create_db_token, libsql_url, list_databases, TursoDatabase};

use async_trait::async_trait;
use devforge_shared::{DevForgeError, Result, ToolDefinition};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

/// A remote MCP server DevForge can call as a client.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    /// Preset catalogue (`turso`, `slack`, …) si applicable.
    #[serde(default)]
    pub catalog_id: Option<String>,
    /// Métadonnées non secrètes (ex. org Turso).
    #[serde(default)]
    pub meta: HashMap<String, String>,
    /// Secrets (api tokens) — ne jamais logger.
    #[serde(default)]
    pub secrets: HashMap<String, String>,
    #[serde(default)]
    pub workspace_uuid: String,
}

impl McpServerConfig {
    pub fn public_view(&self) -> Value {
        // Masquer les valeurs des secrets (critique : ne jamais renvoyer Bearer/tokens en clair)
        let masked_secrets: HashMap<String, String> = self
            .secrets
            .iter()
            .map(|(k, v)| {
                let hint = if v.len() > 8 {
                    format!("{}••••{}", &v[..4], &v[v.len() - 4..])
                } else if v.len() > 4 {
                    format!("{}••••", &v[..2])
                } else {
                    "••••".into()
                };
                (k.clone(), hint)
            })
            .collect();
        
        // Masquer Authorization header (contient souvent Bearer tokens)
        let masked_headers: HashMap<String, String> = self
            .headers
            .iter()
            .map(|(k, v)| {
                if k.to_ascii_lowercase() == "authorization" {
                    (k.clone(), "Bearer ••••".into())
                } else {
                    (k.clone(), v.clone())
                }
            })
            .collect();
        
        json!({
            "id": self.id,
            "name": self.name,
            "url": self.url,
            "enabled": self.enabled,
            "catalog_id": self.catalog_id,
            "meta": self.meta,
            "workspace_uuid": self.workspace_uuid,
            "has_secrets": !self.secrets.is_empty(),
            "secret_keys": self.secrets.keys().cloned().collect::<Vec<_>>(),
            "secrets_masked": masked_secrets,
            "headers": masked_headers,
        })
    }

    pub fn api_token(&self) -> Option<&str> {
        self.secrets
            .get("api_token")
            .or_else(|| self.secrets.get("api_key"))
            .or_else(|| self.secrets.get("access_token"))
            .or_else(|| self.secrets.get("bot_token"))
            .or_else(|| self.secrets.get("token"))
            .or_else(|| self.secrets.get("auth_token"))
            .or_else(|| self.secrets.get("secret_key"))
            .or_else(|| self.secrets.get("integration_token"))
            .map(String::as_str)
    }
}

/// Snapshot of tools exposed by a remote MCP.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteTool {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub parameters: Value,
}

/// Local MCP surface: DevForge tools advertised to external MCP clients.
#[derive(Clone, Default)]
pub struct McpServerFacade {
    tools: Arc<RwLock<Vec<ToolDefinition>>>,
}

impl McpServerFacade {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn set_tools(&self, tools: Vec<ToolDefinition>) {
        *self.tools.write().await = tools;
    }

    pub async fn list_tools(&self) -> Vec<ToolDefinition> {
        self.tools.read().await.clone()
    }

    /// JSON-RPC-ish `tools/list` payload for MCP clients.
    pub async fn tools_list_payload(&self) -> Value {
        let tools = self.list_tools().await;
        json!({
            "tools": tools.into_iter().map(|t| json!({
                "name": t.name,
                "description": t.description,
                "inputSchema": t.parameters
            })).collect::<Vec<_>>()
        })
    }
}

#[async_trait]
pub trait McpRemoteClient: Send + Sync {
    async fn list_tools(&self, server: &McpServerConfig) -> Result<Vec<RemoteTool>>;
    async fn call_tool(
        &self,
        server: &McpServerConfig,
        tool_name: &str,
        arguments: Value,
    ) -> Result<Value>;
}

/// Client MCP distant non configuré — refuse les appels simulés.
pub struct StubMcpRemoteClient;

#[async_trait]
impl McpRemoteClient for StubMcpRemoteClient {
    async fn list_tools(&self, _server: &McpServerConfig) -> Result<Vec<RemoteTool>> {
        Err(DevForgeError::Message(
            "Client MCP distant non configuré — pas de simulation".into(),
        ))
    }

    async fn call_tool(
        &self,
        _server: &McpServerConfig,
        _tool_name: &str,
        _arguments: Value,
    ) -> Result<Value> {
        Err(DevForgeError::Message(
            "Client MCP distant non configuré — pas de simulation".into(),
        ))
    }
}

#[derive(Clone)]
pub struct McpClientRegistry {
    servers: Arc<RwLock<HashMap<String, McpServerConfig>>>,
    client: Arc<dyn McpRemoteClient>,
}

impl McpClientRegistry {
    pub fn new(client: Arc<dyn McpRemoteClient>) -> Self {
        Self {
            servers: Arc::new(RwLock::new(HashMap::new())),
            client,
        }
    }

    pub async fn upsert(&self, mut config: McpServerConfig) -> McpServerConfig {
        if config.id.is_empty() {
            config.id = format!("mcp_{}", &Uuid::new_v4().to_string()[..8]);
        }
        self.servers
            .write()
            .await
            .insert(config.id.clone(), config.clone());
        config
    }

    pub async fn remove(&self, id: &str) -> bool {
        self.servers.write().await.remove(id).is_some()
    }

    pub async fn list(&self) -> Vec<McpServerConfig> {
        let mut v: Vec<_> = self.servers.read().await.values().cloned().collect();
        v.sort_by(|a, b| a.name.cmp(&b.name));
        v
    }

    pub async fn list_for_workspace(&self, workspace_uuid: &str) -> Vec<McpServerConfig> {
        let mut v: Vec<_> = self
            .list()
            .await
            .into_iter()
            .filter(|s| s.workspace_uuid.is_empty() || s.workspace_uuid == workspace_uuid)
            .collect();
        v.sort_by(|a, b| a.name.cmp(&b.name));
        v
    }

    pub async fn get(&self, id: &str) -> Option<McpServerConfig> {
        self.servers.read().await.get(id).cloned()
    }

    pub async fn list_remote_tools(&self, server_id: &str) -> Result<Vec<RemoteTool>> {
        let mut server = self
            .get(server_id)
            .await
            .ok_or_else(|| DevForgeError::NotFound(format!("MCP server: {server_id}")))?;
        if !server.enabled {
            return Err(DevForgeError::Message(format!(
                "MCP server désactivé: {server_id}"
            )));
        }
        // Toujours dériver Authorization du secret (évite un header stale).
        if let Some(tok) = server.api_token() {
            let bearer = if tok.starts_with("Bearer ") {
                tok.to_string()
            } else {
                format!("Bearer {tok}")
            };
            server.headers.insert("Authorization".into(), bearer);
        }
        self.client.list_tools(&server).await.map_err(|e| {
            let msg = e.to_string();
            if server.catalog_id.as_deref() == Some("cloudflare")
                && (msg.contains("insufficient_scope") || msg.contains("403"))
            {
                DevForgeError::Message(format!(
                    "{msg}\n→ Jeton créé depuis Mon profil : ajoute Utilisateur → Détails de l'utilisateur → Lu, puis recrée/reconnecte le jeton.\n→ Ou restreins Ressources du compte à un seul compte (surtout pour cfat_)."
                ))
            } else if server.catalog_id.as_deref() == Some("turso")
                && (msg.contains("401") || msg.contains("could not parse jwt") || msg.contains("unauthorized"))
            {
                DevForgeError::Message(format!(
                    "{msg}\n→ Le serveur MCP Turso hébergé (mcp.turso.ai) exige une connexion OAuth, pas un Platform API Token.\n→ Le token Platform sert uniquement à lister et lier les bases de données (resources), pas à appeler les tools MCP.\n→ Pour utiliser les tools MCP Turso, configure l'authentification OAuth (non supporté actuellement dans DevForge)."
                ))
            } else {
                e
            }
        })
    }

    pub async fn call_remote_tool(
        &self,
        server_id: &str,
        tool_name: &str,
        arguments: Value,
    ) -> Result<Value> {
        let server = self
            .get(server_id)
            .await
            .ok_or_else(|| DevForgeError::NotFound(format!("MCP server: {server_id}")))?;
        if !server.enabled {
            return Err(DevForgeError::Message(format!(
                "MCP server désactivé: {server_id}"
            )));
        }
        self.client.call_tool(&server, tool_name, arguments).await
    }
}

/// Facade combining local MCP server + remote client registry.
#[derive(Clone)]
pub struct McpFacade {
    pub server: McpServerFacade,
    pub clients: McpClientRegistry,
}

impl McpFacade {
    pub fn stub() -> Self {
        Self {
            server: McpServerFacade::new(),
            clients: McpClientRegistry::new(Arc::new(StubMcpRemoteClient)),
        }
    }

    pub fn with_http_client() -> Self {
        Self {
            server: McpServerFacade::new(),
            clients: McpClientRegistry::new(Arc::new(HttpMcpRemoteClient::new())),
        }
    }
}
