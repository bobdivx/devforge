use async_trait::async_trait;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use std::sync::Arc;

use crate::ProjectStore;

pub struct GetDeploymentLogsTool {
    pub store: Arc<dyn ProjectStore>,
}

#[async_trait]
impl Tool for GetDeploymentLogsTool {
    fn name(&self) -> &str {
        "get_deployment_logs"
    }
    fn description(&self) -> &str {
        "Récupère les logs d’un déploiement."
    }
    fn parameters(&self) -> Value {
        json!({
            "type":"object",
            "properties":{"deployment_uuid":{"type":"string"}},
            "required":["deployment_uuid"]
        })
    }
    async fn execute(&self, arguments: Value) -> Result<Value> {
        let uuid = arguments
            .get("deployment_uuid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if uuid.is_empty() {
            return Ok(json!({"ok": false, "error": "deployment_uuid requis"}));
        }
        self.store.deployment_logs(uuid).await
    }
}
