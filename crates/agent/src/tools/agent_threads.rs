use async_trait::async_trait;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::sync::Arc;

/// Liste les agents / fils d’un projet.
pub struct ListProjectAgentsTool {
    pub pool: Arc<SqlitePool>,
}

/// Lit les messages d’un fil agent.
pub struct ListAgentMessagesTool {
    pub pool: Arc<SqlitePool>,
}

/// Extrait les appels d’outils en échec d’un fil.
pub struct ListAgentToolFailuresTool {
    pub pool: Arc<SqlitePool>,
}

#[async_trait]
impl Tool for ListProjectAgentsTool {
    fn name(&self) -> &str {
        "list_project_agents"
    }
    fn description(&self) -> &str {
        "Liste les agents / conversations d’un projet DevForge (uuid, name, role, kind, status)."
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_uuid": { "type": "string" }
            },
            "required": ["project_uuid"]
        })
    }
    async fn execute(&self, arguments: Value) -> Result<Value> {
        let project_uuid = arguments
            .get("project_uuid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if project_uuid.is_empty() {
            return Ok(json!({"ok": false, "error": "project_uuid requis"}));
        }
        let rows: Vec<(String, String, String, String, String, String)> = sqlx::query_as(
            r#"SELECT uuid, name, role, kind, status, updated_at
               FROM project_agents WHERE project_uuid = ?
               ORDER BY updated_at DESC, name"#,
        )
        .bind(project_uuid)
        .fetch_all(self.pool.as_ref())
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        let agents: Vec<Value> = rows
            .into_iter()
            .map(|(uuid, name, role, kind, status, updated_at)| {
                json!({
                    "uuid": uuid,
                    "name": name,
                    "role": role,
                    "kind": kind,
                    "status": status,
                    "updated_at": updated_at,
                })
            })
            .collect();

        Ok(json!({
            "ok": true,
            "project_uuid": project_uuid,
            "count": agents.len(),
            "agents": agents,
        }))
    }
}

#[async_trait]
impl Tool for ListAgentMessagesTool {
    fn name(&self) -> &str {
        "list_agent_messages"
    }
    fn description(&self) -> &str {
        "Lit le fil d’une conversation agent (messages user/assistant + tool_calls_json)."
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_uuid": { "type": "string" },
                "agent_uuid": { "type": "string" },
                "limit": { "type": "integer", "description": "défaut 50, max 200" }
            },
            "required": ["project_uuid", "agent_uuid"]
        })
    }
    async fn execute(&self, arguments: Value) -> Result<Value> {
        let project_uuid = arguments
            .get("project_uuid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let agent_uuid = arguments
            .get("agent_uuid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let limit = arguments
            .get("limit")
            .and_then(|v| v.as_i64())
            .unwrap_or(50)
            .clamp(1, 200);
        if project_uuid.is_empty() || agent_uuid.is_empty() {
            return Ok(json!({"ok": false, "error": "project_uuid et agent_uuid requis"}));
        }

        let rows: Vec<(String, String, String, String, String, String)> = sqlx::query_as(
            r#"SELECT uuid, role, content, tool_calls_json, provider, created_at
               FROM agent_messages
               WHERE project_uuid = ? AND agent_uuid = ?
               ORDER BY id ASC
               LIMIT ?"#,
        )
        .bind(project_uuid)
        .bind(agent_uuid)
        .bind(limit)
        .fetch_all(self.pool.as_ref())
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        let messages: Vec<Value> = rows
            .into_iter()
            .map(|(uuid, role, content, tool_calls_json, provider, created_at)| {
                let tools: Value =
                    serde_json::from_str(&tool_calls_json).unwrap_or_else(|_| json!([]));
                json!({
                    "uuid": uuid,
                    "role": role,
                    "content": content,
                    "tool_calls": tools,
                    "provider": provider,
                    "created_at": created_at,
                })
            })
            .collect();

        Ok(json!({
            "ok": true,
            "project_uuid": project_uuid,
            "agent_uuid": agent_uuid,
            "count": messages.len(),
            "messages": messages,
        }))
    }
}

#[async_trait]
impl Tool for ListAgentToolFailuresTool {
    fn name(&self) -> &str {
        "list_agent_tool_failures"
    }
    fn description(&self) -> &str {
        "Liste les appels d’outils en échec (result.ok=false) dans un fil agent — utile pour diagnostiquer MCP inventés, preview 404, etc."
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_uuid": { "type": "string" },
                "agent_uuid": { "type": "string" },
                "limit": { "type": "integer", "description": "messages assistant scannés (défaut 40)" }
            },
            "required": ["project_uuid", "agent_uuid"]
        })
    }
    async fn execute(&self, arguments: Value) -> Result<Value> {
        let project_uuid = arguments
            .get("project_uuid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let agent_uuid = arguments
            .get("agent_uuid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let limit = arguments
            .get("limit")
            .and_then(|v| v.as_i64())
            .unwrap_or(40)
            .clamp(1, 200);
        if project_uuid.is_empty() || agent_uuid.is_empty() {
            return Ok(json!({"ok": false, "error": "project_uuid et agent_uuid requis"}));
        }

        let rows: Vec<(String, String, String)> = sqlx::query_as(
            r#"SELECT uuid, tool_calls_json, created_at
               FROM agent_messages
               WHERE project_uuid = ? AND agent_uuid = ? AND role = 'assistant'
               ORDER BY id DESC
               LIMIT ?"#,
        )
        .bind(project_uuid)
        .bind(agent_uuid)
        .bind(limit)
        .fetch_all(self.pool.as_ref())
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        let mut failures: Vec<Value> = Vec::new();
        for (msg_uuid, tool_calls_json, created_at) in rows {
            let tools: Vec<Value> =
                serde_json::from_str(&tool_calls_json).unwrap_or_default();
            for t in tools {
                let ok = t
                    .get("result")
                    .and_then(|r| r.get("ok"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                if ok {
                    continue;
                }
                failures.push(json!({
                    "message_uuid": msg_uuid,
                    "created_at": created_at,
                    "name": t.get("name"),
                    "arguments": t.get("arguments"),
                    "result": t.get("result"),
                }));
            }
        }

        Ok(json!({
            "ok": true,
            "project_uuid": project_uuid,
            "agent_uuid": agent_uuid,
            "count": failures.len(),
            "failures": failures,
        }))
    }
}
