use crate::{McpRemoteClient, McpServerConfig, RemoteTool};
use async_trait::async_trait;
use devforge_shared::{DevForgeError, Result};
use serde_json::{json, Value};

/// Client MCP HTTP minimal (JSON-RPC POST). Pas de simulation : erreur claire si KO.
pub struct HttpMcpRemoteClient {
    http: reqwest::Client,
}

impl HttpMcpRemoteClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }

    async fn rpc(&self, server: &McpServerConfig, method: &str, params: Value) -> Result<Value> {
        if server.url.trim().is_empty() {
            return Err(DevForgeError::Message(
                "URL MCP vide — configure l’endpoint du serveur".into(),
            ));
        }
        let body = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params,
        });
        let mut req = self.http.post(&server.url).json(&body);
        for (k, v) in &server.headers {
            req = req.header(k.as_str(), v.as_str());
        }
        let res = req
            .send()
            .await
            .map_err(|e| DevForgeError::Message(format!("MCP HTTP {}: {e}", server.url)))?;
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(DevForgeError::Message(format!(
                "MCP {} → HTTP {status}: {}",
                server.name,
                text.chars().take(240).collect::<String>()
            )));
        }
        let v: Value = serde_json::from_str(&text).map_err(|e| {
            DevForgeError::Message(format!("Réponse MCP invalide: {e}"))
        })?;
        if let Some(err) = v.get("error") {
            return Err(DevForgeError::Message(format!("MCP error: {err}")));
        }
        Ok(v.get("result").cloned().unwrap_or(v))
    }
}

impl Default for HttpMcpRemoteClient {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl McpRemoteClient for HttpMcpRemoteClient {
    async fn list_tools(&self, server: &McpServerConfig) -> Result<Vec<RemoteTool>> {
        let result = self.rpc(server, "tools/list", json!({})).await?;
        let tools = result
            .get("tools")
            .and_then(|t| t.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(tools
            .into_iter()
            .filter_map(|t| {
                let name = t.get("name")?.as_str()?.to_string();
                Some(RemoteTool {
                    name,
                    description: t
                        .get("description")
                        .and_then(|d| d.as_str())
                        .unwrap_or("")
                        .to_string(),
                    parameters: t
                        .get("inputSchema")
                        .cloned()
                        .unwrap_or(json!({ "type": "object" })),
                })
            })
            .collect())
    }

    async fn call_tool(
        &self,
        server: &McpServerConfig,
        tool_name: &str,
        arguments: Value,
    ) -> Result<Value> {
        self.rpc(
            server,
            "tools/call",
            json!({ "name": tool_name, "arguments": arguments }),
        )
        .await
    }
}
