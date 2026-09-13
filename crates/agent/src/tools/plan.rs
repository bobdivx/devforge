use async_trait::async_trait;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};

/// Enregistre un plan structuré visible dans le chat. N'exécute rien.
pub struct ProposePlanTool;

#[async_trait]
impl Tool for ProposePlanTool {
    fn name(&self) -> &str {
        "propose_plan"
    }

    fn description(&self) -> &str {
        "Enregistre un plan d'action visible pour l'utilisateur, puis continue.\n\
         \n\
         À appeler EN PREMIER sur une demande d'amélioration / correction / feature,\n\
         AVANT d'écrire des fichiers. Le plan n'est PAS une PR : tu exécutes ensuite\n\
         en LOCAL (write_project_file mode=local) et tu lances start_local_preview.\n\
         \n\
         Paramètres :\n\
         - title : titre court du plan\n\
         - steps : liste d'étapes concrètes (3 à 7)\n\
         - summary : résumé en 1-2 phrases (optionnel)\n\
         \n\
         Après cet appel : exécute les étapes locales. N'ouvre une PR que si\n\
         l'utilisateur valide explicitement (après preview)."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "title": {
                    "type": "string",
                    "description": "Titre court du plan"
                },
                "summary": {
                    "type": "string",
                    "description": "Résumé en une ou deux phrases"
                },
                "steps": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Étapes concrètes, dans l'ordre"
                }
            },
            "required": ["title", "steps"]
        })
    }

    async fn execute(&self, arguments: Value) -> Result<Value> {
        let title = arguments
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let summary = arguments
            .get("summary")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let steps: Vec<String> = arguments
            .get("steps")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|s| s.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default();

        if title.is_empty() || steps.is_empty() {
            return Ok(json!({
                "ok": false,
                "error": "title et au moins une étape (steps) sont requis"
            }));
        }

        Ok(json!({
            "ok": true,
            "plan": {
                "title": title,
                "summary": summary,
                "steps": steps,
            },
            "awaiting": "preview_then_user_validation",
            "message": format!(
                "Plan « {title} » enregistré ({} étape(s)). Exécute maintenant en local, puis lance la preview. Pas de PR tant que l'utilisateur n'a pas validé.",
                steps.len()
            )
        }))
    }
}
