use async_trait::async_trait;
use devforge_deploy::DeployFacade;
use devforge_shared::{DevForgeError, Result, Tool};
use serde_json::{json, Value};
use std::sync::Arc;

use crate::ProjectStore;

pub struct RunApplicationTestsTool {
    pub deploy: Arc<DeployFacade>,
    pub store: Arc<dyn ProjectStore>,
}

#[async_trait]
impl Tool for RunApplicationTestsTool {
    fn name(&self) -> &str {
        "run_application_tests"
    }
    fn description(&self) -> &str {
        "Exécute les tests d’un projet via workdir + test_command déclarés (pas de scan de chemins)."
    }
    fn parameters(&self) -> Value {
        json!({
            "type":"object",
            "properties":{
                "project_uuid":{"type":"string"},
                "application_uuid":{"type":"string"},
                "timeout":{"type":"integer"}
            },
            "required":["project_uuid"]
        })
    }
    async fn execute(&self, arguments: Value) -> Result<Value> {
        let uuid = arguments
            .get("project_uuid")
            .or_else(|| arguments.get("application_uuid"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if uuid.is_empty() {
            return Ok(json!({"ok": false, "error": "project_uuid requis"}));
        }
        let mut ctx = self
            .store
            .resolve_project(&uuid)
            .await?
            .ok_or_else(|| DevForgeError::NotFound(format!("Projet introuvable: {uuid}")))?;
        if let Some(t) = arguments.get("timeout").and_then(|v| v.as_u64()) {
            ctx.timeout = Some(t);
        }
        Ok(self.deploy.run_tests(&ctx).await)
    }
}
