//! LLM providers for DevForge agents (OpenAI-compatible + stub).

use async_trait::async_trait;
use devforge_shared::{DevForgeError, Result, ToolDefinition};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;

mod catalog;
mod errors;
mod health;
mod openai;
mod resilient;
mod stub;

pub use catalog::{catalog, catalog_as_json, find_preset, CatalogField, CatalogPreset};
pub use errors::humanize_llm_error;
pub use health::{probe, ProbeRequest, ProbeResult};
pub use openai::OpenAiCompatibleProvider;
pub use resilient::{ChainEntry, ResilientLlmProvider};
pub use stub::StubLlmProvider;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCallRequest>,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: Role::System,
            content: content.into(),
            name: None,
            tool_call_id: None,
            tool_calls: vec![],
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: Role::User,
            content: content.into(),
            name: None,
            tool_call_id: None,
            tool_calls: vec![],
        }
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self {
            role: Role::Assistant,
            content: content.into(),
            name: None,
            tool_call_id: None,
            tool_calls: vec![],
        }
    }

    pub fn assistant_tools(content: impl Into<String>, tool_calls: Vec<ToolCallRequest>) -> Self {
        Self {
            role: Role::Assistant,
            content: content.into(),
            name: None,
            tool_call_id: None,
            tool_calls,
        }
    }

    pub fn tool_result(tool_call_id: impl Into<String>, name: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: Role::Tool,
            content: content.into(),
            name: Some(name.into()),
            tool_call_id: Some(tool_call_id.into()),
            tool_calls: vec![],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallRequest {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantTurn {
    pub content: String,
    pub tool_calls: Vec<ToolCallRequest>,
    pub finish_reason: String,
}

#[derive(Debug, Clone)]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
    pub tools: Vec<ToolDefinition>,
    pub temperature: f32,
}

#[async_trait]
pub trait LlmProvider: Send + Sync {
    fn name(&self) -> &str;
    async fn chat(&self, req: ChatRequest) -> Result<AssistantTurn>;
}

/// Build provider from env.
/// - `DEVFORGE_LLM_PROVIDER=stub|openai|openrouter|ollama` (default: auto)
/// - auto: openai if `OPENAI_API_KEY` / `DEVFORGE_LLM_API_KEY`, else stub
pub fn provider_from_env() -> (Arc<dyn LlmProvider>, &'static str) {
    let mode = std::env::var("DEVFORGE_LLM_PROVIDER")
        .unwrap_or_else(|_| "auto".into())
        .to_lowercase();
    let key = std::env::var("DEVFORGE_LLM_API_KEY")
        .or_else(|_| std::env::var("OPENAI_API_KEY"))
        .unwrap_or_default();
    let model = std::env::var("DEVFORGE_LLM_MODEL").unwrap_or_else(|_| "gpt-4o-mini".into());
    let base = std::env::var("DEVFORGE_LLM_BASE_URL").ok();
    let (p, m) = provider_from_config(&mode, &key, &model, base.as_deref());
    // Leak static str labels for BackendModes compatibility callers expecting &'static str
    let label: &'static str = match m.as_str() {
        "stub" => "stub",
        "openai" => "openai",
        "openrouter" => "openrouter",
        "ollama" => "ollama",
        "omniroute" => "omniroute",
        _ => "stub",
    };
    (p, label)
}

/// Build provider from explicit config (Settings / DB).
pub fn provider_from_config(
    mode: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
) -> (Arc<dyn LlmProvider>, String) {
    let mode = mode.to_lowercase();
    let key = api_key.trim();
    let model = if model.trim().is_empty() {
        "gpt-4o-mini"
    } else {
        model.trim()
    };

    let custom_base = base_url.filter(|s| !s.trim().is_empty()).map(|s| s.trim());

    match mode.as_str() {
        "stub" => (Arc::new(StubLlmProvider), "stub".into()),
        "openai" => {
            let is_custom = custom_base.is_some_and(|b| !b.contains("api.openai.com"));
            if key.is_empty() && !is_custom {
                tracing::warn!("LLM openai sans clé — stub");
                return (Arc::new(StubLlmProvider), "stub".into());
            }
            let provider = if let Some(base) = custom_base {
                OpenAiCompatibleProvider::new(base, if key.is_empty() { "sk-local" } else { key }, model)
            } else {
                OpenAiCompatibleProvider::openai(key, model)
            };
            (Arc::new(provider), "openai".into())
        }
        "gemini" => {
            if key.is_empty() {
                tracing::warn!("gemini sans clé — stub");
                return (Arc::new(StubLlmProvider), "stub".into());
            }
            let base = custom_base
                .unwrap_or("https://generativelanguage.googleapis.com/v1beta/openai");
            let m = if model == "auto" || model.is_empty() || model == "gpt-4o-mini" {
                "gemini-2.5-flash"
            } else {
                model
            };
            (
                Arc::new(OpenAiCompatibleProvider::new(base, key, m)),
                "gemini".into(),
            )
        }
        "anthropic" => {
            // Tant que pas d’API native : exige un base_url OpenAI-compat (OpenRouter / LiteLLM).
            let base = match custom_base {
                Some(b) if !b.contains("api.anthropic.com") => b,
                _ => {
                    tracing::warn!("anthropic sans proxy OpenAI-compat — stub (utilise OpenRouter)");
                    return (Arc::new(StubLlmProvider), "stub".into());
                }
            };
            if key.is_empty() {
                return (Arc::new(StubLlmProvider), "stub".into());
            }
            let m = if model == "auto" || model.is_empty() {
                "anthropic/claude-sonnet-4"
            } else {
                model
            };
            (
                Arc::new(OpenAiCompatibleProvider::new(base, key, m)),
                "anthropic".into(),
            )
        }
        "openrouter" => {
            if key.is_empty() {
                tracing::warn!("openrouter sans clé — stub");
                return (Arc::new(StubLlmProvider), "stub".into());
            }
            let provider = if let Some(base) = custom_base {
                OpenAiCompatibleProvider::new(base, key, model)
            } else {
                OpenAiCompatibleProvider::openrouter(key, model)
            };
            (Arc::new(provider), "openrouter".into())
        }
        "ollama" => {
            let base = custom_base.unwrap_or("http://127.0.0.1:11434/v1");
            let m = if model == "gpt-4o-mini" || model == "auto" {
                "llama3.2"
            } else {
                model
            };
            (
                Arc::new(OpenAiCompatibleProvider::new(base, key, m)),
                "ollama".into(),
            )
        }
        "omniroute" => {
            let base = custom_base.unwrap_or("http://127.0.0.1:20128/v1");
            let k = if key.is_empty() { "sk-local" } else { key };
            let m = if model.trim().is_empty() || model == "auto" {
                "auto"
            } else {
                model
            };
            (
                Arc::new(OpenAiCompatibleProvider::new(base, k, m)),
                "omniroute".into(),
            )
        }
        _ => {
            // auto
            if let Some(base) = custom_base {
                let k = if key.is_empty() { "sk-local" } else { key };
                let m = if model == "auto" || model.is_empty() {
                    "gpt-4o-mini"
                } else {
                    model
                };
                (
                    Arc::new(OpenAiCompatibleProvider::new(base, k, m)),
                    "openai".into(),
                )
            } else if !key.is_empty() {
                (
                    Arc::new(OpenAiCompatibleProvider::openai(key, model)),
                    "openai".into(),
                )
            } else {
                (Arc::new(StubLlmProvider), "stub".into())
            }
        }
    }
}

pub fn tools_to_openai(tools: &[ToolDefinition]) -> Value {
    Value::Array(
        tools
            .iter()
            .map(|t| {
                json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    }
                })
            })
            .collect(),
    )
}

pub fn err(msg: impl Into<String>) -> DevForgeError {
    DevForgeError::Message(msg.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn omniroute_config_keeps_auto_model() {
        let (provider, mode) = provider_from_config("omniroute", "", "auto", None);
        assert_eq!(mode, "omniroute");
        assert_eq!(provider.name(), "openai-compatible");
    }
}
