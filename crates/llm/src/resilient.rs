//! Fallback chain: try providers in priority order until one succeeds.

use async_trait::async_trait;
use std::sync::Arc;

use crate::{err, AssistantTurn, ChatRequest, LlmProvider, Result};

pub struct ChainEntry {
    pub label: String,
    pub provider: Arc<dyn LlmProvider>,
}

/// Tries each provider in order. On error (or empty content without tools), falls through.
pub struct ResilientLlmProvider {
    chain: Vec<ChainEntry>,
}

impl ResilientLlmProvider {
    pub fn new(chain: Vec<ChainEntry>) -> Self {
        Self { chain }
    }

    pub fn labels(&self) -> Vec<String> {
        self.chain.iter().map(|e| e.label.clone()).collect()
    }
}

#[async_trait]
impl LlmProvider for ResilientLlmProvider {
    fn name(&self) -> &str {
        "resilient"
    }

    async fn chat(&self, req: ChatRequest) -> Result<AssistantTurn> {
        if self.chain.is_empty() {
            return Err(err("aucun provider LLM dans la chaîne"));
        }
        let mut errors: Vec<String> = Vec::new();
        for (i, entry) in self.chain.iter().enumerate() {
            match entry.provider.chat(req.clone()).await {
                Ok(turn) => {
                    let empty = turn.content.trim().is_empty() && turn.tool_calls.is_empty();
                    if empty && i + 1 < self.chain.len() {
                        tracing::warn!(
                            provider = %entry.label,
                            "réponse vide — fallback suivant"
                        );
                        errors.push(format!("{}: réponse vide", entry.label));
                        continue;
                    }
                    if i > 0 {
                        tracing::info!(provider = %entry.label, rank = i, "LLM fallback utilisé");
                    }
                    return Ok(turn);
                }
                Err(e) => {
                    tracing::warn!(
                        provider = %entry.label,
                        error = %e,
                        "LLM KO — fallback suivant"
                    );
                    errors.push(format!("{}: {e}", entry.label));
                }
            }
        }
        Err(err(format!(
            "tous les providers ont échoué — {}",
            if errors.is_empty() {
                "chaîne vide".into()
            } else {
                errors.join(" | ")
            }
        )))
    }
}
