//! Un déploiement à la fois par nœud, et une trace projet (outil, deploy, smoke).
//!
//! Quand un nouveau déploiement démarre pour un projet, les déploiements
//! encore `queued` / `running` / `building` sont annulés (`cancelled`) et leur
//! future tokio est abortée via le registre de cancel.

use serde_json::Value;
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{watch, Mutex, OwnedMutexGuard};

use crate::state::now_str;

/// Résultat du slot nœud : travail terminé, ou annulé (supersede / abort).
#[derive(Debug)]
pub enum SlotOutcome<T> {
    Completed(T),
    Cancelled,
}

impl<T> SlotOutcome<T> {
    pub fn is_cancelled(&self) -> bool {
        matches!(self, Self::Cancelled)
    }
}

#[derive(Clone, Default)]
pub struct DeployQueue {
    slots: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
    /// deployment_uuid → sender (`true` = annulé)
    cancels: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
    /// Sérialise register+supersede par projet (évite que deux starts s'annulent mutuellement).
    project_starts: Arc<Mutex<HashMap<i64, Arc<Mutex<()>>>>>,
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

    /// Enregistre un token d'annulation pour ce déploiement (à appeler juste après l'INSERT).
    /// Verrou court autour de register+supersede pour un projet.
    pub async fn lock_project_start(&self, project_id: i64) -> OwnedMutexGuard<()> {
        let slot = {
            let mut map = self.project_starts.lock().await;
            map.entry(project_id)
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        slot.lock_owned().await
    }

    pub async fn register_cancel(&self, deployment_uuid: &str) -> watch::Receiver<bool> {
        let (tx, rx) = watch::channel(false);
        let mut map = self.cancels.lock().await;
        if let Some(old) = map.insert(deployment_uuid.to_string(), tx) {
            let _ = old.send(true);
        }
        rx
    }

    pub async fn unregister_cancel(&self, deployment_uuid: &str) {
        let mut map = self.cancels.lock().await;
        map.remove(deployment_uuid);
    }

    pub(crate) async fn signal_cancel(&self, deployment_uuid: &str) {
        let map = self.cancels.lock().await;
        if let Some(tx) = map.get(deployment_uuid) {
            let _ = tx.send(true);
        }
    }

    pub(crate) async fn is_cancelled(&self, deployment_uuid: &str) -> bool {
        let map = self.cancels.lock().await;
        map.get(deployment_uuid)
            .map(|tx| *tx.borrow())
            .unwrap_or(false)
    }
}

/// Annule les déploiements encore en cours du projet (sauf `keep_uuid`).
/// Marque `cancelled` en base + signale le token pour abort le travail tokio.
/// Ne touche pas aux déploiements `success` / `failed` / déjà `cancelled`.
pub async fn supersede_in_progress(
    queue: &DeployQueue,
    pool: &PgPool,
    project_id: i64,
    keep_uuid: &str,
) -> Vec<String> {
    let now = now_str();
    let note = format!(
        "\n[devforge] Déploiement annulé : remplacé par {keep_uuid}\n"
    );
    let rows: Vec<(String,)> = sqlx::query_as(
        r#"UPDATE deployments
           SET status = 'cancelled',
               logs = COALESCE(logs, '') || $1,
               error_summary = COALESCE(error_summary, 'Annulé : un déploiement plus récent a été lancé'),
               finished_at = $2,
               updated_at = $3
           WHERE project_id = $4
             AND uuid <> $5
             AND status IN ('queued', 'running', 'building')
           RETURNING uuid"#,
    )
    .bind(&note)
    .bind(&now)
    .bind(&now)
    .bind(project_id)
    .bind(keep_uuid)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    let mut cancelled = Vec::with_capacity(rows.len());
    for (uuid,) in rows {
        queue.signal_cancel(&uuid).await;
        tracing::info!(
            old = %uuid,
            newer = %keep_uuid,
            project_id,
            "Déploiement en cours annulé (supersede)"
        );
        cancelled.push(uuid);
    }
    cancelled
}

async fn wait_cancelled(mut rx: watch::Receiver<bool>) {
    if *rx.borrow() {
        return;
    }
    while rx.changed().await.is_ok() {
        if *rx.borrow() {
            return;
        }
    }
}

/// Attend le nœud, puis marque `running` le temps du travail.
/// La ligne est déjà `queued` (ou déjà claimée `running` par la reprise).
/// On ne repasse pas à `queued` : ça rouvrirrait un claim et lancerait deux builds.
/// Si le déploiement a été supersédé, retourne `Cancelled` sans lancer le build
/// (et abort le future en cours si le signal arrive pendant le travail).
pub async fn run_in_node_slot<T, F, Fut>(
    queue: &DeployQueue,
    pool: &PgPool,
    server_id: &str,
    deployment_uuid: &str,
    work: F,
) -> SlotOutcome<T>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = T>,
{
    let cancel_rx = {
        let map = queue.cancels.lock().await;
        map.get(deployment_uuid).map(|tx| tx.subscribe())
    };

    // Si déjà annulé avant d'obtenir le slot, ne pas bloquer le nœud.
    if queue.is_cancelled(deployment_uuid).await {
        return SlotOutcome::Cancelled;
    }
    if let Some(ref rx) = cancel_rx {
        if *rx.borrow() {
            return SlotOutcome::Cancelled;
        }
    }

    let acquire = queue.acquire(server_id);
    let _guard = if let Some(rx) = cancel_rx.clone() {
        tokio::select! {
            guard = acquire => guard,
            _ = wait_cancelled(rx) => {
                return SlotOutcome::Cancelled;
            }
        }
    } else {
        acquire.await
    };

    // Re-check après acquire (supersede pendant l'attente du nœud).
    if queue.is_cancelled(deployment_uuid).await {
        return SlotOutcome::Cancelled;
    }

    // Ne repasse en running que si encore actif en base (évite d'écraser cancelled).
    let claimed = mark_running_if_active(pool, deployment_uuid).await;
    if !claimed {
        return SlotOutcome::Cancelled;
    }

    let work_fut = work();
    if let Some(rx) = cancel_rx {
        tokio::select! {
            result = work_fut => SlotOutcome::Completed(result),
            _ = wait_cancelled(rx) => SlotOutcome::Cancelled,
        }
    } else {
        SlotOutcome::Completed(work_fut.await)
    }
}

async fn mark_running_if_active(pool: &PgPool, deployment_uuid: &str) -> bool {
    let now = now_str();
    let res = sqlx::query(
        r#"UPDATE deployments SET status = 'running', updated_at = $1
           WHERE uuid = $2 AND status IN ('queued', 'running', 'building')"#,
    )
    .bind(&now)
    .bind(deployment_uuid)
    .execute(pool)
    .await;
    matches!(res, Ok(r) if r.rows_affected() == 1)
}

#[allow(dead_code)]
async fn mark_status(pool: &PgPool, deployment_uuid: &str, status: &str) {
    let now = now_str();
    let _ = sqlx::query("UPDATE deployments SET status = $1, updated_at = $2 WHERE uuid = $3")
        .bind(status)
        .bind(&now)
        .bind(deployment_uuid)
        .execute(pool)
        .await;
}

/// Persiste le résultat seulement si le déploiement n'a pas été supersédé.
pub async fn finalize_if_active(
    pool: &PgPool,
    deployment_uuid: &str,
    status: &str,
    git_sha: &str,
    logs: &str,
    error_summary: Option<&str>,
    error_hint: Option<&str>,
    live_revision_sha: Option<&str>,
) -> bool {
    let now = now_str();
    let res = sqlx::query(
        r#"UPDATE deployments
           SET status = $1,
               git_sha = $2,
               logs = $3,
               error_summary = COALESCE($4, error_summary),
               error_hint = COALESCE($5, error_hint),
               live_revision_sha = COALESCE($6, live_revision_sha),
               finished_at = $7,
               updated_at = $8
           WHERE uuid = $9 AND status IN ('queued', 'running', 'building')"#,
    )
    .bind(status)
    .bind(git_sha)
    .bind(logs)
    .bind(error_summary)
    .bind(error_hint)
    .bind(live_revision_sha)
    .bind(&now)
    .bind(&now)
    .bind(deployment_uuid)
    .execute(pool)
    .await;
    matches!(res, Ok(r) if r.rows_affected() == 1)
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

    #[tokio::test]
    async fn supersede_marks_older_in_progress_cancelled() {
        let pool = devforge_database::ephemeral_pg().await;
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
        for (uuid, status) in [
            ("old-run", "running"),
            ("old-q", "queued"),
            ("keep-ok", "success"),
            ("newer", "queued"),
        ] {
            sqlx::query(
                "INSERT INTO deployments (uuid, project_id, status, logs) VALUES ($1, 7, $2, 'x')",
            )
            .bind(uuid)
            .bind(status)
            .execute(&pool)
            .await
            .unwrap();
        }

        let queue = DeployQueue::new();
        let _rx = queue.register_cancel("old-run").await;
        let mut cancelled = supersede_in_progress(&queue, &pool, 7, "newer").await;
        cancelled.sort();
        assert_eq!(cancelled, vec!["old-q".to_string(), "old-run".to_string()]);
        assert!(queue.is_cancelled("old-run").await);

        let rows: Vec<(String, String)> =
            sqlx::query_as("SELECT uuid, status FROM deployments ORDER BY uuid")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            rows,
            vec![
                ("keep-ok".into(), "success".into()),
                ("newer".into(), "queued".into()),
                ("old-q".into(), "cancelled".into()),
                ("old-run".into(), "cancelled".into()),
            ]
        );
    }

    #[tokio::test]
    async fn run_slot_returns_cancelled_when_signaled() {
        let pool = devforge_database::ephemeral_pg().await;
        sqlx::query(
            r#"CREATE TABLE deployments (
                uuid TEXT PRIMARY KEY,
                project_id BIGINT NOT NULL,
                status TEXT NOT NULL,
                logs TEXT,
                updated_at TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO deployments (uuid, project_id, status, logs) VALUES ('dep-c', 1, 'queued', '')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let queue = DeployQueue::new();
        let _rx = queue.register_cancel("dep-c").await;
        queue.signal_cancel("dep-c").await;

        let outcome = run_in_node_slot(&queue, &pool, "node-a", "dep-c", || async {
            "should-not-run"
        })
        .await;
        assert!(outcome.is_cancelled());
    }
}
