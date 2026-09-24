use async_trait::async_trait;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::sync::Arc;

/// Liste les agents / fils d’un projet.
pub struct ListProjectAgentsTool {
    pub pool: Arc<PgPool>,
}

/// Lit les messages d’un fil agent.
pub struct ListAgentMessagesTool {
    pub pool: Arc<PgPool>,
}

/// Extrait les appels d’outils en échec d’un fil.
pub struct ListAgentToolFailuresTool {
    pub pool: Arc<PgPool>,
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
        let rows: Vec<(String, String, String, String, Option<String>, String, String)> = sqlx::query_as(
            r#"SELECT uuid, name, role, kind, parent_agent_uuid, status, updated_at
               FROM project_agents WHERE project_uuid = $1
               ORDER BY CASE WHEN role = 'coordinator' THEN 0 ELSE 1 END,
                        updated_at DESC, name"#,
        )
        .bind(project_uuid)
        .fetch_all(self.pool.as_ref())
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        let agents: Vec<Value> = rows
            .into_iter()
            .map(|(uuid, name, role, kind, parent_agent_uuid, status, updated_at)| {
                json!({
                    "uuid": uuid,
                    "name": name,
                    "role": role,
                    "kind": kind,
                    "parent_agent_uuid": parent_agent_uuid,
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
               WHERE project_uuid = $1 AND agent_uuid = $2
               ORDER BY id ASC
               LIMIT $3"#,
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
               WHERE project_uuid = $1 AND agent_uuid = $2 AND role = 'assistant'
               ORDER BY id DESC
               LIMIT $3"#,
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

/// Crée un sous-agent (kind=subagent) rattaché au Coordinateur.
pub struct CreateProjectAgentTool {
    pub pool: Arc<PgPool>,
}

#[async_trait]
impl Tool for CreateProjectAgentTool {
    fn name(&self) -> &str {
        "create_project_agent"
    }
    fn description(&self) -> &str {
        "Crée un sous-agent éphémère (kind=subagent) sous le Coordinateur. \
         Réservé au Coordinateur (ou à un agent dont le parent est Coordinateur). \
         Ne crée jamais kind=required. Args : name, role?, parent_agent_uuid?, initial_message?."
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_uuid": { "type": "string" },
                "name": { "type": "string", "description": "Nom du sous-agent" },
                "role": {
                    "type": "string",
                    "description": "Rôle logique (défaut: worker). Pas coordinator/required."
                },
                "parent_agent_uuid": {
                    "type": "string",
                    "description": "Parent (défaut: appelant si Coordinateur)"
                },
                "initial_message": {
                    "type": "string",
                    "description": "Message utilisateur optionnel à enregistrer pour démarrer le fil"
                },
                "caller_agent_uuid": {
                    "type": "string",
                    "description": "Injecté automatiquement — uuid de l’agent appelant"
                }
            },
            "required": ["project_uuid", "name"]
        })
    }
    async fn execute(&self, arguments: Value) -> Result<Value> {
        let project_uuid = arguments
            .get("project_uuid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let name = arguments
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let role = arguments
            .get("role")
            .and_then(|v| v.as_str())
            .unwrap_or("worker")
            .trim();
        let caller_uuid = arguments
            .get("caller_agent_uuid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let parent_arg = arguments
            .get("parent_agent_uuid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let initial_message = arguments
            .get("initial_message")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();

        if project_uuid.is_empty() || name.is_empty() {
            return Ok(json!({"ok": false, "error": "project_uuid et name requis"}));
        }
        if caller_uuid.is_empty() {
            return Ok(json!({
                "ok": false,
                "error": "caller_agent_uuid manquant — cet outil doit être appelé depuis un fil agent"
            }));
        }
        if role.eq_ignore_ascii_case("coordinator") {
            return Ok(json!({
                "ok": false,
                "error": "impossible de créer un second coordinateur via cet outil"
            }));
        }

        // kind=required est interdit — on force toujours subagent.
        let kind = "subagent";

        let caller: Option<(String, Option<String>)> = sqlx::query_as(
            "SELECT role, parent_agent_uuid FROM project_agents WHERE uuid = $1 AND project_uuid = $2",
        )
        .bind(caller_uuid)
        .bind(project_uuid)
        .fetch_optional(self.pool.as_ref())
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        let Some((caller_role, caller_parent)) = caller else {
            return Ok(json!({"ok": false, "error": "agent appelant introuvable"}));
        };

        let parent_is_coordinator = async {
            let Some(ref p) = caller_parent else {
                return false;
            };
            let row: Option<(String,)> = sqlx::query_as(
                "SELECT role FROM project_agents WHERE uuid = $1 AND project_uuid = $2",
            )
            .bind(p)
            .bind(project_uuid)
            .fetch_optional(self.pool.as_ref())
            .await
            .ok()
            .flatten();
            row.map(|(r,)| r == "coordinator").unwrap_or(false)
        }
        .await;

        let allowed = caller_role == "coordinator" || parent_is_coordinator;
        if !allowed {
            return Ok(json!({
                "ok": false,
                "error": "create_project_agent réservé au Coordinateur (ou à un agent dont le parent est Coordinateur)"
            }));
        }

        let parent_agent_uuid = if !parent_arg.is_empty() {
            parent_arg.to_string()
        } else if caller_role == "coordinator" {
            caller_uuid.to_string()
        } else if let Some(p) = caller_parent.filter(|s| !s.is_empty()) {
            p
        } else {
            return Ok(json!({
                "ok": false,
                "error": "parent_agent_uuid requis (défaut = Coordinateur appelant)"
            }));
        };

        // Vérifier que le parent existe et appartient au projet.
        let parent_ok: Option<(String,)> = sqlx::query_as(
            "SELECT uuid FROM project_agents WHERE uuid = $1 AND project_uuid = $2",
        )
        .bind(&parent_agent_uuid)
        .bind(project_uuid)
        .fetch_optional(self.pool.as_ref())
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;
        if parent_ok.is_none() {
            return Ok(json!({"ok": false, "error": "parent_agent_uuid introuvable sur ce projet"}));
        }

        let agent_uuid = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let name = name.chars().take(80).collect::<String>();
        let role = if role.is_empty() {
            "worker".to_string()
        } else {
            role.chars().take(40).collect::<String>()
        };

        sqlx::query(
            r#"INSERT INTO project_agents (
                uuid, project_uuid, name, role, kind, parent_agent_uuid, status, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, 'idle', $7, $8)"#,
        )
        .bind(&agent_uuid)
        .bind(project_uuid)
        .bind(&name)
        .bind(&role)
        .bind(kind)
        .bind(&parent_agent_uuid)
        .bind(&now)
        .bind(&now)
        .execute(self.pool.as_ref())
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        let mut enqueued = false;
        if !initial_message.is_empty() {
            let msg_uuid = uuid::Uuid::new_v4().to_string();
            let _ = sqlx::query(
                r#"INSERT INTO agent_messages (
                    uuid, project_uuid, agent_uuid, role, content, tool_calls_json, provider, created_at
                ) VALUES ($1, $2, $3, 'user', $4, '[]', '', $5)"#,
            )
            .bind(&msg_uuid)
            .bind(project_uuid)
            .bind(&agent_uuid)
            .bind(initial_message)
            .bind(&now)
            .execute(self.pool.as_ref())
            .await;

            let _ = sqlx::query(
                "UPDATE project_agents SET status = 'working', updated_at = $1 WHERE uuid = $2",
            )
            .bind(&now)
            .bind(&agent_uuid)
            .execute(self.pool.as_ref())
            .await;

            // Enqueue pending — un tour sera repris au boot / par le worker de runs.
            let run_uuid = uuid::Uuid::new_v4().to_string();
            let inserted = sqlx::query(
                r#"INSERT INTO agent_runs (
                    uuid, project_uuid, agent_uuid, message_uuid, status, error, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, 'pending', NULL, $5, $6)
                ON CONFLICT (message_uuid) DO NOTHING"#,
            )
            .bind(&run_uuid)
            .bind(project_uuid)
            .bind(&agent_uuid)
            .bind(&msg_uuid)
            .bind(&now)
            .bind(&now)
            .execute(self.pool.as_ref())
            .await;
            enqueued = inserted.is_ok();
        }

        Ok(json!({
            "ok": true,
            "agent": {
                "uuid": agent_uuid,
                "project_uuid": project_uuid,
                "name": name,
                "role": role,
                "kind": kind,
                "parent_agent_uuid": parent_agent_uuid,
                "status": if enqueued { "working" } else { "idle" },
            },
            "initial_message_enqueued": enqueued,
        }))
    }
}
