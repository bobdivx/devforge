use async_trait::async_trait;
use devforge_mcp::McpFacade;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use std::sync::Arc;

/// Alias inventés par le LLM — le workdir n’est PAS un serveur MCP distant.
fn is_workdir_mcp_alias(server_id: &str) -> bool {
    let s = server_id.trim().to_ascii_lowercase();
    matches!(
        s.as_str(),
        "devforge-workdir"
            | "devforge_workdir"
            | "workdir"
            | "local-workdir"
            | "local_workdir"
            | "project-workdir"
            | "project_workdir"
            | "atelier"
            | "local"
    ) || s.contains("workdir")
}

fn workdir_not_mcp_error(server_id: &str) -> Value {
    json!({
        "ok": false,
        "error": format!(
            "« {server_id} » n’est pas un serveur MCP. Continue avec les tools natifs — ne bloque pas. Fichiers : list_project_files / read_project_file / write_project_file. Shell allowlisté : run_workdir_command. Preview : start_local_preview."
        ),
        "hint": "Appelle run_workdir_command ou write_project_file maintenant. Aucune config MCP workdir n’existe.",
        "native_tools": [
            "list_project_files",
            "read_project_file",
            "write_project_file",
            "run_workdir_command",
            "start_local_preview"
        ]
    })
}

pub struct McpListServersTool {
    pub mcp: Arc<McpFacade>,
}

#[async_trait]
impl Tool for McpListServersTool {
    fn name(&self) -> &str {
        "mcp_list_servers"
    }
    fn description(&self) -> &str {
        "Liste les serveurs MCP distants configurés (GitHub, Turso, Slack…). \
         Le workdir projet n’apparaît PAS ici — utilise list_project_files / read_project_file / write_project_file."
    }
    fn parameters(&self) -> Value {
        json!({"type":"object","properties":{}})
    }
    async fn execute(&self, _arguments: Value) -> Result<Value> {
        let servers = self.mcp.clients.list().await;
        Ok(json!({
            "ok": true,
            "servers": servers,
            "note": "Pas de serveur « workdir » : fichiers app = tools natifs list_project_files / read_project_file / write_project_file."
        }))
    }
}

pub struct McpListRemoteToolsTool {
    pub mcp: Arc<McpFacade>,
}

#[async_trait]
impl Tool for McpListRemoteToolsTool {
    fn name(&self) -> &str {
        "mcp_list_remote_tools"
    }
    fn description(&self) -> &str {
        "Liste les tools exposés par un serveur MCP distant (id renvoyé par mcp_list_servers). \
         Ne pas utiliser pour le workdir local."
    }
    fn parameters(&self) -> Value {
        json!({
            "type":"object",
            "properties":{"server_id":{"type":"string"}},
            "required":["server_id"]
        })
    }
    async fn execute(&self, arguments: Value) -> Result<Value> {
        let id = arguments
            .get("server_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if id.is_empty() {
            return Ok(json!({"ok": false, "error": "server_id requis"}));
        }
        if is_workdir_mcp_alias(id) {
            return Ok(workdir_not_mcp_error(id));
        }
        match self.mcp.clients.list_remote_tools(id).await {
            Ok(tools) => Ok(json!({"ok": true, "tools": tools})),
            Err(e) => {
                let err_str = e.to_string();
                if err_str.contains("not found") || err_str.contains("MCP server:") {
                    return Err(devforge_shared::DevForgeError::missing_mcp(id));
                }
                if err_str.contains("auth") || err_str.contains("401") || err_str.contains("403") {
                    return Err(devforge_shared::DevForgeError::mcp_auth_failed(id, &err_str));
                }
                Ok(json!({"ok": false, "error": err_str}))
            }
        }
    }
}

pub struct McpCallTool {
    pub mcp: Arc<McpFacade>,
}

#[async_trait]
impl Tool for McpCallTool {
    fn name(&self) -> &str {
        "mcp_call_tool"
    }
    fn description(&self) -> &str {
        "Appelle un tool sur un serveur MCP distant (GitHub, Turso…). \
         Interdit pour le workdir : utilise write_project_file / read_project_file à la place."
    }
    fn parameters(&self) -> Value {
        json!({
            "type":"object",
            "properties":{
                "server_id":{"type":"string"},
                "tool":{"type":"string"},
                "arguments":{"type":"object"}
            },
            "required":["server_id","tool"]
        })
    }
    async fn execute(&self, arguments: Value) -> Result<Value> {
        let server_id = arguments
            .get("server_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let tool = arguments
            .get("tool")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let args = arguments
            .get("arguments")
            .cloned()
            .unwrap_or_else(|| json!({}));
        if server_id.is_empty() || tool.is_empty() {
            return Ok(json!({"ok": false, "error": "server_id et tool requis"}));
        }
        if is_workdir_mcp_alias(server_id) {
            return Ok(workdir_not_mcp_error(server_id));
        }
        match self
            .mcp
            .clients
            .call_remote_tool(server_id, tool, args)
            .await
        {
            Ok(result) => Ok(json!({"ok": true, "result": result})),
            Err(e) => {
                let err_str = e.to_string();
                if err_str.contains("not found") || err_str.contains("MCP server:") {
                    return Err(devforge_shared::DevForgeError::missing_mcp(server_id));
                }
                if err_str.contains("auth") || err_str.contains("401") || err_str.contains("403") {
                    return Err(devforge_shared::DevForgeError::mcp_auth_failed(
                        server_id, &err_str,
                    ));
                }
                Ok(json!({"ok": false, "error": err_str}))
            }
        }
    }
}
