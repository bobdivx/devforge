//! Un déploiement à la fois par nœud, et une trace projet (outil, deploy, smoke).

use serde_json::Value;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{Mutex, OwnedMutexGuard};

use crate::state::now_str;

#[derive(Clone, Default)]
pub struct DeployQueue {
    slots: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

impl DeployQueue {
    pub fn new() -> Self {
        Self::default()
    }

    /// Bloque tant qu'un autre déploiement tient le nœud.
    pub async fn acquire(&self, server_id: &str) -> OwnedMutexGuard<()> {
        let key = {
            let trimmed = server_id.trim();
            if trimmed.is_empty() {
                "default".to_string()
            } else {
                trimmed.to_string()
            }
        };
        let slot = {
            let mut map = self.slots.lock().await;
            map.entry(key)
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        slot.lock_owned().await
    }
}

/// Passe le déploiement en file, attend le nœud, puis le marque `running` le temps du travail.
pub async fn run_in_node_slot<T, F, Fut>(
    queue: &DeployQueue,
    pool: &SqlitePool,
    server_id: &str,
    deployment_uuid: &str,
    work: F,
) -> T
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = T>,
{
    mark_status(pool, deployment_uuid, "queued").await;
    let _guard = queue.acquire(server_id).await;
    mark_status(pool, deployment_uuid, "running").await;
    work().await
}

async fn mark_status(pool: &SqlitePool, deployment_uuid: &str, status: &str) {
    let now = now_str();
    let _ = sqlx::query("UPDATE deployments SET status = ?, updated_at = ? WHERE uuid = ?")
        .bind(status)
        .bind(&now)
        .bind(deployment_uuid)
        .execute(pool)
        .await;
}

/// Un redémarrage coupe les requêtes qui tenaient la file. Ces lignes resteraient
/// `queued` ou `running` pour toujours : on les clôt pour que l'utilisateur puisse relancer.
pub async fn recover_interrupted_deploys(pool: &SqlitePool) -> Result<u64, sqlx::Error> {
    let rows: Vec<(String, i64, String)> = sqlx::query_as(
        r#"SELECT d.uuid, d.project_id, p.uuid
           FROM deployments d
           JOIN projects p ON p.id = d.project_id
           WHERE d.status IN ('queued', 'running', 'building')"#,
    )
    .fetch_all(pool)
    .await?;
    if rows.is_empty() {
        return Ok(0);
    }
    let now = now_str();
    let note = "\n[devforge] interrompu par un redémarrage. Relance le déploiement.\n";
    for (uuid, project_id, project_uuid) in &rows {
        sqlx::query(
            r#"UPDATE deployments
               SET status = 'failed',
                   logs = COALESCE(logs, '') || ?,
                   error_summary = ?,
                   error_hint = ?,
                   finished_at = ?,
                   updated_at = ?
               WHERE uuid = ? AND status IN ('queued', 'running', 'building')"#,
        )
        .bind(note)
        .bind("Interrompu par un redémarrage")
        .bind("Relance le déploiement depuis le projet.")
        .bind(&now)
        .bind(&now)
        .bind(uuid)
        .execute(pool)
        .await?;
        sqlx::query(
            "UPDATE projects SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'deploying'",
        )
        .bind(&now)
        .bind(project_id)
        .execute(pool)
        .await?;
        record_event(
            pool,
            project_uuid,
            "deploy",
            "failed",
            uuid,
            "interrompu par un redémarrage",
        )
        .await;
    }
    tracing::warn!(count = rows.len(), "déploiements interrompus clos après redémarrage");
    Ok(rows.len() as u64)
}

pub async fn record_event(
    pool: &SqlitePool,
    project_uuid: &str,
    kind: &str,
    status: &str,
    ref_id: &str,
    detail: &str,
) {
    let now = now_str();
    let detail: String = detail.chars().take(240).collect();
    let _ = sqlx::query(
        r#"INSERT INTO builder_events (project_uuid, kind, status, ref_id, detail, created_at)
           VALUES (?, ?, ?, ?, ?, ?)"#,
    )
    .bind(project_uuid)
    .bind(kind)
    .bind(status)
    .bind(ref_id)
    .bind(&detail)
    .bind(&now)
    .execute(pool)
    .await;
}

/// Extrait de la réponse agent les outils qui relient le tour au déploiement et au smoke.
pub async fn record_tool_trace(pool: &SqlitePool, project_uuid: &str, tools_json: &str) {
    let Ok(calls) = serde_json::from_str::<Vec<Value>>(tools_json) else {
        return;
    };
    for call in calls {
        let name = call.get("name").and_then(|v| v.as_str()).unwrap_or("");
        if !matches!(
            name,
            "trigger_deploy" | "http_smoke" | "write_project_file" | "get_deployment_logs"
        ) {
            continue;
        }
        let result = call.get("result");
        let ok = result
            .and_then(|r| r.get("ok"))
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let ref_id = result
            .and_then(|r| {
                r.get("deployment_uuid")
                    .or_else(|| r.get("url"))
                    .or_else(|| r.get("path"))
            })
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let detail = result
            .and_then(|r| {
                r.get("message")
                    .or_else(|| r.get("error"))
                    .or_else(|| r.get("excerpt"))
                    .or_else(|| r.get("url"))
            })
            .and_then(|v| v.as_str())
            .unwrap_or(name);
        record_event(
            pool,
            project_uuid,
            name,
            if ok { "ok" } else { "failed" },
            ref_id,
            detail,
        )
        .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::sync::Notify;

    #[tokio::test]
    async fn second_deploy_on_the_same_node_waits() {
        let queue = DeployQueue::new();
        let _hold = queue.acquire("node-a").await;
        let entered = Arc::new(Notify::new());
        let entered2 = entered.clone();
        let queue2 = queue.clone();
        let waiter = tokio::spawn(async move {
            entered2.notify_one();
            let _guard = queue2.acquire("node-a").await;
            "done"
        });
        entered.notified().await;
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        assert!(!waiter.is_finished());
        drop(_hold);
        assert_eq!(waiter.await.unwrap(), "done");
    }

    #[tokio::test]
    async fn other_node_is_not_blocked() {
        let queue = DeployQueue::new();
        let _hold = queue.acquire("node-a").await;
        let _other = queue.acquire("node-b").await;
    }

    #[tokio::test]
    async fn tool_trace_keeps_deploy_and_smoke() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            r#"CREATE TABLE builder_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_uuid TEXT NOT NULL,
                kind TEXT NOT NULL,
                status TEXT NOT NULL,
                ref_id TEXT,
                detail TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        record_tool_trace(
            &pool,
            "proj",
            r#"[{"name":"write_project_file","result":{"ok":true,"path":"src/a.ts","message":"écrit"}},{"name":"trigger_deploy","result":{"ok":true,"deployment_uuid":"dep-1","message":"ok"}},{"name":"http_smoke","result":{"ok":true,"url":"http://127.0.0.1/","excerpt":"devforge"}},{"name":"list_projects","result":{"ok":true}}]"#,
        )
        .await;
        let n: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM builder_events")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n.0, 3);
        let kinds: Vec<(String,)> =
            sqlx::query_as("SELECT kind FROM builder_events ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            kinds.into_iter().map(|k| k.0).collect::<Vec<_>>(),
            vec!["write_project_file", "trigger_deploy", "http_smoke"]
        );
    }

    #[tokio::test]
    async fn restart_closes_queued_and_running_deploys() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(
            r#"CREATE TABLE projects (
                id INTEGER PRIMARY KEY,
                uuid TEXT NOT NULL,
                status TEXT NOT NULL,
                updated_at TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"CREATE TABLE deployments (
                uuid TEXT PRIMARY KEY,
                project_id INTEGER NOT NULL,
                status TEXT NOT NULL,
                logs TEXT,
                error_summary TEXT,
                error_hint TEXT,
                finished_at TEXT,
                updated_at TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"CREATE TABLE builder_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_uuid TEXT NOT NULL,
                kind TEXT NOT NULL,
                status TEXT NOT NULL,
                ref_id TEXT,
                detail TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO projects (id, uuid, status) VALUES (1, 'proj', 'deploying')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO deployments (uuid, project_id, status, logs) VALUES ('dep-q', 1, 'queued', '')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO deployments (uuid, project_id, status, logs) VALUES ('dep-r', 1, 'running', 'build')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO deployments (uuid, project_id, status, logs) VALUES ('dep-ok', 1, 'success', 'ok')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let n = recover_interrupted_deploys(&pool).await.unwrap();
        assert_eq!(n, 2);
        let left: Vec<(String, String)> =
            sqlx::query_as("SELECT uuid, status FROM deployments ORDER BY uuid")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            left,
            vec![
                ("dep-ok".into(), "success".into()),
                ("dep-q".into(), "failed".into()),
                ("dep-r".into(), "failed".into()),
            ]
        );
        let project: (String,) = sqlx::query_as("SELECT status FROM projects WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(project.0, "failed");
    }
}
