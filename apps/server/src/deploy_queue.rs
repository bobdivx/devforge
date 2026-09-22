//! Un déploiement à la fois par nœud, et une trace projet (outil, deploy, smoke).

use serde_json::Value;
use sqlx::PgPool;
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

/// Attend le nœud, puis marque `running` le temps du travail.
/// La ligne est déjà `queued` (ou déjà claimée `running` par la reprise).
/// On ne repasse pas à `queued` : ça rouvrirrait un claim et lancerait deux builds.
pub async fn run_in_node_slot<T, F, Fut>(
    queue: &DeployQueue,
    pool: &PgPool,
    server_id: &str,
    deployment_uuid: &str,
    work: F,
) -> T
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = T>,
{
    let _guard = queue.acquire(server_id).await;
    mark_status(pool, deployment_uuid, "running").await;
    work().await
}

async fn mark_status(pool: &PgPool, deployment_uuid: &str, status: &str) {
    let now = now_str();
    let _ = sqlx::query("UPDATE deployments SET status = $1, updated_at = $2 WHERE uuid = $3")
        .bind(status)
        .bind(&now)
        .bind(deployment_uuid)
        .execute(pool)
        .await;
}

/// Un build coupé par l’arrêt du processus redevient `queued`.
/// La ligne SQLite est la file : le leader la reprend au boot.
pub async fn requeue_interrupted(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let now = now_str();
    let note = "\n[devforge] repris après un redémarrage.\n";
    let res = sqlx::query(
        r#"UPDATE deployments
           SET status = 'queued',
               logs = COALESCE(logs, '') || $1,
               finished_at = NULL,
               updated_at = $2
           WHERE status IN ('running', 'building')"#,
    )
    .bind(note)
    .bind(&now)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

pub async fn list_queued_deployments(pool: &PgPool) -> Result<Vec<String>, sqlx::Error> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT uuid FROM deployments WHERE status = 'queued' ORDER BY created_at, uuid",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(u,)| u).collect())
}

/// Un seul processus gagne la ligne. Le second appel laisse le build déjà pris.
pub async fn try_claim_deployment(
    pool: &PgPool,
    deployment_uuid: &str,
) -> Result<bool, sqlx::Error> {
    let now = now_str();
    let res = sqlx::query(
        "UPDATE deployments SET status = 'running', updated_at = $1 WHERE uuid = $2 AND status = 'queued'",
    )
    .bind(&now)
    .bind(deployment_uuid)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() == 1)
}

pub async fn record_event(
    pool: &PgPool,
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
           VALUES ($1, $2, $3, $4, $5, $6)"#,
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
pub async fn record_tool_trace(pool: &PgPool, project_uuid: &str, tools_json: &str) {
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
        let pool = devforge_database::ephemeral_pg().await;
        sqlx::query(
            r#"CREATE TABLE builder_events (
                id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
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
        let kinds: Vec<(String,)> = sqlx::query_as("SELECT kind FROM builder_events ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(
            kinds.into_iter().map(|k| k.0).collect::<Vec<_>>(),
            vec!["write_project_file", "trigger_deploy", "http_smoke"]
        );
    }

    #[tokio::test]
    async fn restart_requeues_running_and_claims_once() {
        let pool = devforge_database::ephemeral_pg().await;
        sqlx::query(
            r#"CREATE TABLE projects (
                id BIGINT PRIMARY KEY,
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
                project_id BIGINT NOT NULL,
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
                id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
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

        let n = requeue_interrupted(&pool).await.unwrap();
        assert_eq!(n, 1);
        let left: Vec<(String, String)> =
            sqlx::query_as("SELECT uuid, status FROM deployments ORDER BY uuid")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            left,
            vec![
                ("dep-ok".into(), "success".into()),
                ("dep-q".into(), "queued".into()),
                ("dep-r".into(), "queued".into()),
            ]
        );
        let project: (String,) = sqlx::query_as("SELECT status FROM projects WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(project.0, "deploying");
        assert!(try_claim_deployment(&pool, "dep-q").await.unwrap());
        assert!(!try_claim_deployment(&pool, "dep-q").await.unwrap());
    }
}
