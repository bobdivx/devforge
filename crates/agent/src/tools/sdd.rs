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
         (« j'approuve la spec »). « oui » et « go » ne comptent pas. Écrit plan.md et tasks.md, \
         crée le worker local éphémère et démarre l'implémentation. N'appelle pas create_project_agent.\n\
         action=reject : spec refusée, aucun code.\n\
         action=list : état des specs.\n\
         \n\
         Ne publie pas et ne déploie pas. Pas de dépôt, pas de pull request."
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
                        "message": "Spec écrite. Arrêt : attends une validation explicite avant plan.md, tasks.md ou tout code. « oui » et « go » ne suffisent pas. N'appelle pas create_github_repo."
                    })
                })
            }
            "approve" => {
                let slug = arguments.get("slug").and_then(|v| v.as_str()).unwrap_or("");
                return approve_and_start(&self.pool, root, project_uuid, slug).await;
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

async fn approve_and_start(
    pool: &PgPool,
    root: &Path,
    project_uuid: &str,
    slug: &str,
) -> Result<Value> {
    if slug.trim().is_empty() {
        return Ok(json!({"ok": false, "error": "slug requis"}));
    }
    let existing = match sdd::read_status(root, slug) {
        Ok(v) => v,
        Err(e) => return Ok(json!({"ok": false, "error": e})),
    };
    let mut status = match existing {
        Some(status) if status.phase == sdd::PHASE_IMPLEMENT && !status.worker_uuid.is_empty() => {
            return Ok(json!({
                "ok": true,
                "feature": status,
                "project_uuid": project_uuid,
                "worker_uuid": status.worker_uuid,
                "worker_started": false,
                "message": "Worker déjà lancé. N'en crée pas un second. Reste en local : pas de dépôt, pas de pull request, pas de déploiement."
            }));
        }
        Some(status) if status.phase == sdd::PHASE_IMPLEMENT && status.worker_uuid.is_empty() => {
            status
        }
        _ => match sdd::approve(root, slug) {
            Ok(status) => status,
            Err(e) => return Ok(json!({"ok": false, "error": e})),
        },
    };

    let worker = match enqueue_implement_worker(pool, project_uuid, &status).await {
        Ok(uuid) => uuid,
        Err(e) => {
            return Ok(json!({
                "ok": false,
                "error": format!("plan écrit, worker non lancé : {e}")
            }));
        }
    };
    status.worker_uuid = worker.clone();
    status.note = format!(
        "Spec validée. Worker {worker} lancé en local (essai {}/{}).",
        status.attempts,
        sdd::MAX_ATTEMPTS
    );
    if let Err(e) = sdd::write_status(root, &status) {
        return Ok(json!({
            "ok": false,
            "error": e,
            "project_uuid": project_uuid,
            "worker_uuid": worker
        }));
    }
    Ok(json!({
        "ok": true,
        "feature": status,
        "project_uuid": project_uuid,
        "worker_uuid": worker,
        "worker_started": true,
        "message": "Spec validée. Worker local lancé. N'appelle pas create_project_agent. Reste en local : pas de dépôt, pas de pull request, pas de déploiement."
    }))
}

/// Crée le sous-agent et laisse un tour `pending`. Aucun `caller_agent_uuid` :
/// l'approve lui-même démarre l'implémentation, pas l'appelant externe.
async fn enqueue_implement_worker(
    pool: &PgPool,
    project_uuid: &str,
    status: &sdd::FeatureStatus,
) -> std::result::Result<String, String> {
    let parent = ensure_coordinator(pool, project_uuid).await?;
    let agent_uuid = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let name: String = format!("Worker {}", status.slug).chars().take(80).collect();
    sqlx::query(
        r#"INSERT INTO project_agents (
            uuid, project_uuid, name, role, kind, parent_agent_uuid, status, created_at, updated_at
        ) VALUES ($1, $2, $3, 'worker', 'subagent', $4, 'idle', $5, $6)"#,
    )
    .bind(&agent_uuid)
    .bind(project_uuid)
    .bind(&name)
    .bind(&parent)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    let prompt = sdd::implement_prompt(&status.slug, &status.title, status.attempts);
    let message_uuid = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        r#"INSERT INTO agent_messages (
            uuid, project_uuid, agent_uuid, role, content, tool_calls_json, provider, created_at
        ) VALUES ($1, $2, $3, 'user', $4, '[]', '', $5)"#,
    )
    .bind(&message_uuid)
    .bind(project_uuid)
    .bind(&agent_uuid)
    .bind(&prompt)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    let _ = sqlx::query(
        "UPDATE project_agents SET status = 'working', updated_at = $1 WHERE uuid = $2",
    )
    .bind(&now)
    .bind(&agent_uuid)
    .execute(pool)
    .await;

    let run_uuid = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        r#"INSERT INTO agent_runs (
            uuid, project_uuid, agent_uuid, message_uuid, status, error, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 'pending', NULL, $5, $6)"#,
    )
    .bind(&run_uuid)
    .bind(project_uuid)
    .bind(&agent_uuid)
    .bind(&message_uuid)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(agent_uuid)
}

async fn ensure_coordinator(
    pool: &PgPool,
    project_uuid: &str,
) -> std::result::Result<String, String> {
    let existing: Option<(String,)> = sqlx::query_as(
        "SELECT uuid FROM project_agents WHERE project_uuid = $1 AND role = 'coordinator' AND kind = 'required' LIMIT 1",
    )
    .bind(project_uuid)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    if let Some((uuid,)) = existing {
        return Ok(uuid);
    }
    let uuid = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    sqlx::query(
        r#"INSERT INTO project_agents (
            uuid, project_uuid, name, role, kind, parent_agent_uuid, status, created_at, updated_at
        ) VALUES ($1, $2, 'Coordinateur', 'coordinator', 'required', NULL, 'idle', $3, $4)"#,
    )
    .bind(&uuid)
    .bind(project_uuid)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(uuid)
}

async fn load_workdir(pool: &PgPool, project_uuid: &str) -> std::result::Result<String, String> {
    // Par uuid seulement : le projet que l'instance connaît est visible même si
    // le workspace par défaut du jeton API est une autre équipe.
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    async fn schema(pool: &PgPool) {
        sqlx::query(
            r#"CREATE TABLE projects (
                id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                uuid TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                slug TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL DEFAULT 'ready',
                workdir TEXT,
                workspace_uuid TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"#,
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            r#"CREATE TABLE project_agents (
                id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                uuid TEXT NOT NULL UNIQUE,
                project_uuid TEXT NOT NULL,
                name TEXT NOT NULL,
                role TEXT NOT NULL,
                kind TEXT NOT NULL,
                parent_agent_uuid TEXT,
                status TEXT NOT NULL DEFAULT 'idle',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"#,
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            r#"CREATE TABLE agent_messages (
                id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
                uuid TEXT NOT NULL UNIQUE,
                project_uuid TEXT NOT NULL,
                agent_uuid TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                tool_calls_json TEXT NOT NULL DEFAULT '[]',
                provider TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            )"#,
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            r#"CREATE TABLE agent_runs (
                uuid TEXT PRIMARY KEY,
                project_uuid TEXT NOT NULL,
                agent_uuid TEXT NOT NULL,
                message_uuid TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL,
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"#,
        )
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn approve_starts_worker_without_caller_agent_uuid() {
        let pool = devforge_database::ephemeral_pg().await;
        schema(&pool).await;
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("devforge-sdd-tool-{n}"));
        std::fs::create_dir_all(&dir).unwrap();
        let project_uuid = "4f82a1a4-5c6f-4696-8941-bfb1d072e8b1";
        sqlx::query(
            r#"INSERT INTO projects (uuid, name, slug, workdir, workspace_uuid, created_at, updated_at)
               VALUES ($1, 'Cheval', 'compteur-cheval', $2, 'autre-equipe', 't', 't')"#,
        )
        .bind(project_uuid)
        .bind(dir.to_string_lossy().as_ref())
        .execute(&pool)
        .await
        .unwrap();

        let tool = SddLoopTool {
            pool: Arc::new(pool.clone()),
        };
        let specified = tool
            .execute(json!({
                "project_uuid": project_uuid,
                "action": "specify",
                "title": "Compteur",
                "description": "Incrémenter un compteur."
            }))
            .await
            .unwrap();
        assert_eq!(specified.get("stop").and_then(|v| v.as_bool()), Some(true));
        let slug = specified["feature"]["slug"].as_str().unwrap();

        // Pas de caller_agent_uuid : l'approve n'est pas un fil agent.
        let approved = tool
            .execute(json!({
                "project_uuid": project_uuid,
                "action": "approve",
                "slug": slug
            }))
            .await
            .unwrap();
        assert_eq!(
            approved.get("ok").and_then(|v| v.as_bool()),
            Some(true),
            "{approved}"
        );
        assert_eq!(
            approved.get("worker_started").and_then(|v| v.as_bool()),
            Some(true)
        );
        assert!(approved.get("caller_agent_uuid").is_none());
        let worker = approved["worker_uuid"].as_str().unwrap();
        assert_eq!(
            sdd::queued_worker(&approved),
            Some((project_uuid.to_string(), worker.to_string()))
        );
        let msg = approved["message"].as_str().unwrap();
        assert!(
            msg.contains("create_project_agent") == false
                || msg.contains("N'appelle pas create_project_agent")
        );
        assert!(msg.contains("dépôt") || msg.contains("pull request"));

        let row: (String, String, Option<String>, String) = sqlx::query_as(
            "SELECT role, kind, parent_agent_uuid, status FROM project_agents WHERE uuid = $1",
        )
        .bind(worker)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.0, "worker");
        assert_eq!(row.1, "subagent");
        assert!(row.2.as_deref().unwrap_or("").len() > 10);
        assert_eq!(row.3, "working");

        let parent_role: (String,) =
            sqlx::query_as("SELECT role FROM project_agents WHERE uuid = $1")
                .bind(row.2.unwrap())
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(parent_role.0, "coordinator");

        let run: (String, String) = sqlx::query_as(
            r#"SELECT r.status, m.content
               FROM agent_runs r
               JOIN agent_messages m ON m.uuid = r.message_uuid
               WHERE r.agent_uuid = $1"#,
        )
        .bind(worker)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(run.0, "pending");
        assert!(run.1.contains(&format!("SDD-IMPLEMENT:{slug}")));
        assert!(run.1.contains("Interdit"));
        assert!(!run.1.contains("create_github"));

        let workers: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM project_agents WHERE project_uuid = $1 AND role = 'worker'",
        )
        .bind(project_uuid)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(workers.0, 1);

        let again = tool
            .execute(json!({
                "project_uuid": project_uuid,
                "action": "approve",
                "slug": slug
            }))
            .await
            .unwrap();
        assert_eq!(
            again.get("worker_started").and_then(|v| v.as_bool()),
            Some(false)
        );
        assert!(sdd::queued_worker(&again).is_none());
        let workers: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM project_agents WHERE project_uuid = $1 AND role = 'worker'",
        )
        .bind(project_uuid)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(workers.0, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
