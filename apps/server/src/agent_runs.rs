//! Tours d'agent persistés. Un redémarrage reprend les runs `running` / `pending`.

use sqlx::SqlitePool;

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
}
