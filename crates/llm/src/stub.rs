//! Heuristic stub — no external LLM (CI / laptop sans clé).

use async_trait::async_trait;
use devforge_shared::Result;
use regex::Regex;
use serde_json::json;

use crate::{AssistantTurn, ChatRequest, LlmProvider, Role, ToolCallRequest};

pub struct StubLlmProvider;

#[async_trait]
impl LlmProvider for StubLlmProvider {
    fn name(&self) -> &str {
        "stub"
    }

    async fn chat(&self, req: ChatRequest) -> Result<AssistantTurn> {
        // After tools ran: summarize last tool result.
        if let Some(tool_msg) = req
            .messages
            .iter()
            .rev()
            .find(|m| m.role == Role::Tool)
        {
            let name = tool_msg.name.as_deref().unwrap_or("tool");
            let preview: String = tool_msg.content.chars().take(600).collect();
            return Ok(AssistantTurn {
                content: format!("Résultat `{name}` :\n{preview}"),
                tool_calls: vec![],
                finish_reason: "stop".into(),
            });
        }

        let user = req
            .messages
            .iter()
            .rev()
            .find(|m| m.role == Role::User)
            .map(|m| m.content.as_str())
            .unwrap_or("");

        let context_uuid = req
            .messages
            .iter()
            .filter(|m| m.role == Role::System)
            .find_map(|m| {
                m.content
                    .split("project_uuid=")
                    .nth(1)
                    .map(|s| s.split_whitespace().next().unwrap_or("").to_string())
            })
            .filter(|s| !s.is_empty());

        let tool_names: Vec<&str> = req.tools.iter().map(|t| t.name.as_str()).collect();
        let uuid_re = Regex::new(r"(?i)\b([a-z0-9-]{20,36})\b").unwrap();
        let uuid_in_msg = uuid_re
            .captures(user)
            .map(|c| c.get(1).unwrap().as_str().to_string());
        let uuid = uuid_in_msg.or(context_uuid);

        let tests_re = Regex::new(r"(?i)\btests?\b").unwrap();
        if tests_re.is_match(user) && tool_names.contains(&"run_application_tests") {
            if let Some(uuid) = &uuid {
                return Ok(AssistantTurn {
                    content: String::new(),
                    tool_calls: vec![ToolCallRequest {
                        id: "stub_tests".into(),
                        name: "run_application_tests".into(),
                        arguments: json!({ "project_uuid": uuid }),
                    }],
                    finish_reason: "tool_calls".into(),
                });
            }
        }

        let list_re = Regex::new(r"(?i)\b(list|projets?|projects?)\b").unwrap();
        if list_re.is_match(user) && tool_names.contains(&"list_projects") {
            return Ok(AssistantTurn {
                content: String::new(),
                tool_calls: vec![ToolCallRequest {
                    id: "stub_list".into(),
                    name: "list_projects".into(),
                    arguments: json!({}),
                }],
                finish_reason: "tool_calls".into(),
            });
        }

        let logs_re = Regex::new(r"(?i)\b(logs?|déploi|deploy)\b").unwrap();
        if logs_re.is_match(user) && tool_names.contains(&"get_deployment_logs") {
            if let Some(uuid) = &uuid {
                return Ok(AssistantTurn {
                    content: String::new(),
                    tool_calls: vec![ToolCallRequest {
                        id: "stub_logs".into(),
                        name: "get_deployment_logs".into(),
                        arguments: json!({ "project_uuid": uuid }),
                    }],
                    finish_reason: "tool_calls".into(),
                });
            }
        }

        let smoke_re = Regex::new(r"(?i)\b(smoke|http|ping|santé|health)\b").unwrap();
        if smoke_re.is_match(user) && tool_names.contains(&"http_smoke") {
            return Ok(AssistantTurn {
                content: String::new(),
                tool_calls: vec![ToolCallRequest {
                    id: "stub_smoke".into(),
                    name: "http_smoke".into(),
                    arguments: json!({ "url": "http://127.0.0.1:8000/api/v1/health" }),
                }],
                finish_reason: "tool_calls".into(),
            });
        }

        Ok(AssistantTurn {
            content: format!(
                "[stub LLM] Mode sans LLM actif. Outils disponibles : {}.\nExemples : « liste les projets », « logs », « tests », « smoke ».\n\nConfigure un provider (Ollama, Gemini, OpenAI…) dans Settings → Agents / LLM pour obtenir des réponses intelligentes.",
                tool_names.join(", ")
            ),
            tool_calls: vec![],
            finish_reason: "stop".into(),
        })
    }
}
