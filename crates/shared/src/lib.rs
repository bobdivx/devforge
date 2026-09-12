use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DevForgeError {
    #[error("{0}")]
    Message(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("action utilisateur requise : {message_fr}")]
    NeedsUserAction {
        kind: String,
        message_fr: String,
        settings_href: Option<String>,
        resume_hint: Option<String>,
    },
    #[error(transparent)]
    Other(#[from] Box<dyn std::error::Error + Send + Sync>),
}

pub type Result<T> = std::result::Result<T, DevForgeError>;

impl DevForgeError {
    pub fn missing_github() -> Self {
        Self::NeedsUserAction {
            kind: "missing_github".into(),
            message_fr: "GitHub n'est pas configuré. Connecte ton compte GitHub dans les paramètres pour utiliser cet outil.".into(),
            settings_href: Some("/app/settings?tab=github".into()),
            resume_hint: Some("Une fois GitHub configuré, envoie « Continuer » ou « Go » pour relancer l'agent.".into()),
        }
    }

    pub fn missing_llm() -> Self {
        Self::NeedsUserAction {
            kind: "missing_llm".into(),
            message_fr: "Aucun LLM actif. Configure Ollama ou Gemini dans les paramètres pour que l'agent puisse fonctionner.".into(),
            settings_href: Some("/app/settings?tab=llm".into()),
            resume_hint: Some("Une fois un modèle activé, envoie « Continuer » ou « Go » pour relancer l'agent.".into()),
        }
    }

    pub fn missing_mcp(server_name: &str) -> Self {
        Self::NeedsUserAction {
            kind: "missing_mcp".into(),
            message_fr: format!("Le serveur MCP « {} » n'est pas configuré. Configure-le dans les paramètres MCP.", server_name),
            settings_href: Some("/app/settings?tab=mcp".into()),
            resume_hint: Some("Une fois le serveur MCP configuré, envoie « Continuer » ou « Go » pour relancer l'agent.".into()),
        }
    }

    pub fn mcp_auth_failed(server_name: &str, error: &str) -> Self {
        Self::NeedsUserAction {
            kind: "mcp_auth_error".into(),
            message_fr: format!("Erreur d'authentification MCP « {} » : {}. Vérifie tes credentials dans les paramètres.", server_name, error),
            settings_href: Some("/app/settings?tab=mcp".into()),
            resume_hint: Some("Une fois les credentials corrigés, envoie « Continuer » ou « Go » pour relancer l'agent.".into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn parameters(&self) -> Value;
    async fn execute(&self, arguments: Value) -> Result<Value>;

    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: self.name().to_string(),
            description: self.description().to_string(),
            parameters: self.parameters(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectTestContext {
    pub project_uuid: String,
    pub server_id: String,
    pub workdir: String,
    pub test_command: String,
    #[serde(default)]
    pub timeout: Option<u64>,
}
