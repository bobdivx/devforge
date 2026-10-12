//! P5-05 : routines programmées par les agents (`project_crons` kind='agent').

use async_trait::async_trait;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::sync::Arc;

pub const MIN_INTERVAL_MINUTES: i64 = 15;
pub const MAX_AGENT_ROUTINES: i64 = 10;
const ROLES: &[&str] = &["coordinator", "ops", "deploy", "reviewer"];
const NOTIFY: &[&str] = &["always", "on_change", "on_failure"];
/// Identité imposée par le serveur (jamais celle du modèle).
pub const IDENTITY_ARGS: &[&str] = &["project_uuid", "caller_agent_uuid"];

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("").trim()
}

/// Routine validée, prête à être enregistrée.
#[derive(Debug, Clone, PartialEq)]
pub struct RoutineSpec {
    pub name: String,
    pub schedule: String,
    pub timezone: String,
    pub prompt: String,
    pub agent_role: String,
    pub notify: String,
}

/// Validation : cron 5 champs, fréquence ≥ 15 min, fuseau connu, consigne non vide.
pub fn validate(args: &Value) -> std::result::Result<RoutineSpec, String> {
    let name: String = s(args, "name").chars().take(80).collect();
    if name.is_empty() {
        return Err("name requis".into());
    }
    let schedule = s(args, "schedule")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if !devforge_cron::is_five_fields(&schedule) {
        return Err("schedule : expression cron à 5 champs attendue (ex. « 0 8 * * * »)".into());
    }
    devforge_cron::validate_cron_expression(&schedule)?;
    match devforge_cron::min_interval_minutes(&schedule) {
        Some(m) if m < MIN_INTERVAL_MINUTES => {
            return Err(format!(
                "fréquence trop élevée ({m} min) : {MIN_INTERVAL_MINUTES} min minimum"
            ))
        }
        None => return Err("schedule sans prochaine exécution".into()),
        _ => {}
    }
    let timezone = match s(args, "timezone") {
        "" => "Europe/Paris".to_string(),
        tz => {
            if !devforge_cron::timezone_is_known(tz) {
                return Err(format!("fuseau horaire inconnu : {tz}"));
            }
            tz.to_string()
        }
    };
    let prompt: String = s(args, "prompt").chars().take(1000).collect();
    if prompt.chars().count() < 10 {
        return Err(
            "prompt : consigne autonome requise (avec un critère de succès vérifiable)".into(),
        );
    }
    let agent_role = match s(args, "agent_role") {
        "" => "ops".to_string(),
        r if ROLES.contains(&r) => r.to_string(),
        r => return Err(format!("agent_role inconnu : {r}")),
    };
    let notify = match s(args, "notify") {
        "" => "on_change".to_string(),
        n if NOTIFY.contains(&n) => n.to_string(),
        n => return Err(format!("notify inconnu : {n}")),
    };
    Ok(RoutineSpec {
        name,
        schedule,
        timezone,
        prompt,
        agent_role,
        notify,
    })
}

fn routine_json(r: &devforge_cron::ProjectCron) -> Value {
    json!({
        "id": r.id,
        "name": r.name,
        "schedule": r.cron_expression,
        "timezone": r.timezone,
        "kind": r.kind.as_deref().unwrap_or("command"),
        "prompt": r.prompt,
        "notify": r.notify.as_deref().unwrap_or("on_change"),
        "created_by": r.created_by.as_deref().unwrap_or("user"),
        "enabled": r.enabled == 1,
        "last_status": r.last_status,
        "next_run_at": r.next_run_at,
    })
}

pub struct CreateRoutineTool {
    pub pool: Arc<PgPool>,
}

#[async_trait]
impl Tool for CreateRoutineTool {
    fn name(&self) -> &str {
        "create_routine"
    }

    fn description(&self) -> &str {
        "Programme une tâche récurrente exécutée par un agent DevForge (ex. smoke test quotidien, revue hebdo). À utiliser quand l'utilisateur demande explicitement une vérification ou un rapport récurrent. Fréquence minimale 15 min. Après création, confirme en une phrase (nom, horaire)."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "name": { "type": "string", "maxLength": 80 },
                "schedule": { "type": "string", "description": "Expression cron 5 champs, ex. '0 8 * * *'" },
                "timezone": { "type": "string", "default": "Europe/Paris" },
                "prompt": { "type": "string", "maxLength": 1000, "description": "Consigne autonome exécutée à chaque déclenchement, avec critère de succès vérifiable" },
                "agent_role": { "type": "string", "enum": ["coordinator", "ops", "deploy", "reviewer"], "default": "ops" },
                "notify": { "type": "string", "enum": ["always", "on_change", "on_failure"], "default": "on_change" }
            },
            "required": ["name", "schedule", "prompt"]
        })
    }

    async fn execute(&self, args: Value) -> Result<Value> {
        let project = s(&args, "project_uuid").to_string();
        if project.is_empty() {
            return Ok(json!({"ok": false, "error": "projet courant inconnu"}));
        }
        let spec = match validate(&args) {
            Ok(spec) => spec,
            Err(e) => return Ok(json!({"ok": false, "error": e})),
        };
        let pool = self.pool.as_ref();
        let count: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM project_crons WHERE project_uuid = $1 AND kind = 'agent'",
        )
        .bind(&project)
        .fetch_one(pool)
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;
        if count.0 >= MAX_AGENT_ROUTINES {
            return Ok(
                json!({"ok": false, "error": format!("{MAX_AGENT_ROUTINES} routines d'agent au plus par projet : supprime-en une d'abord")}),
            );
        }
        // Agent cible : le fil permanent du rôle demandé, sinon le Coordinateur.
        let target: Option<(String, String)> = sqlx::query_as(
            r#"SELECT uuid, role FROM project_agents
               WHERE project_uuid = $1 AND COALESCE(kind, '') <> 'subagent' AND role IN ($2, 'coordinator')
               ORDER BY (role = $2) DESC, id ASC LIMIT 1"#,
        )
        .bind(&project)
        .bind(&spec.agent_role)
        .fetch_optional(pool)
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;
        let Some((agent_uuid, agent_role)) = target else {
            return Ok(
                json!({"ok": false, "error": "aucun agent permanent dans ce projet pour exécuter la routine"}),
            );
        };
        let caller = s(&args, "caller_agent_uuid");
        let created_by = if caller.is_empty() {
            "agent".to_string()
        } else {
            format!("agent:{caller}")
        };
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let next = devforge_cron::next_run_time(&spec.schedule, Some(&spec.timezone))
            .map(|d| d.to_rfc3339());
        sqlx::query(
            r#"INSERT INTO project_crons (id, project_uuid, name, cron_expression, command, enabled, timezone,
                   last_status, last_run_at, next_run_at, created_at, updated_at, kind, agent_uuid, prompt, created_by, notify)
               VALUES ($1, $2, $3, $4, '', 1, $5, NULL, NULL, $6, $7, $7, 'agent', $8, $9, $10, $11)"#,
        )
        .bind(&id)
        .bind(&project)
        .bind(&spec.name)
        .bind(&spec.schedule)
        .bind(&spec.timezone)
        .bind(&next)
        .bind(&now)
        .bind(&agent_uuid)
        .bind(&spec.prompt)
        .bind(&created_by)
        .bind(&spec.notify)
        .execute(pool)
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;
        Ok(json!({
            "ok": true,
            "id": id,
            "name": spec.name,
            "schedule": spec.schedule,
            "timezone": spec.timezone,
            "agent_role": agent_role,
            "notify": spec.notify,
            "next_run_at": next,
            "message": "Routine créée : visible dans l'onglet Crons (bouton supprimer).",
        }))
    }
}

pub struct ListRoutinesTool {
    pub pool: Arc<PgPool>,
}

#[async_trait]
impl Tool for ListRoutinesTool {
    fn name(&self) -> &str {
        "list_routines"
    }
    fn description(&self) -> &str {
        "Liste les routines et tâches planifiées du projet (nom, horaire, créateur, dernier statut)."
    }
    fn parameters(&self) -> Value {
        json!({"type": "object", "properties": {}})
    }
    async fn execute(&self, args: Value) -> Result<Value> {
        let project = s(&args, "project_uuid");
        let rows = sqlx::query_as::<_, devforge_cron::ProjectCron>(
            "SELECT * FROM project_crons WHERE project_uuid = $1 ORDER BY created_at",
        )
        .bind(project)
        .fetch_all(self.pool.as_ref())
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;
        Ok(json!({"ok": true, "routines": rows.iter().map(routine_json).collect::<Vec<_>>()}))
    }
}

pub struct DeleteRoutineTool {
    pub pool: Arc<PgPool>,
}

#[async_trait]
impl Tool for DeleteRoutineTool {
    fn name(&self) -> &str {
        "delete_routine"
    }
    fn description(&self) -> &str {
        "Supprime une routine du projet. Une routine créée par l'utilisateur demande d'abord sa confirmation via ask_user, puis rappelle avec confirmed=true."
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": { "id": { "type": "string" }, "confirmed": { "type": "boolean", "default": false } },
            "required": ["id"]
        })
    }
    async fn execute(&self, args: Value) -> Result<Value> {
        let project = s(&args, "project_uuid");
        let id = s(&args, "id");
        let row: Option<devforge_cron::ProjectCron> =
            sqlx::query_as("SELECT * FROM project_crons WHERE id = $1 AND project_uuid = $2")
                .bind(id)
                .bind(project)
                .fetch_optional(self.pool.as_ref())
                .await
                .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;
        let Some(row) = row else {
            return Ok(json!({"ok": false, "error": "routine introuvable dans ce projet"}));
        };
        let by_agent = row
            .created_by
            .as_deref()
            .is_some_and(|c| c.starts_with("agent"));
        let confirmed = args
            .get("confirmed")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if !by_agent && !confirmed {
            return Ok(json!({
                "ok": false,
                "code": "needs_confirmation",
                "error": format!("« {} » a été créée par l'utilisateur : demande-lui confirmation avec ask_user, puis rappelle delete_routine avec confirmed=true.", row.name),
            }));
        }
        sqlx::query("DELETE FROM project_crons WHERE id = $1")
            .bind(id)
            .execute(self.pool.as_ref())
            .await
            .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;
        Ok(json!({"ok": true, "deleted": row.name}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(schedule: &str) -> Value {
        json!({"name": "Smoke popcornn", "schedule": schedule, "prompt": "Vérifie que https://popcornn.app répond en 2xx (http_smoke)."})
    }

    #[test]
    fn minimum_frequency_is_15_minutes() {
        assert!(validate(&args("*/15 * * * *")).is_ok());
        let e = validate(&args("*/5 * * * *")).unwrap_err();
        assert!(e.contains("15 min"), "{e}");
        assert!(validate(&args("* * * * *")).is_err());
    }

    #[test]
    fn defaults_and_rejections() {
        let spec = validate(&args("0 8 * * *")).unwrap();
        assert_eq!(spec.timezone, "Europe/Paris");
        assert_eq!(spec.agent_role, "ops");
        assert_eq!(spec.notify, "on_change");
        assert!(validate(&args("0 8 * *")).is_err(), "4 champs");
        assert!(validate(&args("0 0 8 * * *")).is_err(), "6 champs");
        assert!(
            validate(&json!({"name": "x", "schedule": "0 8 * * *", "prompt": "court"})).is_err()
        );
        let mut a = args("0 8 * * *");
        a["timezone"] = json!("Mars/Olympus");
        assert!(validate(&a).is_err());
        a["timezone"] = json!("America/New_York");
        assert!(validate(&a).is_ok());
        a["agent_role"] = json!("root");
        assert!(validate(&a).is_err());
    }
}
