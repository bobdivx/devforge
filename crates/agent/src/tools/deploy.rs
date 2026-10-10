use async_trait::async_trait;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use std::sync::Arc;

use crate::ProjectStore;

/// Tool pour déclencher un déploiement d'un projet DevForge.
pub struct TriggerDeployTool {
    pub store: Arc<dyn ProjectStore>,
}

#[async_trait]
impl Tool for TriggerDeployTool {
    fn name(&self) -> &str {
        "trigger_deploy"
    }

    fn description(&self) -> &str {
        "Déclenche le déploiement d'un projet DevForge.\n\
         \n\
         Ce tool lance le cycle complet de déploiement :\n\
         1. Synchronisation du dépôt Git\n\
         2. Build selon le build_pack configuré (nixpacks, dockerfile, static)\n\
         3. Démarrage du conteneur ou publication des assets statiques\n\
         \n\
         Pré-requis :\n\
         - Le projet doit avoir un git_repository configuré\n\
         - Le workdir doit être défini\n\
         - Le build_pack doit être configuré (nixpacks par défaut)\n\
         \n\
         Paramètres :\n\
         - project_uuid : UUID du projet DevForge (contexte par défaut)\n\
         - git_sha : SHA Git spécifique à déployer (optionnel, utilise HEAD par défaut)\n\
         - message : message descriptif pour ce déploiement (optionnel)\n\
         \n\
         Retourne :\n\
         - deployment_uuid : UUID du déploiement créé\n\
         - status : success ou failed\n\
         - logs : logs du déploiement\n\
         - git_sha : SHA Git déployé\n\
         \n\
         Exemple d'usage dans le workflow scaffold :\n\
         1. create_github_repo → crée le repo\n\
         2. write_project_file → écrit les fichiers sources\n\
         3. trigger_deploy → lance le déploiement initial\n\
         \n\
         Note : Le déploiement est asynchrone. Utilise get_deployment_logs pour suivre la progression."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_uuid": {
                    "type": "string",
                    "description": "UUID du projet DevForge (injecté automatiquement si dans le contexte)"
                },
                "git_sha": {
                    "type": "string",
                    "description": "SHA Git spécifique à déployer (optionnel, utilise HEAD par défaut)"
                },
                "message": {
                    "type": "string",
                    "description": "Message descriptif pour ce déploiement (optionnel)"
                }
            },
            "required": ["project_uuid"]
        })
    }

    async fn execute(&self, arguments: Value) -> Result<Value> {
        // Note : project_uuid est automatiquement injecté par inject_tool_defaults
        // depuis le contexte d'agent (issue #1 corrigée).
        let project_uuid = arguments
            .get("project_uuid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();

        if project_uuid.is_empty() {
            return Ok(json!({
                "ok": false,
                "error": "project_uuid requis. Le project_uuid aurait dû être injecté automatiquement depuis le contexte."
            }));
        }

        let git_sha = arguments
            .get("git_sha")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string());

        let message = arguments
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Déploiement via agent builder");

        // Appeler la méthode trigger_deploy du store
        self.store
            .trigger_deploy(project_uuid, git_sha, message)
            .await
    }
}

pub struct ListDeploymentsTool {
    pub store: Arc<dyn ProjectStore>,
}

#[async_trait]
impl Tool for ListDeploymentsTool {
    fn name(&self) -> &str {
        "list_deployments"
    }
    fn description(&self) -> &str {
        "Liste les déploiements d’un projet DevForge (uuid, status, sha, message, created_at). Utilise le project_uuid du contexte si omis."
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_uuid": { "type": "string", "description": "UUID du projet (injecté automatiquement si dans le contexte)" },
                "limit": { "type": "integer", "description": "Nombre max de déploiements (défaut 10)" }
            }
        })
    }
    async fn execute(&self, arguments: Value) -> Result<Value> {
        let project_uuid = arguments.get("project_uuid").and_then(|v| v.as_str()).unwrap_or("").trim();
        if project_uuid.is_empty() {
            return Ok(json!({"ok": false, "error": "project_uuid requis"}));
        }
        self.store.list_deployments(project_uuid).await
    }
}

pub struct CancelDeploymentTool {
    pub store: Arc<dyn ProjectStore>,
}

#[async_trait]
impl Tool for CancelDeploymentTool {
    fn name(&self) -> &str {
        "cancel_deployment"
    }
    fn description(&self) -> &str {
        "Annule un déploiement en cours (marque cancelled et remet le projet en idle si c’était le déploiement courant)."
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "deployment_uuid": { "type": "string" }
            },
            "required": ["deployment_uuid"]
        })
    }
    async fn execute(&self, arguments: Value) -> Result<Value> {
        let uuid = arguments.get("deployment_uuid").and_then(|v| v.as_str()).unwrap_or("").trim();
        if uuid.is_empty() {
            return Ok(json!({"ok": false, "error": "deployment_uuid requis"}));
        }
        self.store.cancel_deployment(uuid).await
    }
}
