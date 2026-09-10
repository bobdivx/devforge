//! Health probe — vérifie qu’un LLM cloud ou local répond vraiment au chat
//! avant de l’activer dans la chaîne (pas seulement un listing `/models`).

use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::openai::OpenAiCompatibleProvider;
use crate::{err, provider_from_config, ChatMessage, ChatRequest, LlmProvider, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeRequest {
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeResult {
    pub ok: bool,
    pub provider: String,
    /// Modèle réellement testé (après résolution `auto`).
    pub resolved_model: String,
    pub latency_ms: u64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Ping chat minimal — cloud (Gemini, OpenAI…) et local (Ollama) partagent
/// le même chemin OpenAI-compat.
pub async fn probe(req: &ProbeRequest) -> ProbeResult {
    let started = Instant::now();
    let provider = req.provider.trim().to_lowercase();
    let list_base = list_base_for(&provider, &req.base_url);
    let chat_base = chat_base_for(&provider, &req.base_url);

    let resolved = OpenAiCompatibleProvider::resolve_model(
        &provider,
        &list_base,
        &req.api_key,
        &req.model,
    )
    .await;

    let (llm, mode) = provider_from_config(
        &provider,
        &req.api_key,
        &resolved,
        if chat_base.is_empty() {
            None
        } else {
            Some(chat_base.as_str())
        },
    );

    if mode == "stub" {
        return ProbeResult {
            ok: false,
            provider: req.provider.clone(),
            resolved_model: resolved,
            latency_ms: elapsed_ms(started),
            message: "config incomplète (stub)".into(),
            error: Some("clé / URL manquante — provider ignoré".into()),
        };
    }

    match chat_ping(llm.as_ref()).await {
        Ok(preview) => ProbeResult {
            ok: true,
            provider: req.provider.clone(),
            resolved_model: resolved.clone(),
            latency_ms: elapsed_ms(started),
            message: format!("chat OK · {resolved} · {preview}"),
            error: None,
        },
        Err(e) => ProbeResult {
            ok: false,
            provider: req.provider.clone(),
            resolved_model: resolved,
            latency_ms: elapsed_ms(started),
            message: "chat KO".into(),
            error: Some(e.to_string()),
        },
    }
}

async fn chat_ping(llm: &dyn LlmProvider) -> Result<String> {
    let turn = llm
        .chat(ChatRequest {
            messages: vec![ChatMessage::user("Reply with exactly: ok")],
            tools: vec![],
            temperature: 0.0,
        })
        .await
        .map_err(|e| err(e.to_string()))?;
    // Contenu vide sans erreur HTTP = douteux (ex. quota soft) → KO
    let preview = turn.content.trim();
    if preview.is_empty() && turn.tool_calls.is_empty() {
        return Err(err("réponse vide"));
    }
    Ok(preview.chars().take(48).collect())
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis() as u64
}

fn list_base_for(provider: &str, base_url: &str) -> String {
    let clean = base_url.trim().trim_end_matches('/');
    if provider == "ollama" {
        if clean.is_empty() {
            return "http://127.0.0.1:11434".into();
        }
        return clean.strip_suffix("/v1").unwrap_or(clean).to_string();
    }
    if clean.is_empty() {
        return OpenAiCompatibleProvider::default_base_url(provider)
            .unwrap_or("")
            .to_string();
    }
    clean.to_string()
}

fn chat_base_for(provider: &str, base_url: &str) -> String {
    let clean = base_url.trim().trim_end_matches('/');
    if provider == "ollama" {
        if clean.is_empty() {
            return "http://127.0.0.1:11434/v1".into();
        }
        if clean.ends_with("/v1") {
            return clean.to_string();
        }
        return format!("{clean}/v1");
    }
    if clean.is_empty() {
        return OpenAiCompatibleProvider::default_base_url(provider)
            .unwrap_or("")
            .to_string();
    }
    clean.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn stub_without_key_is_unhealthy() {
        let r = probe(&ProbeRequest {
            provider: "gemini".into(),
            base_url: String::new(),
            api_key: String::new(),
            model: "auto".into(),
        })
        .await;
        assert!(!r.ok);
        assert!(r.error.is_some());
    }
}
