use async_trait::async_trait;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::path::Path;
use std::sync::Arc;

use crate::sdd;

/// Écrit la constitution et les specs dans le workdir. N'ouvre aucun dépôt distant.
pub struct SddLoopTool {
    pub pool: Arc<PgPool>,
}

#[async_trait]
impl Tool for SddLoopTool {
    fn name(&self) -> &str {
        "sdd_loop"
    }

    fn description(&self) -> &str {
        "Boucle spec locale du projet (fichiers specs/ dans le workdir).\n\
         \n\
         action=specify : écrit specs/constitution.md une fois (qualité, tests, maintenabilité) \
         et specs/<slug>/spec.md, puis STOP. N'écris pas de code et ne crée pas de dépôt.\n\
         action=approve : seulement après une validation explicite de la spec \
         (« j'approuve la spec »). « oui » et « go » ne comptent pas. Écrit plan.md et tasks.md.\n\
         Ensuite create_project_agent (role=worker) avec le champ implement_prompt.\n\
         action=reject : spec refusée, aucun code.\n\
         action=list : état des specs.\n\
         \n\
         Ne publie pas et ne déploie pas."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_uuid": { "type": "string" },
                "action": {
                    "type": "string",
                    "enum": ["specify", "approve", "reject", "list"],
                    "description": "specify | approve | reject | list"
                },
                "title": { "type": "string" },
                "description": { "type": "string" },
                "slug": { "type": "string" },
                "note": { "type": "string" }
            },
            "required": ["project_uuid", "action"]
        })
    }

    async fn execute(&self, arguments: Value) -> Result<Value> {
        let project_uuid = arguments
            .get("project_uuid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let action = arguments
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if project_uuid.is_empty() || action.is_empty() {
            return Ok(json!({"ok": false, "error": "project_uuid et action requis"}));
        }
        let workdir = match load_workdir(&self.pool, project_uuid).await {
            Ok(dir) => dir,
            Err(e) => return Ok(json!({"ok": false, "error": e})),
        };
        let root = Path::new(&workdir);
        let result = match action {
            "list" => sdd::list_features(root).map(|items| json!({"ok": true, "features": items})),
            "specify" => {
                let title = arguments
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let description = arguments
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                sdd::specify(root, title, description).map(|status| {
                    json!({
                        "ok": true,
                        "feature": status,
                        "stop": true,
                        "message": "Spec écrite. Arrêt : attends une validation explicite avant plan.md, tasks.md ou tout code. N'appelle pas create_github_repo."
                    })
                })
            }
            "approve" => {
                let slug = arguments.get("slug").and_then(|v| v.as_str()).unwrap_or("");
                sdd::approve(root, slug).map(|status| {
                    json!({
                        "ok": true,
                        "feature": status,
                        "implement_prompt": sdd::implement_prompt(&status.slug, &status.title, status.attempts),
                        "message": "Plan et tâches écrits. Appelle create_project_agent (role=worker, initial_message=implement_prompt). Reste en local."
                    })
                })
            }
            "reject" => {
                let slug = arguments.get("slug").and_then(|v| v.as_str()).unwrap_or("");
                let note = arguments.get("note").and_then(|v| v.as_str()).unwrap_or("");
                sdd::reject(root, slug, note).map(|status| json!({"ok": true, "feature": status}))
            }
            _ => Err("action inconnue (specify, approve, reject, list)".into()),
        };
        match result {
            Ok(v) => Ok(v),
            Err(e) => Ok(json!({"ok": false, "error": e})),
        }
    }
}

async fn load_workdir(pool: &PgPool, project_uuid: &str) -> std::result::Result<String, String> {
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT workdir FROM projects WHERE uuid = $1")
            .bind(project_uuid)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
    let Some((workdir,)) = row else {
        return Err("projet introuvable".into());
    };
    let raw = workdir.unwrap_or_default();
    let resolved = if raw.trim().is_empty() {
        devforge_deploy::resolve_project_workdir(
            &format!("/data/devforge/applications/{project_uuid}"),
            project_uuid,
        )
    } else {
        devforge_deploy::resolve_project_workdir(raw.trim(), project_uuid)
    };
    std::fs::create_dir_all(&resolved).map_err(|e| e.to_string())?;
    Ok(resolved)
}
