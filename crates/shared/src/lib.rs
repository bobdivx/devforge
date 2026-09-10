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
    #[error(transparent)]
    Other(#[from] Box<dyn std::error::Error + Send + Sync>),
}

pub type Result<T> = std::result::Result<T, DevForgeError>;

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
