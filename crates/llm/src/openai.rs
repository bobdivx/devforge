use async_trait::async_trait;
use devforge_shared::Result;
use serde_json::json;

use crate::{
    err, tools_to_openai, AssistantTurn, ChatMessage, ChatRequest, LlmProvider, Role,
    ToolCallRequest,
};

/// OpenAI Chat Completions compatible (OpenAI, OpenRouter, Ollama `/v1`).
pub struct OpenAiCompatibleProvider {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    client: reqwest::Client,
}

impl OpenAiCompatibleProvider {
    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            api_key: api_key.into(),
            model: model.into(),
            client: reqwest::Client::new(),
        }
    }

    pub fn openai(api_key: impl Into<String>, model: impl Into<String>) -> Self {
        Self::new("https://api.openai.com/v1", api_key, model)
    }

    pub fn openrouter(api_key: impl Into<String>, model: impl Into<String>) -> Self {
        Self::new("https://openrouter.ai/api/v1", api_key, model)
    }

    /// Default base URL for a known provider (OpenAI-compatible chat).
    pub fn default_base_url(provider: &str) -> Option<&'static str> {
        match provider.trim().to_lowercase().as_str() {
            "openai" | "auto" => Some("https://api.openai.com/v1"),
            "openrouter" => Some("https://openrouter.ai/api/v1"),
            "gemini" => Some("https://generativelanguage.googleapis.com/v1beta/openai"),
            // Chat = /v1 ; listing Ollama = root + /api/tags (voir list_models_for_provider).
            "ollama" => Some("http://127.0.0.1:11434/v1"),
            _ => None,
        }
    }

    /// List models for a provider — logique reprise de l’ancien `LlmModelCatalog`.
    pub async fn list_models_for_provider(
        provider: &str,
        base_url: &str,
        api_key: &str,
    ) -> Result<Vec<String>> {
        let provider = provider.trim().to_lowercase();
        if provider == "ollama" {
            return Self::list_ollama_models(base_url).await;
        }
        if provider == "auto" {
            // Proxy / LiteLLM / Ollama distant : tenter OpenAI-compat puis /api/tags.
            match Self::list_openai_compatible_models("auto", base_url, api_key).await {
                Ok(ids) if !ids.is_empty() => return Ok(ids),
                Ok(_) | Err(_) => {
                    if let Ok(ids) = Self::list_ollama_models(base_url).await {
                        if !ids.is_empty() {
                            return Ok(ids);
                        }
                    }
                }
            }
            return Self::list_openai_compatible_models("auto", base_url, api_key).await;
        }
        Self::list_openai_compatible_models(&provider, base_url, api_key).await
    }

    /// Ollama natif : `GET {root}/api/tags` (pas `/v1/models`).
    async fn list_ollama_models(base_url: &str) -> Result<Vec<String>> {
        let root = Self::ollama_root(base_url);
        if root.is_empty() {
            return Err(err("URL Ollama requise (ex. http://127.0.0.1:11434)"));
        }
        let client = reqwest::Client::new();
        let res = client
            .get(format!("{root}/api/tags"))
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await
            .map_err(|e| err(format!("Impossible de joindre Ollama : {e}")))?;
        let status = res.status();
        let body = res.text().await.map_err(|e| err(format!("ollama body: {e}")))?;
        if !status.is_success() {
            return Err(err(format!("Ollama /api/tags HTTP {status}: {body}")));
        }
        let parsed: serde_json::Value =
            serde_json::from_str(&body).map_err(|e| err(format!("ollama json: {e}")))?;
        let mut ids: Vec<String> = parsed
            .get("models")
            .and_then(|m| m.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| {
                        m.get("name")
                            .or_else(|| m.get("model"))
                            .and_then(|v| v.as_str())
                            .map(str::to_string)
                    })
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        ids.sort();
        ids.dedup();
        Ok(ids)
    }

    fn ollama_root(base_url: &str) -> String {
        let clean = base_url.trim().trim_end_matches('/');
        if clean.is_empty() {
            return "http://127.0.0.1:11434".into();
        }
        // Accepte http://host:11434/v1 → root pour /api/tags
        if let Some(stripped) = clean.strip_suffix("/v1") {
            return stripped.to_string();
        }
        clean.to_string()
    }

    /// OpenAI / OpenRouter / proxies : essaie `/models` et `/v1/models`.
    async fn list_openai_compatible_models(
        provider: &str,
        base_url: &str,
        api_key: &str,
    ) -> Result<Vec<String>> {
        let base = base_url.trim().trim_end_matches('/');
        if base.is_empty() {
            return Err(err("base_url requis pour lister les modèles"));
        }
        let key = {
            let k = api_key.trim();
            if k.is_empty() {
                "sk-local-devforge"
            } else {
                k
            }
        };
        let client = reqwest::Client::new();
        let mut last_err = String::from("aucune réponse");
        for url in Self::openai_model_urls(base) {
            let mut req = client
                .get(&url)
                .header("Accept", "application/json")
                .bearer_auth(key)
                .timeout(std::time::Duration::from_secs(20));
            if provider == "openrouter" {
                req = req
                    .header("HTTP-Referer", "https://github.com/bobdivx/devforge")
                    .header("X-Title", "DevForge");
            }
            match req.send().await {
                Ok(res) => {
                    let status = res.status();
                    let body = res.text().await.unwrap_or_default();
                    if !status.is_success() {
                        last_err = format!("HTTP {status} on {url}: {body}");
                        continue;
                    }
                    match Self::parse_openai_models_json(&body) {
                        Ok(ids) if !ids.is_empty() => return Ok(ids),
                        Ok(_) => {
                            last_err = format!("liste vide sur {url}");
                        }
                        Err(e) => last_err = format!("{url}: {e}"),
                    }
                }
                Err(e) => last_err = format!("{url}: {e}"),
            }
        }
        Err(err(format!("Impossible de récupérer les modèles {provider} : {last_err}")))
    }

    fn openai_model_urls(base: &str) -> Vec<String> {
        let clean = base.trim_end_matches('/');
        let mut urls = Vec::new();
        if clean.ends_with("/v1") {
            urls.push(format!("{clean}/models"));
            let parent = clean.trim_end_matches("/v1");
            if !parent.is_empty() {
                urls.push(format!("{parent}/models"));
            }
        } else {
            urls.push(format!("{clean}/models"));
            urls.push(format!("{clean}/v1/models"));
        }
        urls
    }

    fn parse_openai_models_json(body: &str) -> Result<Vec<String>> {
        let parsed: serde_json::Value =
            serde_json::from_str(body).map_err(|e| err(format!("models json: {e}")))?;
        let raw = if let Some(arr) = parsed.get("data").and_then(|d| d.as_array()) {
            arr.clone()
        } else if let Some(arr) = parsed.get("models").and_then(|m| m.as_array()) {
            arr.clone()
        } else if let Some(arr) = parsed.as_array() {
            arr.clone()
        } else {
            vec![]
        };
        let mut ids: Vec<String> = raw
            .iter()
            .filter_map(|m| {
                if let Some(s) = m.as_str() {
                    let t = s.trim();
                    return (!t.is_empty()).then(|| t.to_string());
                }
                m.get("id")
                    .or_else(|| m.get("name"))
                    .or_else(|| m.get("model"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
            })
            .collect();
        ids.sort();
        ids.dedup();
        Ok(ids)
    }

    #[deprecated(note = "préférer list_models_for_provider")]
    pub async fn list_models(base_url: &str, api_key: &str) -> Result<Vec<String>> {
        Self::list_openai_compatible_models("openai", base_url, api_key).await
    }

    fn map_messages(messages: &[ChatMessage]) -> Vec<serde_json::Value> {
        messages
            .iter()
            .map(|m| {
                let role = match m.role {
                    Role::System => "system",
                    Role::User => "user",
                    Role::Assistant => "assistant",
                    Role::Tool => "tool",
                };
                let mut obj = json!({
                    "role": role,
                    "content": m.content,
                });
                if let Some(id) = &m.tool_call_id {
                    obj["tool_call_id"] = json!(id);
                }
                if let Some(name) = &m.name {
                    obj["name"] = json!(name);
                }
                if !m.tool_calls.is_empty() {
                    obj["tool_calls"] = json!(m
                        .tool_calls
                        .iter()
                        .map(|t| {
                            json!({
                                "id": t.id,
                                "type": "function",
                                "function": {
                                    "name": t.name,
                                    "arguments": serde_json::to_string(&t.arguments).unwrap_or_else(|_| "{}".into()),
                                }
                            })
                        })
                        .collect::<Vec<_>>());
                }
                obj
            })
            .collect()
    }
}

#[async_trait]
impl LlmProvider for OpenAiCompatibleProvider {
    fn name(&self) -> &str {
        "openai-compatible"
    }

    async fn chat(&self, req: ChatRequest) -> Result<AssistantTurn> {
        let mut body = json!({
            "model": self.model,
            "messages": Self::map_messages(&req.messages),
            "temperature": req.temperature,
        });
        if !req.tools.is_empty() {
            body["tools"] = tools_to_openai(&req.tools);
            body["tool_choice"] = json!("auto");
        }

        let mut builder = self
            .client
            .post(format!("{}/chat/completions", self.base_url))
            .header("Content-Type", "application/json")
            .json(&body);
        if !self.api_key.is_empty() {
            builder = builder.bearer_auth(&self.api_key);
        }

        let res = builder
            .send()
            .await
            .map_err(|e| err(format!("LLM HTTP: {e}")))?;
        let status = res.status();
        let text = res
            .text()
            .await
            .map_err(|e| err(format!("LLM body: {e}")))?;
        if !status.is_success() {
            return Err(err(format!("LLM {status}: {}", text.chars().take(800).collect::<String>())));
        }
        let data: serde_json::Value =
            serde_json::from_str(&text).map_err(|e| err(format!("LLM JSON: {e}")))?;

        let choice = data
            .pointer("/choices/0")
            .cloned()
            .unwrap_or(json!({}));
        let message = choice.get("message").cloned().unwrap_or(json!({}));
        let content = message
            .get("content")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();
        let finish = choice
            .get("finish_reason")
            .and_then(|f| f.as_str())
            .unwrap_or("stop")
            .to_string();

        let mut tool_calls = Vec::new();
        if let Some(arr) = message.get("tool_calls").and_then(|t| t.as_array()) {
            for (i, tc) in arr.iter().enumerate() {
                let id = tc
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&format!("call_{i}"))
                    .to_string();
                let name = tc
                    .pointer("/function/name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let args_raw = tc
                    .pointer("/function/arguments")
                    .and_then(|v| v.as_str())
                    .unwrap_or("{}");
                let arguments = serde_json::from_str(args_raw).unwrap_or_else(|_| json!({}));
                if !name.is_empty() {
                    tool_calls.push(ToolCallRequest {
                        id,
                        name,
                        arguments,
                    });
                }
            }
        }

        Ok(AssistantTurn {
            content,
            tool_calls,
            finish_reason: finish,
        })
    }
}

impl OpenAiCompatibleProvider {
    /// Smoke test : chat réel (via module health) — listing seul ne suffit pas.
    pub async fn test_connection(
        provider: &str,
        base_url: &str,
        api_key: &str,
        model: &str,
    ) -> Result<String> {
        let result = crate::health::probe(&crate::health::ProbeRequest {
            provider: provider.to_string(),
            base_url: base_url.to_string(),
            api_key: api_key.to_string(),
            model: model.to_string(),
        })
        .await;
        if result.ok {
            Ok(result.message)
        } else {
            Err(err(result
                .error
                .unwrap_or_else(|| "probe failed".into())))
        }
    }

    /// Résout `auto` / vide vers un modèle réellement disponible (surtout Ollama).
    pub async fn resolve_model(
        provider: &str,
        base_url: &str,
        api_key: &str,
        model: &str,
    ) -> String {
        let trimmed = model.trim();
        if !trimmed.is_empty() && trimmed != "auto" && trimmed != "gpt-4o-mini" {
            return trimmed.to_string();
        }
        // gpt-4o-mini as placeholder for non-openai providers → treat as auto
        let treat_as_auto = trimmed.is_empty()
            || trimmed == "auto"
            || (provider != "openai" && trimmed == "gpt-4o-mini");

        if !treat_as_auto {
            return trimmed.to_string();
        }

        if provider == "ollama" || provider == "custom" {
            if let Ok(models) =
                Self::list_models_for_provider(provider, base_url, api_key).await
            {
                if let Some(pick) = Self::pick_preferred_ollama_model(&models) {
                    tracing::info!(model = %pick, "Ollama auto → modèle détecté");
                    return pick;
                }
            }
        }

        match provider {
            "ollama" => "llama3.2".into(),
            "gemini" => "gemini-2.5-flash".into(),
            "openrouter" => "openai/gpt-4o-mini".into(),
            "anthropic" => "anthropic/claude-sonnet-4".into(),
            _ => {
                if trimmed.is_empty() || trimmed == "auto" {
                    "gpt-4o-mini".into()
                } else {
                    trimmed.to_string()
                }
            }
        }
    }

    /// Préfère un modèle léger (7b/8b/3b) s’il est listé, sinon le premier.
    fn pick_preferred_ollama_model(models: &[String]) -> Option<String> {
        if models.is_empty() {
            return None;
        }
        let prefer = [":3b", ":1b", ":7b", ":8b", "mini", "small"];
        for needle in prefer {
            if let Some(m) = models.iter().find(|m| m.to_lowercase().contains(needle)) {
                return Some(m.clone());
            }
        }
        Some(models[0].clone())
    }
}
