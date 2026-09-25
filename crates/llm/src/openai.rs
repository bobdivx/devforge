use async_trait::async_trait;
use devforge_shared::Result;
use serde_json::json;

use crate::{
    err, tools_to_openai, AssistantTurn, ChatMessage, ChatRequest, LlmProvider, Role,
    ToolCallRequest,
};

// Import uuid pour générer des IDs uniques
extern crate uuid;

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
            "omniroute" => Some("http://127.0.0.1:20128/v1"),
            "xai" => Some(crate::catalog::XAI_BASE_URL),
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
        if provider == "omniroute" {
            return Self::list_openai_compatible_models("openai", base_url, api_key).await;
        }
        if provider == "xai" {
            let key = crate::catalog::xai_api_key(api_key);
            if key.is_empty() {
                return Err(err("Clé API xAI requise (champ ou variable XAI_API_KEY)"));
            }
            let base = if base_url.trim().is_empty() {
                crate::catalog::XAI_BASE_URL
            } else {
                base_url
            };
            let mut ids = Self::list_openai_compatible_models("xai", base, &key).await?;
            // Chat/agents uniquement : écarte image, vidéo, voix.
            ids.retain(|m| {
                let l = m.to_lowercase();
                !(l.contains("imagine") || l.contains("image") || l.contains("video") || l.contains("voice") || l.contains("tts"))
            });
            return Ok(ids);
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
            } else if provider == "gemini" || url.contains("generativelanguage.googleapis.com") {
                req = req.header("x-goog-api-key", key);
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
                let val = if let Some(s) = m.as_str() {
                    s.trim()
                } else {
                    m.get("id")
                        .or_else(|| m.get("name"))
                        .or_else(|| m.get("model"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.trim())
                        .unwrap_or("")
                };
                if val.is_empty() {
                    return None;
                }
                // Nettoyer prefixe 'models/' retourné par certaines versions de l'API Google
                let clean = val.strip_prefix("models/").unwrap_or(val);
                Some(clean.to_string())
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
            if self.base_url.contains("generativelanguage.googleapis.com") {
                builder = builder.header("x-goog-api-key", &self.api_key);
            }
        }

        // Modèles de raisonnement xAI : réponses plus longues à venir (agents en tâche de fond).
        let timeout_secs = if self.base_url.contains("api.x.ai") { 240 } else { 90 };
        let res = builder
            .timeout(std::time::Duration::from_secs(timeout_secs))
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

        let turn = AssistantTurn {
            content: content.clone(),
            tool_calls: tool_calls.clone(),
            finish_reason: finish.clone(),
        };

        // Fallback : certains LLM (ex: Ollama qwen2.5-coder) retournent les tool calls
        // comme JSON brut dans content au lieu de tool_calls structurés.
        if tool_calls.is_empty() && !content.trim().is_empty() {
            if let Some(parsed_calls) = parse_tool_calls_from_text(&content) {
                if !parsed_calls.is_empty() {
                    tracing::info!(
                        count = parsed_calls.len(),
                        "tool calls parsés depuis le texte de réponse (LLM qui ne supporte pas tool_calls structurés)"
                    );
                    return Ok(AssistantTurn {
                        content: String::new(),
                        tool_calls: parsed_calls,
                        finish_reason: finish,
                    });
                }
            }
        }

        Ok(turn)
    }
}

/// Parse tool calls depuis du JSON textuel dans la réponse (fallback pour Ollama / LLM simples).
/// Formats supportés :
/// 1. `{"name":"tool_name","arguments":{...}}` (simple)
/// 2. `{"tool_calls":[{"id":"...","type":"function","function":{"name":"...","arguments":"..."}}]}` (OpenAI-style)
/// 3. Array direct `[{"name":"...","arguments":{...}}]`
/// 4. Lignes numérotées : `1. tool_name {...}` / `2) tool_name {...}` / `- tool_name {...}`
/// 5. Lignes simples : `tool_name {...}` où tool_name matche `[a-z][a-z0-9_]*`
/// 6. Blocs markdown : ` ```json ... ``` ` / ` ```JSON ... ``` ` / ` ``` ... ``` `
fn parse_tool_calls_from_text(content: &str) -> Option<Vec<ToolCallRequest>> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Étape 1 : Retirer les fences markdown optionnels (```json / ```JSON / ```)
    let content_stripped = strip_markdown_fences(trimmed);
    let trimmed = content_stripped.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Tentative formats JSON complets d'abord
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        if let Some(calls) = try_parse_json_formats(trimmed) {
            return Some(calls);
        }
    }

    // Tentative formats ligne par ligne (Ollama Qwen)
    if let Some(calls) = try_parse_line_formats(trimmed) {
        return Some(calls);
    }

    None
}

/// Retire les fences markdown (```json / ```JSON / ```) au début et à la fin du contenu
fn strip_markdown_fences(content: &str) -> String {
    let trimmed = content.trim();
    
    // Vérifier si ça commence par ``` (avec ou sans json/JSON)
    if let Some(rest) = trimmed.strip_prefix("```") {
        // Retirer le language tag optionnel (json, JSON, etc.)
        let after_opening = rest.trim_start();
        let after_lang = if after_opening.to_lowercase().starts_with("json") {
            after_opening[4..].trim_start()
        } else {
            after_opening
        };
        
        // Retirer le ``` de fermeture à la fin
        if let Some(without_closing) = after_lang.trim_end().strip_suffix("```") {
            return without_closing.trim().to_string();
        }
        
        // Pas de fence de fermeture, retourner tel quel après le tag d'ouverture
        return after_lang.trim().to_string();
    }
    
    // Pas de fence markdown, retourner tel quel
    trimmed.to_string()
}

/// Tente de parser les formats JSON complets (objet simple, OpenAI-style, array)
fn try_parse_json_formats(trimmed: &str) -> Option<Vec<ToolCallRequest>> {
    let obj = serde_json::from_str::<serde_json::Value>(trimmed).ok()?;

    // Format simple : {"name":"...", "arguments":{...}}
    if let (Some(name), Some(args)) = (
        obj.get("name").and_then(|n| n.as_str()),
        obj.get("arguments"),
    ) {
        if !name.is_empty() {
            return Some(vec![ToolCallRequest {
                id: format!("call_{}", uuid::Uuid::new_v4()),
                name: name.to_string(),
                arguments: strip_placeholder_values(args.clone()),
            }]);
        }
    }

    // Format OpenAI-style : {"tool_calls":[...]}
    if let Some(arr) = obj.get("tool_calls").and_then(|t| t.as_array()) {
        let mut calls = Vec::new();
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
            let arguments = serde_json::from_str(args_raw)
                .map(strip_placeholder_values)
                .unwrap_or_else(|_| json!({}));
            if !name.is_empty() {
                calls.push(ToolCallRequest {
                    id,
                    name,
                    arguments,
                });
            }
        }
        if !calls.is_empty() {
            return Some(calls);
        }
    }

    // Format array direct : [{"name":"...","arguments":{...}},...]
    if let Some(arr) = obj.as_array() {
        let mut calls = Vec::new();
        for (i, item) in arr.iter().enumerate() {
            if let (Some(name), Some(args)) = (
                item.get("name").and_then(|n| n.as_str()),
                item.get("arguments"),
            ) {
                if !name.is_empty() {
                    calls.push(ToolCallRequest {
                        id: format!("call_{i}"),
                        name: name.to_string(),
                        arguments: strip_placeholder_values(args.clone()),
                    });
                }
            }
        }
        if !calls.is_empty() {
            return Some(calls);
        }
    }

    None
}

/// Tente de parser les formats ligne par ligne (Ollama Qwen, etc.)
/// Formats : `1. tool_name {...}` / `2) tool_name {...}` / `- tool_name {...}` / `tool_name {...}`
fn try_parse_line_formats(content: &str) -> Option<Vec<ToolCallRequest>> {
    use regex::Regex;
    
    // Pattern pour capturer une ligne complète : préfixe + nom + JSON
    // Le JSON doit commencer immédiatement après le nom (avec seulement des espaces)
    lazy_static::lazy_static! {
        static ref LINE_PATTERN: Regex = Regex::new(
            r"(?m)^\s*(?:\d+[.)]\s*|-\s*)?([a-z][a-z0-9_]*)\s+(\{)"
        ).unwrap();
    }

    let mut calls = Vec::new();
    
    for caps in LINE_PATTERN.captures_iter(content) {
        let full_match = caps.get(0).unwrap();
        let name = caps.get(1).unwrap().as_str();
        let json_start_offset = full_match.end() - 1; // -1 pour inclure le '{'
        
        // Extraire le JSON depuis le '{' jusqu'à la fermeture
        let remaining = &content[json_start_offset..];
        
        if let Some(json_str) = extract_json_object(remaining) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
                calls.push(ToolCallRequest {
                    id: format!("call_{}", uuid::Uuid::new_v4()),
                    name: name.to_string(),
                    arguments: strip_placeholder_values(val),
                });
            }
        }
    }
    
    if calls.is_empty() {
        None
    } else {
        Some(calls)
    }
}

/// Extrait un objet JSON complet depuis le début d'une chaîne (qui doit commencer par '{')
/// Retourne la sous-chaîne JSON complète avec les accolades équilibrées
fn extract_json_object(s: &str) -> Option<&str> {
    let chars: Vec<char> = s.chars().collect();
    if chars.is_empty() || chars[0] != '{' {
        return None;
    }
    
    let mut depth = 0;
    let mut in_string = false;
    let mut escape_next = false;
    
    for (i, &ch) in chars.iter().enumerate() {
        if escape_next {
            escape_next = false;
            continue;
        }
        
        match ch {
            '\\' if in_string => escape_next = true,
            '"' => in_string = !in_string,
            '{' if !in_string => depth += 1,
            '}' if !in_string => {
                depth -= 1;
                if depth == 0 {
                    // Trouvé la fin de l'objet JSON
                    return Some(&s[..=i]);
                }
            }
            _ => {}
        }
    }
    
    None
}

/// Remplace les placeholders angle-bracket comme "<project_uuid>" par des chaînes vides
/// ou les supprime du JSON. Le serveur injectera les valeurs réelles via inject_tool_defaults.
fn strip_placeholder_values(mut value: serde_json::Value) -> serde_json::Value {
    match &mut value {
        serde_json::Value::Object(map) => {
            let keys_to_remove: Vec<String> = map
                .iter()
                .filter_map(|(k, v)| {
                    if let Some(s) = v.as_str() {
                        if s.starts_with('<') && s.ends_with('>') {
                            return Some(k.clone());
                        }
                    }
                    None
                })
                .collect();
            
            for key in keys_to_remove {
                map.remove(&key);
            }
            
            // Récursion dans les valeurs restantes
            for v in map.values_mut() {
                *v = strip_placeholder_values(v.clone());
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr.iter_mut() {
                *item = strip_placeholder_values(item.clone());
            }
        }
        _ => {}
    }
    value
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
        // OmniRoute expose « auto » comme routeur. Ne pas le réécrire en gpt-4o-mini.
        if provider == "omniroute" {
            if trimmed.is_empty() || trimmed == "auto" {
                return "auto".into();
            }
            return trimmed.to_string();
        }
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

        // Try to list and pick a working model for specific providers
        if provider == "gemini" {
            if let Ok(models) =
                Self::list_models_for_provider(provider, base_url, api_key).await
            {
                if let Some(pick) = Self::pick_preferred_gemini_model(&models) {
                    tracing::info!(model = %pick, "Gemini auto → modèle chat détecté");
                    return pick;
                }
            }
        }

        match provider {
            "ollama" => "llama3.2".into(),
            "gemini" => "gemini-2.5-flash".into(),
            "openrouter" => "openai/gpt-4o-mini".into(),
            "xai" => crate::catalog::XAI_DEFAULT_MODEL.into(),
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


    /// Préfère un modèle léger (7b/8b/3b) s'il est listé, sinon le premier.
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

    /// Préfère un modèle Gemini chat-compatible, évite les modèles Interactions-only.
    /// Filtre : exclut les modèles avec `-exp-`, `-preview-`, `antigravity`, ou patterns non-chat.
    /// Préfère : `flash`, `pro`, versions stables comme `gemini-2.5-flash` ou `gemini-2.0-flash`.
    fn pick_preferred_gemini_model(models: &[String]) -> Option<String> {
        if models.is_empty() {
            return None;
        }

        // Filter out known bad patterns (Interactions-only, experimental, preview)
        let bad_patterns = [
            "-exp-",
            "-preview-",
            "antigravity",
            "interactions",
            "experimental",
        ];
        
        let candidates: Vec<String> = models
            .iter()
            .filter(|m| {
                let lower = m.to_lowercase();
                // Reject if contains bad patterns
                if bad_patterns.iter().any(|p| lower.contains(p)) {
                    return false;
                }
                // Accept if looks like a chat model
                lower.contains("gemini") || lower.contains("flash") || lower.contains("pro")
            })
            .cloned()
            .collect();

        if candidates.is_empty() {
            return None;
        }

        // Prefer known-good stable models first
        let preferred = [
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-1.5-flash",
            "gemini-2.5-pro",
            "gemini-2.0-pro",
            "gemini-1.5-pro",
        ];

        for pref in preferred {
            if let Some(m) = candidates.iter().find(|m| {
                m.to_lowercase() == pref || m.to_lowercase() == format!("models/{}", pref)
            }) {
                return Some(m.clone());
            }
        }

        // Prefer flash over pro (faster, cheaper)
        if let Some(m) = candidates.iter().find(|m| m.to_lowercase().contains("flash")) {
            return Some(m.clone());
        }

        if let Some(m) = candidates.iter().find(|m| m.to_lowercase().contains("pro")) {
            return Some(m.clone());
        }

        // Fallback to first candidate
        candidates.into_iter().next()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn omniroute_auto_is_not_rewritten() {
        let auto = OpenAiCompatibleProvider::resolve_model(
            "omniroute",
            "http://127.0.0.1:20128/v1",
            "",
            "auto",
        )
        .await;
        assert_eq!(auto, "auto");
        let named = OpenAiCompatibleProvider::resolve_model(
            "omniroute",
            "http://127.0.0.1:20128/v1",
            "",
            "claude-sonnet",
        )
        .await;
        assert_eq!(named, "claude-sonnet");
    }

    // Expose strip_markdown_fences pour les tests
    use super::strip_markdown_fences;

    #[test]
    fn test_parse_tool_calls_from_text_simple_format() {
        let text = r#"{"name":"list_projects","arguments":{}}"#;
        let calls = parse_tool_calls_from_text(text);
        assert!(calls.is_some());
        let calls = calls.unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "list_projects");
        assert!(calls[0].arguments.is_object());
    }

    #[test]
    fn test_parse_tool_calls_from_text_openai_style() {
        let text = r#"{"tool_calls":[{"id":"call_123","type":"function","function":{"name":"get_project","arguments":"{\"project_uuid\":\"abc\"}"}}]}"#;
        let calls = parse_tool_calls_from_text(text);
        assert!(calls.is_some());
        let calls = calls.unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "get_project");
        assert_eq!(calls[0].id, "call_123");
    }

    #[test]
    fn test_parse_tool_calls_from_text_array_format() {
        let text = r#"[{"name":"tool1","arguments":{"a":1}},{"name":"tool2","arguments":{"b":2}}]"#;
        let calls = parse_tool_calls_from_text(text);
        assert!(calls.is_some());
        let calls = calls.unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, "tool1");
        assert_eq!(calls[1].name, "tool2");
    }

    #[test]
    fn test_parse_tool_calls_from_text_not_json() {
        let text = "This is just plain text, not JSON";
        let calls = parse_tool_calls_from_text(text);
        assert!(calls.is_none());
    }

    #[test]
    fn test_parse_tool_calls_from_text_empty() {
        let calls = parse_tool_calls_from_text("");
        assert!(calls.is_none());
    }

    #[test]
    fn test_parse_tool_calls_from_text_invalid_json() {
        let text = r#"{"name":"tool","arguments":{invalid}}"#;
        let calls = parse_tool_calls_from_text(text);
        assert!(calls.is_none());
    }

    #[test]
    fn test_pick_preferred_gemini_model_filters_antigravity() {
        let models = vec![
            "models/antigravity-preview-05-2026".to_string(),
            "models/gemini-2.5-flash".to_string(),
        ];
        let picked = OpenAiCompatibleProvider::pick_preferred_gemini_model(&models);
        assert_eq!(picked, Some("models/gemini-2.5-flash".to_string()));
    }

    #[test]
    fn test_pick_preferred_gemini_model_filters_experimental() {
        let models = vec![
            "models/gemini-exp-1234".to_string(),
            "models/gemini-2.5-pro".to_string(),
        ];
        let picked = OpenAiCompatibleProvider::pick_preferred_gemini_model(&models);
        assert_eq!(picked, Some("models/gemini-2.5-pro".to_string()));
    }

    #[test]
    fn test_pick_preferred_gemini_model_prefers_flash() {
        let models = vec![
            "models/gemini-2.5-pro".to_string(),
            "models/gemini-2.5-flash".to_string(),
        ];
        let picked = OpenAiCompatibleProvider::pick_preferred_gemini_model(&models);
        // Should prefer known stable model first (flash comes before pro in preferred list)
        assert_eq!(picked, Some("models/gemini-2.5-flash".to_string()));
    }

    #[test]
    fn test_pick_preferred_gemini_model_handles_empty() {
        let models: Vec<String> = vec![];
        let picked = OpenAiCompatibleProvider::pick_preferred_gemini_model(&models);
        assert_eq!(picked, None);
    }

    #[test]
    fn test_pick_preferred_gemini_model_all_bad() {
        let models = vec![
            "models/antigravity-preview-05-2026".to_string(),
            "models/gemini-exp-test".to_string(),
            "models/interactions-only-model".to_string(),
        ];
        let picked = OpenAiCompatibleProvider::pick_preferred_gemini_model(&models);
        assert_eq!(picked, None);
    }

    #[test]
    fn test_parse_numbered_lines_format() {
        // Format E2E réel d'Ollama Qwen
        let text = r#"1. create_github_repo {"owner": "bobdivx", "repo": "test-repo", "private": true}
2. write_project_file {"project_uuid": "<project_uuid>", "path": "index.html", "content": "<html></html>", "mode": "local"}
3. trigger_deploy {"project_uuid": "<project_uuid>"}"#;
        
        let calls = parse_tool_calls_from_text(text);
        assert!(calls.is_some());
        let calls = calls.unwrap();
        assert_eq!(calls.len(), 3);
        
        assert_eq!(calls[0].name, "create_github_repo");
        assert_eq!(calls[0].arguments["owner"], "bobdivx");
        assert_eq!(calls[0].arguments["repo"], "test-repo");
        assert_eq!(calls[0].arguments["private"], true);
        
        assert_eq!(calls[1].name, "write_project_file");
        // Les placeholders doivent être supprimés
        assert!(calls[1].arguments.get("project_uuid").is_none());
        assert_eq!(calls[1].arguments["path"], "index.html");
        assert_eq!(calls[1].arguments["mode"], "local");
        
        assert_eq!(calls[2].name, "trigger_deploy");
        assert!(calls[2].arguments.get("project_uuid").is_none());
    }

    #[test]
    fn test_parse_numbered_lines_with_parenthesis() {
        let text = r#"1) list_projects {}
2) get_project {"project_uuid": "abc123"}"#;
        
        let calls = parse_tool_calls_from_text(text);
        assert!(calls.is_some());
        let calls = calls.unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, "list_projects");
        assert_eq!(calls[1].name, "get_project");
        assert_eq!(calls[1].arguments["project_uuid"], "abc123");
    }

    #[test]
    fn test_parse_bulleted_format() {
        let text = r#"- create_github_repo {"owner": "test", "repo": "repo1", "private": false}
- trigger_deploy {"project_uuid": "proj-123"}"#;
        
        let calls = parse_tool_calls_from_text(text);
        assert!(calls.is_some());
        let calls = calls.unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, "create_github_repo");
        assert_eq!(calls[1].name, "trigger_deploy");
    }

    #[test]
    fn test_parse_plain_lines_format() {
        let text = r#"list_projects {}
get_project {"project_uuid": "xyz"}"#;
        
        let calls = parse_tool_calls_from_text(text);
        assert!(calls.is_some());
        let calls = calls.unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, "list_projects");
        assert_eq!(calls[1].name, "get_project");
    }

    #[test]
    fn test_parse_mixed_valid_and_invalid_lines() {
        let text = r#"1. create_github_repo {"owner": "test", "repo": "repo1"}
Some random text here that should be ignored
2. trigger_deploy {"project_uuid": "proj-123"}"#;
        
        let calls = parse_tool_calls_from_text(text);
        assert!(calls.is_some());
        let calls = calls.unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, "create_github_repo");
        assert_eq!(calls[1].name, "trigger_deploy");
    }

    #[test]
    fn test_strip_placeholder_values() {
        let input = json!({
            "project_uuid": "<project_uuid>",
            "path": "index.html",
            "nested": {
                "id": "<some_id>",
                "value": "real_value"
            },
            "array": ["<placeholder>", "real"]
        });
        
        let result = strip_placeholder_values(input);
        
        // Les placeholders doivent être supprimés
        assert!(result.get("project_uuid").is_none());
        assert_eq!(result["path"], "index.html");
        assert!(result["nested"].get("id").is_none());
        assert_eq!(result["nested"]["value"], "real_value");
        // Les arrays gardent les placeholders (pas de suppression dans arrays pour simplicité)
        assert_eq!(result["array"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn test_parse_tool_calls_ignores_invalid_json_lines() {
        let text = r#"1. valid_tool {"key": "value"}
2. invalid_tool {this is not json}
3. another_valid_tool {"foo": "bar"}"#;
        
        let calls = parse_tool_calls_from_text(text);
        assert!(calls.is_some());
        let calls = calls.unwrap();
        // Devrait ignorer la ligne 2 avec JSON invalide
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, "valid_tool");
        assert_eq!(calls[1].name, "another_valid_tool");
    }

    #[test]
    fn test_exact_e2e_bug_format() {
        // Format exact du bug E2E live
        let text = r#"1. create_github_repo {"owner": "bobdivx", "repo": "e2e-hello5-1789212839", "private": true}
2. write_project_file {"project_uuid": "<project_uuid>", "path": "index.html", "content": "...", "mode": "local"}
3. write_project_file {"project_uuid": "<project_uuid>", "path": "index.html", "content": "...", "mode": "github"}
4. trigger_deploy {"project_uuid": "<project_uuid>"}"#;
        
        let calls = parse_tool_calls_from_text(text);
        assert!(calls.is_some());
        let calls = calls.unwrap();
        assert_eq!(calls.len(), 4);
        
        // Vérifie create_github_repo
        assert_eq!(calls[0].name, "create_github_repo");
        assert_eq!(calls[0].arguments["owner"], "bobdivx");
        assert_eq!(calls[0].arguments["repo"], "e2e-hello5-1789212839");
        
        // Vérifie write_project_file local
        assert_eq!(calls[1].name, "write_project_file");
        assert!(calls[1].arguments.get("project_uuid").is_none()); // placeholder supprimé
        assert_eq!(calls[1].arguments["mode"], "local");
        
        // Vérifie write_project_file github
        assert_eq!(calls[2].name, "write_project_file");
        assert_eq!(calls[2].arguments["mode"], "github");
        
        // Vérifie trigger_deploy
        assert_eq!(calls[3].name, "trigger_deploy");
        assert!(calls[3].arguments.get("project_uuid").is_none()); // placeholder supprimé
    }

    #[test]
    fn test_parse_markdown_fenced_json_simple() {
        // Bug E2E exact : Ollama retourne du JSON dans un bloc markdown
        let text = r#"```json
{
  "name": "create_github_repo",
  "arguments": {
    "owner": "bobdivx",
    "repo_name": "e2e-hello6-test",
    "private": true
  }
}
```"#;
        
        let calls = parse_tool_calls_from_text(text);
        assert!(calls.is_some());
        let calls = calls.unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "create_github_repo");
        assert_eq!(calls[0].arguments["owner"], "bobdivx");
        assert_eq!(calls[0].arguments["repo_name"], "e2e-hello6-test");
        assert_eq!(calls[0].arguments["private"], true);
    }

    #[test]
    fn test_parse_markdown_fenced_uppercase() {
        // Teste avec ```JSON en majuscules
        let text = r#"```JSON
{"name": "list_projects", "arguments": {}}
```"#;
        
        let calls = parse_tool_calls_from_text(text);
        assert!(calls.is_some());
        let calls = calls.unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "list_projects");
    }

    #[test]
    fn test_parse_markdown_fenced_no_language() {
        // Teste avec ``` sans tag de language
        let text = r#"```
{"name": "get_project", "arguments": {"project_uuid": "abc123"}}
```"#;
        
        let calls = parse_tool_calls_from_text(text);
        assert!(calls.is_some());
        let calls = calls.unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "get_project");
        assert_eq!(calls[0].arguments["project_uuid"], "abc123");
    }

    #[test]
    fn test_parse_markdown_fenced_with_numbered_lines() {
        // Teste la combinaison fence + lignes numérotées
        let text = r#"```
1. create_github_repo {"owner": "test", "repo": "repo1", "private": false}
2. trigger_deploy {"project_uuid": "proj-123"}
```"#;
        
        let calls = parse_tool_calls_from_text(text);
        assert!(calls.is_some());
        let calls = calls.unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, "create_github_repo");
        assert_eq!(calls[0].arguments["owner"], "test");
        assert_eq!(calls[1].name, "trigger_deploy");
        assert_eq!(calls[1].arguments["project_uuid"], "proj-123");
    }

    #[test]
    fn test_parse_markdown_fenced_whitespace_handling() {
        // Teste avec espaces/newlines supplémentaires
        let text = r#"

```json

{"name": "list_projects", "arguments": {}}

```

"#;
        
        let calls = parse_tool_calls_from_text(text);
        assert!(calls.is_some());
        let calls = calls.unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "list_projects");
    }

    #[test]
    fn test_strip_markdown_fences_function() {
        // Teste la fonction strip_markdown_fences directement
        let input = r#"```json
{"key": "value"}
```"#;
        let result = strip_markdown_fences(input);
        assert_eq!(result, r#"{"key": "value"}"#);

        // Teste sans tag de language
        let input2 = r#"```
{"key": "value"}
```"#;
        let result2 = strip_markdown_fences(input2);
        assert_eq!(result2, r#"{"key": "value"}"#);

        // Teste avec JSON majuscule
        let input3 = r#"```JSON
{"key": "value"}
```"#;
        let result3 = strip_markdown_fences(input3);
        assert_eq!(result3, r#"{"key": "value"}"#);

        // Teste sans fence (ne doit pas modifier)
        let input4 = r#"{"key": "value"}"#;
        let result4 = strip_markdown_fences(input4);
        assert_eq!(result4, r#"{"key": "value"}"#);
    }
}
