use async_trait::async_trait;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use std::sync::Arc;

use crate::ProjectStore;

pub struct ListProjectsTool {
    pub store: Arc<dyn ProjectStore>,
}

#[async_trait]
impl Tool for ListProjectsTool {
    fn name(&self) -> &str {
        "list_projects"
    }
    fn description(&self) -> &str {
        "Liste les projets de l’équipe courante."
    }
    fn parameters(&self) -> Value {
        json!({"type":"object","properties":{}})
    }
    async fn execute(&self, _arguments: Value) -> Result<Value> {
        let projects = self.store.list_projects().await?;
        let count = projects.len();
        Ok(json!({"ok": true, "projects": projects, "count": count}))
    }
}

pub struct GetProjectTool {
    pub store: Arc<dyn ProjectStore>,
}

#[async_trait]
impl Tool for GetProjectTool {
    fn name(&self) -> &str {
        "get_project"
    }
    fn description(&self) -> &str {
        "Détail d’un projet DevForge (status, git, URL, derniers déploiements). \
         Utilise le project_uuid du contexte si omis."
    }
    fn parameters(&self) -> Value {
        json!({
            "type":"object",
            "properties":{
                "project_uuid":{"type":"string"}
            }
        })
    }
    async fn execute(&self, arguments: Value) -> Result<Value> {
        let uuid = arguments
            .get("project_uuid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if uuid.is_empty() {
            return Ok(json!({"ok": false, "error": "project_uuid requis"}));
        }
        match self.store.get_project(uuid).await? {
            Some(project) => Ok(json!({"ok": true, "project": project})),
            None => Ok(json!({"ok": false, "error": format!("projet introuvable: {uuid}")})),
        }
    }
}
