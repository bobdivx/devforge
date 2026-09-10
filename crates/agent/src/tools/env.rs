use async_trait::async_trait;
use devforge_env::{EnvFacade, EnvVar};
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use std::sync::Arc;

pub struct ListEnvVarsTool {
    pub env: Arc<EnvFacade>,
}

#[async_trait]
impl Tool for ListEnvVarsTool {
    fn name(&self) -> &str {
        "list_env_vars"
    }
    fn description(&self) -> &str {
        "Liste les variables d’environnement d’un projet (secrets masqués)."
    }
    fn parameters(&self) -> Value {
        json!({
            "type":"object",
            "properties":{"project_uuid":{"type":"string"}},
            "required":["project_uuid"]
        })
    }
    async fn execute(&self, arguments: Value) -> Result<Value> {
        let uuid = arguments.get("project_uuid").and_then(|v| v.as_str()).unwrap_or("").trim();
        if uuid.is_empty() {
            return Ok(json!({"ok": false, "error": "project_uuid requis"}));
        }
        match self.env.list_public(uuid).await {
            Ok(vars) => Ok(json!({"ok": true, "env": vars})),
            Err(e) => Ok(json!({"ok": false, "error": e.to_string()})),
        }
    }
}

pub struct UpsertEnvVarTool {
    pub env: Arc<EnvFacade>,
}

#[async_trait]
impl Tool for UpsertEnvVarTool {
    fn name(&self) -> &str {
        "upsert_env_var"
    }
    fn description(&self) -> &str {
        "Crée ou met à jour une variable d’environnement projet (valeur secrète masquée en sortie)."
    }
    fn parameters(&self) -> Value {
        json!({
            "type":"object",
            "properties":{
                "project_uuid":{"type":"string"},
                "key":{"type":"string"},
                "value":{"type":"string"},
                "secret":{"type":"boolean"}
            },
            "required":["project_uuid","key","value"]
        })
    }
    async fn execute(&self, arguments: Value) -> Result<Value> {
        let uuid = arguments.get("project_uuid").and_then(|v| v.as_str()).unwrap_or("").trim();
        let key = arguments.get("key").and_then(|v| v.as_str()).unwrap_or("").trim();
        let value = arguments
            .get("value")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let secret = arguments.get("secret").and_then(|v| v.as_bool()).unwrap_or(true);
        if uuid.is_empty() || key.is_empty() {
            return Ok(json!({"ok": false, "error": "project_uuid et key requis"}));
        }
        match self
            .env
            .upsert(
                uuid,
                EnvVar {
                    key: key.into(),
                    value,
                    secret,
                },
            )
            .await
        {
            Ok(view) => Ok(json!({"ok": true, "var": view})),
            Err(e) => Ok(json!({"ok": false, "error": e.to_string()})),
        }
    }
}
