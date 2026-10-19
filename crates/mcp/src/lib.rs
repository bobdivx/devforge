mod catalog;
mod http_client;
mod oauth;
#[cfg(test)]
mod smoke_test;
mod turso;

pub use catalog::{
    catalog, catalog_as_json, find_preset, CatalogField, CatalogPreset, SetupSection,
};
pub use http_client::HttpMcpRemoteClient;
pub use oauth::{
    build_authorization_url, code_challenge, discover_oauth, exchange_code, generate_code_verifier,
    generate_state, refresh_access_token, OAuthDiscoveryDocument, TokenResponse,
};
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
    /// OAuth 2.1 access token (si authentifié via OAuth plutôt qu'API key)
    #[serde(default)]
    pub oauth_access_token: String,
    /// OAuth refresh token
    #[serde(default)]
    pub oauth_refresh_token: String,
    /// Expiration ISO8601 du access token
    #[serde(default)]
    pub oauth_expires_at: String,
    /// Scopes OAuth accordés
    #[serde(default)]
    pub oauth_scopes: String,
}

impl McpServerConfig {
    /// Agent/API view: never returns secrets, header values, OAuth tokens or
    /// credentials embedded in the URL; only key names, masked placeholders
    /// (`ghp_…abcd` / `***`) and `has_value` flags.
    pub fn public_view(&self) -> Value {
        use devforge_shared::redact;
        let secrets_masked: HashMap<String, String> = self
            .secrets
            .iter()
            .map(|(k, v)| (k.clone(), redact::mask_secret(v)))
            .collect();
        let meta: serde_json::Map<String, Value> = self
            .meta
            .iter()
            .map(|(k, v)| {
                let shown = if redact::is_sensitive_key(k) {
                    redact::mask_secret(v)
                } else {
                    redact::redact_str(v)
                };
                (k.clone(), Value::String(shown))
            })
            .collect();
        let mut secret_keys: Vec<String> = self.secrets.keys().cloned().collect();
        secret_keys.sort();
        let mut header_keys: Vec<String> = self.headers.keys().cloned().collect();
        header_keys.sort();

        json!({
            "id": self.id,
            "name": self.name,
            "url": redact::redact_url(&self.url),
            "enabled": self.enabled,
            "catalog_id": self.catalog_id,
            "meta": meta,
            "workspace_uuid": self.workspace_uuid,
            "has_secrets": !self.secrets.is_empty(),
            "secret_keys": secret_keys,
            "secrets": redact::masked_map(&self.secrets),
            "secrets_masked": secrets_masked,
            "header_keys": header_keys,
            "headers": redact::masked_map(&self.headers),
            "oauth_connected": !self.oauth_access_token.is_empty(),
            "oauth_access_token": { "has_value": !self.oauth_access_token.is_empty() },
            "oauth_refresh_token": { "has_value": !self.oauth_refresh_token.is_empty() },
            "oauth_expires_at": self.oauth_expires_at,
            "oauth_scopes": self.oauth_scopes,
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

    /// Préférer OAuth access token si présent et non expiré
    pub fn best_auth_token(&self) -> Option<String> {
        if !self.oauth_access_token.is_empty() {
            if !self.oauth_expires_at.is_empty() {
                if let Ok(expires) = chrono::DateTime::parse_from_rfc3339(&self.oauth_expires_at) {
                    if expires.timestamp() > chrono::Utc::now().timestamp() + 60 {
                        return Some(self.oauth_access_token.clone());
                    }
                }
            } else {
                return Some(self.oauth_access_token.clone());
            }
        }
        self.api_token().map(str::to_string)
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
        let key = id.trim();
        if key.is_empty() {
            return None;
        }
        {
            let map = self.servers.read().await;
            if let Some(s) = map.get(key) {
                return Some(s.clone());
            }
        }
        // Résolution souple : catalog_id ou nom (ex. « github », « GitHub MCP »)
        let needle = key.to_ascii_lowercase();
        self.list().await.into_iter().find(|s| {
            s.catalog_id
                .as_deref()
                .map(|c| c.eq_ignore_ascii_case(&needle))
                .unwrap_or(false)
                || s.name.eq_ignore_ascii_case(&needle)
                || s.name.to_ascii_lowercase().contains(&needle)
        })
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
        // Préférer OAuth access token si présent
        if let Some(tok) = server.best_auth_token() {
            let bearer = if tok.starts_with("Bearer ") {
                tok
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
                    "{msg}\n→ Le serveur MCP Turso hébergé (mcp.turso.ai) exige une connexion OAuth, pas un Platform API Token.\n→ Le token Platform sert uniquement à lister et lier les bases de données (resources), pas à appeler les tools MCP.\n→ Pour utiliser les tools MCP Turso : utilise l'authentification OAuth (bouton « Se connecter avec OAuth » dans l'UI)."
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

#[cfg(test)]
mod public_view_tests {
    use super::*;

    #[test]
    fn public_view_never_contains_secrets() {
        let tok = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let mut cfg = McpServerConfig {
            id: "mcp_1".into(),
            name: "GitHub".into(),
            url: format!("https://mcp.example.com/sse?token={tok}"),
            enabled: true,
            headers: HashMap::new(),
            catalog_id: Some("github".into()),
            meta: HashMap::new(),
            secrets: HashMap::new(),
            workspace_uuid: "ws".into(),
            oauth_access_token: "oauth-access-abcdefghijklmnop".into(),
            oauth_refresh_token: "oauth-refresh-abcdefghijklmnop".into(),
            oauth_expires_at: "2026-10-19T00:00:00Z".into(),
            oauth_scopes: "repo".into(),
        };
        cfg.headers
            .insert("Authorization".into(), format!("Bearer {tok}"));
        cfg.headers
            .insert("X-Api-Key".into(), "custom-header-secret".into());
        cfg.secrets.insert("api_token".into(), tok.into());
        cfg.meta.insert("org".into(), "acme".into());
        cfg.meta
            .insert("client_secret".into(), "meta-secret-value".into());
        let v = cfg.public_view();
        let s = v.to_string();
        for leaked in [
            tok,
            "custom-header-secret",
            "oauth-access-abcdefghijklmnop",
            "oauth-refresh-abcdefghijklmnop",
            "meta-secret-value",
        ] {
            assert!(!s.contains(leaked), "{leaked} leaked: {s}");
        }
        assert_eq!(v["url"], "https://mcp.example.com/sse?token=***");
        assert_eq!(v["secrets"]["api_token"]["has_value"], true);
        assert_eq!(v["headers"]["X-Api-Key"]["has_value"], true);
        assert_eq!(v["secret_keys"][0], "api_token");
        assert_eq!(v["meta"]["org"], "acme");
        assert_eq!(v["oauth_connected"], true);
        assert_eq!(v["oauth_refresh_token"]["has_value"], true);
    }
}
