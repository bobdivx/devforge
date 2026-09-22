//! Tours d'agent persistés. Un redémarrage reprend les runs `running` / `pending`.

use serde_json::Value;
use sqlx::SqlitePool;

/// Marqueur du tour automatique quand la preview publique est rouge.
pub const PREVIEW_REPAIR_PREFIX: &str = "[réparation preview]";

use crate::state::{new_uuid, now_str};

#[derive(Debug, Clone)]
pub struct RunRow {
    pub uuid: String,
    pub project_uuid: String,
    pub agent_uuid: String,
    pub message_uuid: String,
    pub content: String,
}

pub async fn record_user_turn(
    pool: &SqlitePool,
    project_uuid: &str,
    agent_uuid: &str,
    content: &str,
) -> Result<String, String> {
    let message_uuid = new_uuid();
    let now = now_str();
    sqlx::query(
        r#"INSERT INTO agent_messages (
            uuid, project_uuid, agent_uuid, role, content, tool_calls_json, provider, created_at
        ) VALUES (?, ?, ?, 'user', ?, '[]', '', ?)"#,
    )
    .bind(&message_uuid)
    .bind(project_uuid)
    .bind(agent_uuid)
    .bind(content)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    let _ = sqlx::query(
        "UPDATE project_agents SET status = 'working', updated_at = ? WHERE uuid = ?",
    )
    .bind(&now)
    .bind(agent_uuid)
    .execute(pool)
    .await;
    enqueue(pool, project_uuid, agent_uuid, &message_uuid).await
}

/// Idempotent sur `message_uuid` : le message utilisateur existe déjà.
pub async fn enqueue(
    pool: &SqlitePool,
    project_uuid: &str,
    agent_uuid: &str,
    message_uuid: &str,
) -> Result<String, String> {
    if let Some((uuid,)) = sqlx::query_as::<_, (String,)>(
        "SELECT uuid FROM agent_runs WHERE message_uuid = ?",
    )
    .bind(message_uuid)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?
    {
        return Ok(uuid);
    }
    let uuid = new_uuid();
    let now = now_str();
    sqlx::query(
        r#"INSERT INTO agent_runs (
            uuid, project_uuid, agent_uuid, message_uuid, status, error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'pending', NULL, ?, ?)"#,
    )
    .bind(&uuid)
    .bind(project_uuid)
    .bind(agent_uuid)
    .bind(message_uuid)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(uuid)
}

pub async fn try_claim(pool: &SqlitePool, run_uuid: &str) -> Result<bool, sqlx::Error> {
    let now = now_str();
    let res = sqlx::query(
        "UPDATE agent_runs SET status = 'running', updated_at = ?, error = NULL WHERE uuid = ? AND status = 'pending'",
    )
    .bind(&now)
    .bind(run_uuid)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() == 1)
}

/// Au boot, un `running` est un tour coupé par l'arrêt du processus.
pub async fn reopen_interrupted(pool: &SqlitePool) -> Result<u64, sqlx::Error> {
    let now = now_str();
    let res = sqlx::query(
        "UPDATE agent_runs SET status = 'pending', updated_at = ? WHERE status = 'running'",
    )
    .bind(&now)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

pub async fn list_pending(pool: &SqlitePool) -> Result<Vec<RunRow>, sqlx::Error> {
    let rows = sqlx::query_as::<_, (String, String, String, String, String)>(
        r#"SELECT r.uuid, r.project_uuid, r.agent_uuid, r.message_uuid, m.content
           FROM agent_runs r
           JOIN agent_messages m ON m.uuid = r.message_uuid
           WHERE r.status = 'pending'
           ORDER BY r.created_at ASC
           LIMIT 20"#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(uuid, project_uuid, agent_uuid, message_uuid, content)| RunRow {
            uuid,
            project_uuid,
            agent_uuid,
            message_uuid,
            content,
        })
        .collect())
}

pub async fn assistant_already_replied(
    pool: &SqlitePool,
    agent_uuid: &str,
    message_uuid: &str,
) -> Result<bool, sqlx::Error> {
    let row: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*) FROM agent_messages
           WHERE agent_uuid = ? AND role = 'assistant'
             AND id > COALESCE((SELECT id FROM agent_messages WHERE uuid = ?), 0)"#,
    )
    .bind(agent_uuid)
    .bind(message_uuid)
    .fetch_one(pool)
    .await?;
    Ok(row.0 > 0)
}

pub async fn save_assistant_and_finish(
    pool: &SqlitePool,
    run_uuid: &str,
    project_uuid: &str,
    agent_uuid: &str,
    reply: &str,
    tools_json: &str,
    provider: &str,
) -> Result<(), sqlx::Error> {
    let now = now_str();
    sqlx::query(
        r#"INSERT INTO agent_messages (
            uuid, project_uuid, agent_uuid, role, content, tool_calls_json, provider, created_at
        ) VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?)"#,
    )
    .bind(new_uuid())
    .bind(project_uuid)
    .bind(agent_uuid)
    .bind(reply)
    .bind(tools_json)
    .bind(provider)
    .bind(&now)
    .execute(pool)
    .await?;
    crate::deploy_queue::record_tool_trace(pool, project_uuid, tools_json).await;
    finish(pool, run_uuid, "completed", None).await?;
    let _ = sqlx::query(
        "UPDATE project_agents SET status = 'idle', updated_at = ? WHERE uuid = ?",
    )
    .bind(&now)
    .bind(agent_uuid)
    .execute(pool)
    .await;
    Ok(())
}

pub async fn fail_run(pool: &SqlitePool, run_uuid: &str, agent_uuid: &str, error: &str) {
    let now = now_str();
    let _ = finish(pool, run_uuid, "failed", Some(error)).await;
    let _ = sqlx::query(
        "UPDATE project_agents SET status = 'idle', updated_at = ? WHERE uuid = ?",
    )
    .bind(&now)
    .bind(agent_uuid)
    .execute(pool)
    .await;
}

/// Derniers messages, avec un extrait des outils sur les réponses assistant.
pub async fn recent_history(
    pool: &SqlitePool,
    agent_uuid: &str,
) -> Vec<(String, String)> {
    let Ok(rows) = sqlx::query_as::<_, (String, String, String)>(
        r#"SELECT role, content, COALESCE(tool_calls_json, '[]')
           FROM agent_messages WHERE agent_uuid = ? ORDER BY id DESC LIMIT 20"#,
    )
    .bind(agent_uuid)
    .fetch_all(pool)
    .await
    else {
        return Vec::new();
    };
    let mut hist = rows;
    hist.reverse();
    hist.into_iter()
        .map(|(role, content, tools)| {
            let content = if role == "assistant" {
                assistant_content_with_tools(&content, &tools)
            } else {
                content
            };
            (role, content)
        })
        .collect()
}

/// Ajoute au texte assistant les fichiers touchés, l'erreur et les logs utiles.
pub fn assistant_content_with_tools(content: &str, tools_json: &str) -> String {
    let excerpt = tool_excerpt(tools_json);
    if excerpt.is_empty() {
        content.to_string()
    } else {
        format!("{content}\n\n[outils]\n{excerpt}")
    }
}

/// Un seul correctif auto par demande. Rien si l'utilisateur doit agir (domaine, secret).
pub fn preview_repair_prompt(user_message: &str, tools_json: &str) -> Option<String> {
    if user_message.trim_start().starts_with(PREVIEW_REPAIR_PREFIX) {
        return None;
    }
    let calls: Vec<Value> = serde_json::from_str(tools_json).ok()?;
    let last = calls.iter().rev().find(|call| {
        call.get("name").and_then(|v| v.as_str()) == Some("start_local_preview")
    })?;
    let result = last.get("result")?;
    if result.get("needs_user_action").and_then(|v| v.as_bool()) == Some(true) {
        return None;
    }
    let public_ok = result.get("public_ok").and_then(|v| v.as_bool());
    let ok = result.get("ok").and_then(|v| v.as_bool()).unwrap_or(true);
    if public_ok == Some(true) || (public_ok.is_none() && ok) {
        return None;
    }
    let err = result.get("error").and_then(|v| v.as_str()).unwrap_or("");
    let lower = err.to_lowercase();
    if lower.contains("wildcard") || lower.contains("domaine") {
        return None;
    }
    let logs = result
        .get("logs_tail")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    Some(format!(
        "{PREVIEW_REPAIR_PREFIX}\nLa preview n’est pas joignable. Corrige les fichiers en local puis relance start_local_preview avec force=true.\nErreur : {}\nLogs : {}",
        clip(err, 400),
        clip(logs, 800),
    ))
}

fn tool_excerpt(tools_json: &str) -> String {
    let Ok(calls) = serde_json::from_str::<Vec<Value>>(tools_json) else {
        return String::new();
    };
    let start = calls.len().saturating_sub(6);
    let mut lines = Vec::new();
    for call in calls.iter().skip(start) {
        let name = call.get("name").and_then(|v| v.as_str()).unwrap_or("tool");
        let args = call.get("arguments");
        let result = call.get("result");
        let path = args
            .and_then(|a| a.get("path"))
            .and_then(|v| v.as_str())
            .or_else(|| result.and_then(|r| r.get("path")).and_then(|v| v.as_str()))
            .unwrap_or("");
        let command = args
            .and_then(|a| a.get("command"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let ok = result.and_then(|r| r.get("ok")).and_then(|v| v.as_bool());
        let public_ok = result.and_then(|r| r.get("public_ok")).and_then(|v| v.as_bool());
        let err = result
            .and_then(|r| r.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let mut line = format!("- {name}");
        if !path.is_empty() {
            line.push_str(&format!(" path={path}"));
        }
        if !command.is_empty() {
            line.push_str(&format!(" cmd={}", clip(command, 80)));
        }
        if let Some(ok) = ok {
            line.push_str(&format!(" ok={ok}"));
        }
        if let Some(public_ok) = public_ok {
            line.push_str(&format!(" public_ok={public_ok}"));
        }
        if !err.is_empty() {
            line.push_str(&format!(" error={}", clip(err, 180)));
        }
        let failed = ok == Some(false) || public_ok == Some(false);
        if failed {
            let logs = result
                .and_then(|r| r.get("logs_tail"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    result
                        .and_then(|r| r.get("stderr"))
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                });
            if let Some(logs) = logs {
                line.push_str(&format!("\n  logs: {}", clip(logs, 400)));
            }
        }
        lines.push(line);
    }
    clip(&lines.join("\n"), 2400)
}

fn clip(s: &str, max: usize) -> String {
    let count = s.chars().count();
    if count <= max {
        s.to_string()
    } else {
        let t: String = s.chars().take(max).collect();
        format!("{t}…")
    }
}

pub async fn finish(
    pool: &SqlitePool,
    run_uuid: &str,
    status: &str,
    error: Option<&str>,
) -> Result<(), sqlx::Error> {
    let now = now_str();
    sqlx::query(
        "UPDATE agent_runs SET status = ?, error = ?, updated_at = ? WHERE uuid = ?",
    )
    .bind(status)
    .bind(error)
    .bind(&now)
    .bind(run_uuid)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            r#"CREATE TABLE agent_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        .execute(&pool)
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
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"CREATE TABLE project_agents (
                uuid TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO project_agents (uuid, status, updated_at) VALUES ('agent-1', 'idle', 't')",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    #[tokio::test]
    async fn interrupted_run_is_pending_again_and_claim_is_once() {
        let pool = pool().await;
        let run = record_user_turn(&pool, "proj", "agent-1", "scaffold ce projet")
            .await
            .unwrap();
        assert!(try_claim(&pool, &run).await.unwrap());
        assert!(!try_claim(&pool, &run).await.unwrap());
        let n = reopen_interrupted(&pool).await.unwrap();
        assert_eq!(n, 1);
        let pending = list_pending(&pool).await.unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].content, "scaffold ce projet");
        assert!(try_claim(&pool, &run).await.unwrap());
    }

    #[tokio::test]
    async fn enqueue_is_idempotent_per_message() {
        let pool = pool().await;
        let run = record_user_turn(&pool, "proj", "agent-1", "hello").await.unwrap();
        let msg: (String,) =
            sqlx::query_as("SELECT message_uuid FROM agent_runs WHERE uuid = ?")
                .bind(&run)
                .fetch_one(&pool)
                .await
                .unwrap();
        let again = enqueue(&pool, "proj", "agent-1", &msg.0).await.unwrap();
        assert_eq!(run, again);
    }

    #[test]
    fn history_keeps_failed_command_and_file() {
        let tools = r#"[{"name":"write_project_file","arguments":{"path":"src/pages/index.astro"},"result":{"ok":true}},{"name":"run_workdir_command","arguments":{"command":"npm run build"},"result":{"ok":false,"error":"exit 1","stderr":"Cannot find module"}}]"#;
        let text = assistant_content_with_tools("J'ai modifié la page.", tools);
        assert!(text.contains("src/pages/index.astro"));
        assert!(text.contains("npm run build"));
        assert!(text.contains("Cannot find module"));
    }

    #[test]
    fn preview_repair_runs_once_and_skips_a_green_preview() {
        let red = r#"[{"name":"start_local_preview","arguments":{},"result":{"ok":false,"public_ok":false,"error":"URL publique KO","logs_tail":"Error: astro"}}]"#;
        let prompt = preview_repair_prompt("améliore la page", red).unwrap();
        assert!(prompt.starts_with(PREVIEW_REPAIR_PREFIX));
        assert!(prompt.contains("astro"));
        assert!(preview_repair_prompt(&prompt, red).is_none());
        let green = r#"[{"name":"start_local_preview","arguments":{},"result":{"ok":true,"public_ok":true}}]"#;
        assert!(preview_repair_prompt("go", green).is_none());
        let domain = r#"[{"name":"start_local_preview","arguments":{},"result":{"ok":false,"error":"Domaine wildcard manquant"}}]"#;
        assert!(preview_repair_prompt("go", domain).is_none());
    }
}
