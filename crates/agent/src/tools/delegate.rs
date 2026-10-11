//! P4-03 : délégation réelle. Le Coordinateur confie une tâche à un worker en arrière-plan
//! et rend la main tout de suite ; le serveur démarre le run (même chemin que les réveils).

use async_trait::async_trait;
use devforge_shared::{DevForgeError, Result, Tool};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::sync::{Arc, OnceLock};

/// Workers actifs (en attente ou en cours) au plus par projet ; au-delà : file d'attente.
pub const MAX_ACTIVE_WORKERS: i64 = 2;

/// Refus renvoyé aux outils appelés après une délégation dans le même tour.
pub const DELEGATED_REFUSAL: &str = "Tâche déléguée : laisse le worker travailler.";

/// Démarre un run worker déjà enregistré (`agent_runs.status = 'pending'`). Fourni par le serveur.
pub trait WorkerLauncher: Send + Sync {
    fn launch(&self, project_uuid: &str, agent_uuid: &str, run_uuid: &str);
}

static LAUNCHER: OnceLock<Arc<dyn WorkerLauncher>> = OnceLock::new();

/// Branche le lanceur (une fois, au démarrage du serveur).
pub fn set_worker_launcher(l: Arc<dyn WorkerLauncher>) {
    let _ = LAUNCHER.set(l);
}

pub fn worker_launcher() -> Option<Arc<dyn WorkerLauncher>> {
    LAUNCHER.get().cloned()
}

/// Titre normalisé : sert de clé de dédoublonnage (un même sujet = un seul worker actif).
pub fn title_key(title: &str) -> String {
    title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Statut initial d'un nouveau run worker selon le nombre de workers actifs du projet.
pub fn initial_status(active: i64) -> &'static str {
    if active >= MAX_ACTIVE_WORKERS {
        "queued"
    } else {
        "pending"
    }
}

/// Nom de worker lisible et court à partir du titre.
pub fn worker_name(title: &str) -> String {
    let slug: String = title_key(title).split(' ').take(4).collect::<Vec<_>>().join("-");
    let slug = if slug.is_empty() { "tache".to_string() } else { slug };
    format!("worker-{}", slug.chars().take(40).collect::<String>())
}

pub struct DelegateTaskTool {
    pub pool: Arc<PgPool>,
}

fn s<'a>(args: &'a Value, k: &str) -> &'a str {
    args.get(k).and_then(|v| v.as_str()).unwrap_or("").trim()
}

fn db(e: sqlx::Error) -> DevForgeError {
    DevForgeError::Message(e.to_string())
}

#[async_trait]
impl Tool for DelegateTaskTool {
    fn name(&self) -> &str {
        "delegate_task"
    }
    fn description(&self) -> &str {
        "Confie une tâche longue ou isolée à un worker en arrière-plan et rends la main tout de suite. \
         Le résultat reviendra dans ce fil sous forme de carte. Après cet outil, réponds en une phrase \
         ce que tu as lancé et arrête-toi."
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "title": { "type": "string", "maxLength": 80, "description": "Titre court de la tâche" },
                "instructions": {
                    "type": "string",
                    "description": "Objectif, contraintes, critère de fin vérifiable (ex. build OK + preview public_ok)"
                },
                "reuse_worker_uuid": { "type": "string", "description": "Optionnel : réutiliser un worker existant" }
            },
            "required": ["title", "instructions"]
        })
    }
    async fn execute(&self, args: Value) -> Result<Value> {
        let project_uuid = s(&args, "project_uuid");
        let caller = s(&args, "caller_agent_uuid");
        let title: String = s(&args, "title").chars().take(80).collect();
        let instructions = s(&args, "instructions");
        let reuse = s(&args, "reuse_worker_uuid");
        let parent_run = s(&args, "parent_run_uuid");
        if project_uuid.is_empty() || caller.is_empty() {
            return Ok(json!({"ok": false, "error": "delegate_task doit être appelé depuis un fil agent de projet"}));
        }
        if title.is_empty() || instructions.is_empty() {
            return Ok(json!({"ok": false, "error": "title et instructions requis"}));
        }
        let pool = self.pool.as_ref();
        let role: Option<(String,)> =
            sqlx::query_as("SELECT role FROM project_agents WHERE uuid = $1 AND project_uuid = $2")
                .bind(caller)
                .bind(project_uuid)
                .fetch_optional(pool)
                .await
                .map_err(db)?;
        match role {
            Some((r,)) if r == "coordinator" => {}
            Some(_) => return Ok(json!({"ok": false, "error": "delegate_task est réservé au Coordinateur"})),
            None => return Ok(json!({"ok": false, "error": "agent appelant introuvable"})),
        }

        // Un même sujet ne peut avoir qu'un worker actif.
        let key = title_key(&title);
        let active: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
            r#"SELECT uuid, agent_uuid, status, title FROM agent_runs
               WHERE project_uuid = $1 AND kind = 'worker' AND status IN ('pending','running','queued')"#,
        )
        .bind(project_uuid)
        .fetch_all(pool)
        .await
        .map_err(db)?;
        if let Some((run, worker, status, t)) = active.iter().find(|(_, _, _, t)| t.as_deref().map(title_key).as_deref() == Some(key.as_str())) {
            return Ok(json!({
                "ok": true,
                "status": "already_running",
                "run_status": status,
                "run_uuid": run,
                "worker_uuid": worker,
                "title": t,
                "message": "Un worker travaille déjà sur ce sujet : je te mets le résultat ici quand il a fini.",
            }));
        }
        let running = active.iter().filter(|(_, _, st, _)| st != "queued").count() as i64;
        let status = initial_status(running);

        let now = chrono::Utc::now().to_rfc3339();
        // Worker réutilisé (même projet, sous-agent) ou nouveau sous-agent rattaché au Coordinateur.
        let reused: Option<(String, String)> = if reuse.is_empty() {
            None
        } else {
            sqlx::query_as(
                "SELECT uuid, name FROM project_agents WHERE uuid = $1 AND project_uuid = $2 AND kind = 'subagent'",
            )
            .bind(reuse)
            .bind(project_uuid)
            .fetch_optional(pool)
            .await
            .map_err(db)?
        };
        let (worker_uuid, worker_name) = match reused {
            Some(w) => w,
            None => {
                let uuid = uuid::Uuid::new_v4().to_string();
                let name = worker_name(&title);
                sqlx::query(
                    r#"INSERT INTO project_agents (uuid, project_uuid, name, role, kind, parent_agent_uuid, status, created_at, updated_at)
                       VALUES ($1, $2, $3, 'worker', 'subagent', $4, 'idle', $5, $5)"#,
                )
                .bind(&uuid)
                .bind(project_uuid)
                .bind(&name)
                .bind(caller)
                .bind(&now)
                .execute(pool)
                .await
                .map_err(db)?;
                (uuid, name)
            }
        };
        let msg_uuid = uuid::Uuid::new_v4().to_string();
        let body = format!("TÂCHE DÉLÉGUÉE PAR LE COORDINATEUR : {title}\n\n{instructions}\n\nTravaille en local (brouillon). Termine par un résumé d'une ligne : ce qui est fait et comment c'est vérifié.");
        sqlx::query(
            r#"INSERT INTO agent_messages (uuid, project_uuid, agent_uuid, role, content, tool_calls_json, provider, created_at)
               VALUES ($1, $2, $3, 'user', $4, '[]', 'system', $5)"#,
        )
        .bind(&msg_uuid)
        .bind(project_uuid)
        .bind(&worker_uuid)
        .bind(&body)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(db)?;
        let run_uuid = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            r#"INSERT INTO agent_runs (uuid, project_uuid, agent_uuid, message_uuid, status, error, created_at, updated_at, kind, title, parent_run_uuid)
               VALUES ($1, $2, $3, $4, $5, NULL, $6, $6, 'worker', $7, $8)"#,
        )
        .bind(&run_uuid)
        .bind(project_uuid)
        .bind(&worker_uuid)
        .bind(&msg_uuid)
        .bind(status)
        .bind(&now)
        .bind(&title)
        .bind(Some(parent_run).filter(|p| !p.is_empty()))
        .execute(pool)
        .await
        .map_err(db)?;
        let _ = sqlx::query("UPDATE project_agents SET status = 'working', updated_at = $1 WHERE uuid = $2")
            .bind(&now)
            .bind(&worker_uuid)
            .execute(pool)
            .await;
        if status == "pending" {
            if let Some(l) = worker_launcher() {
                l.launch(project_uuid, &worker_uuid, &run_uuid);
            }
        }
        Ok(json!({
            "ok": true,
            "status": if status == "pending" { "started" } else { "queued" },
            "run_uuid": run_uuid,
            "worker_uuid": worker_uuid,
            "worker_name": worker_name,
            "title": title,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concurrency_limit_queues_the_third_worker() {
        assert_eq!(initial_status(0), "pending");
        assert_eq!(initial_status(1), "pending");
        assert_eq!(initial_status(2), "queued");
        assert_eq!(initial_status(5), "queued");
    }

    #[test]
    fn title_key_ignores_case_and_punctuation() {
        assert_eq!(title_key("Refais la page d'accueil !"), title_key("refais  la page d accueil"));
        assert_eq!(worker_name("Refais toute la page d'accueil"), "worker-refais-toute-la-page");
    }
}
