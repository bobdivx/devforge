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

fn slot_key(server_id: &str) -> String {
    let trimmed = server_id.trim();
    if trimmed.is_empty() {
        "default".to_string()
    } else {
        trimmed.to_string()
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
        let key = slot_key(server_id);
        let slot = {
            let mut map = self.slots.lock().await;
            map.entry(key)
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        slot.lock_owned().await
    }

    /// Vrai si un déploiement tient déjà le slot de ce nœud (sans le prendre).
    pub async fn is_busy(&self, server_id: &str) -> bool {
        let key = slot_key(server_id);
        let slot = {
            let map = self.slots.lock().await;
            map.get(&key).cloned()
        };
        slot.is_some_and(|m| m.try_lock().is_err())
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

    /// Vrai si une tâche vivante tient ce déploiement (son receiver d'annulation existe).
    /// Un future droppé (timeout client/MCP) libère son receiver → plus « vivant ».
    pub async fn has_live_task(&self, deployment_uuid: &str) -> bool {
        let map = self.cancels.lock().await;
        map.get(deployment_uuid)
            .is_some_and(|tx| tx.receiver_count() > 0)
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
    let note = format!("\n[devforge] Déploiement annulé : remplacé par {keep_uuid}\n");
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
             -- Prod et dev ne s'annulent pas entre eux.
             AND environment = COALESCE(
               (SELECT environment FROM deployments WHERE uuid = $5),
               'production'
             )
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

/// Annule un déploiement précis encore en cours (queued / running / building / pending).
/// Marque `cancelled` en base + signale le token watch. Ne touche pas au conteneur
/// de production : l’appelant peut enchaîner `abort_in_flight_swap` (conteneur `-new` seul).
/// Retourne `true` si la ligne a bien été annulée, `false` si déjà terminale / absente.
pub async fn cancel_one_deployment(
    queue: &DeployQueue,
    pool: &PgPool,
    deployment_uuid: &str,
) -> Result<bool, sqlx::Error> {
    let now = now_str();
    let note = "\n[devforge] Déploiement annulé par l'utilisateur\n";
    let row: Option<(i64,)> = sqlx::query_as(
        r#"UPDATE deployments
           SET status = 'cancelled',
               logs = COALESCE(logs, '') || $1,
               error_summary = COALESCE(error_summary, 'Annulé par l''utilisateur'),
               finished_at = $2,
               updated_at = $3
           WHERE uuid = $4
             AND status IN ('queued', 'running', 'building', 'pending', 'deploying')
           RETURNING project_id"#,
    )
    .bind(note)
    .bind(&now)
    .bind(&now)
    .bind(deployment_uuid)
    .fetch_optional(pool)
    .await?;

    let Some((project_id,)) = row else {
        return Ok(false);
    };

    queue.signal_cancel(deployment_uuid).await;
    tracing::info!(
        deployment = %deployment_uuid,
        project_id,
        "Déploiement annulé par l'utilisateur"
    );

    recompute_project_status_after_deploy_change(pool, project_id).await?;

    Ok(true)
}

/// Recalcule `projects.status` après cancel / dismiss / delete.
/// Si un succès prod existe → `live` (même avec des échecs plus récents acquittés).
pub async fn recompute_project_status_after_deploy_change(
    pool: &PgPool,
    project_id: i64,
) -> Result<(), sqlx::Error> {
    let now = now_str();
    let active: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*) FROM deployments
           WHERE project_id = $1
             AND environment = 'production'
             AND status IN ('queued', 'running', 'building', 'pending', 'deploying')"#,
    )
    .bind(project_id)
    .fetch_one(pool)
    .await
    .unwrap_or((0,));

    if active.0 > 0 {
        let _ =
            sqlx::query("UPDATE projects SET status = 'deploying', updated_at = $1 WHERE id = $2")
                .bind(&now)
                .bind(project_id)
                .execute(pool)
                .await;
        return Ok(());
    }

    let has_success: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*) FROM deployments
           WHERE project_id = $1 AND environment = 'production'
             AND status IN ('success', 'deployed', 'ok')"#,
    )
    .bind(project_id)
    .fetch_one(pool)
    .await
    .unwrap_or((0,));
    let open_failed: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*) FROM deployments
           WHERE project_id = $1 AND environment = 'production'
             AND status IN ('failed', 'error')
             AND (dismissed_at IS NULL OR dismissed_at = '')"#,
    )
    .bind(project_id)
    .fetch_one(pool)
    .await
    .unwrap_or((0,));
    let project_status = if has_success.0 > 0 {
        "live"
    } else if open_failed.0 > 0 {
        "failed"
    } else {
        "idle"
    };
    let _ = sqlx::query("UPDATE projects SET status = $1, updated_at = $2 WHERE id = $3")
        .bind(project_status)
        .bind(&now)
        .bind(project_id)
        .execute(pool)
        .await;
    Ok(())
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

    // Slot occupé : on le dit dans les logs du déploiement en file (sinon « queued » muet).
    if queue.is_busy(server_id).await {
        note_waiting_for_node(pool, server_id, deployment_uuid).await;
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

/// Ajoute aux logs d'un déploiement encore `queued` qu'il attend le slot du nœud,
/// avec le déploiement qui l'occupe quand on peut l'identifier.
async fn note_waiting_for_node(pool: &PgPool, server_id: &str, deployment_uuid: &str) {
    let holder: Option<(String, String, String)> = sqlx::query_as(
        r#"SELECT p.name, d.environment, d.uuid
             FROM deployments d JOIN projects p ON p.id = d.project_id
            WHERE d.status IN ('running', 'building')
              AND d.uuid <> $1
              AND COALESCE(NULLIF(TRIM(p.server_id), ''), 'default') = $2
            ORDER BY d.updated_at DESC
            LIMIT 1"#,
    )
    .bind(deployment_uuid)
    .bind(slot_key(server_id))
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    let note = waiting_note(&slot_key(server_id), holder.as_ref());
    let _ = sqlx::query(
        r#"UPDATE deployments SET logs = COALESCE(logs, '') || $1
            WHERE uuid = $2 AND status = 'queued'"#,
    )
    .bind(&note)
    .bind(deployment_uuid)
    .execute(pool)
    .await;
}

pub(crate) fn waiting_note(server: &str, holder: Option<&(String, String, String)>) -> String {
    match holder {
        Some((name, env, uuid)) => format!(
            "[devforge] en attente du nœud « {server} » : occupé par {name} ({env}, {}) — un seul build à la fois par nœud.\n",
            uuid.chars().take(8).collect::<String>()
        ),
        None => format!(
            "[devforge] en attente du nœud « {server} » : un autre déploiement est en cours — un seul build à la fois par nœud.\n"
        ),
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

/// Met à jour les logs d’un déploiement encore actif (poll UI live).
/// No-op si déjà terminal (`success` / `failed` / `cancelled`).
pub async fn set_live_logs(pool: &PgPool, deployment_uuid: &str, logs: &str) {
    let now = now_str();
    let _ = sqlx::query(
        r#"UPDATE deployments
           SET logs = $1, updated_at = $2
           WHERE uuid = $3
             AND status IN ('queued', 'running', 'building', 'pending', 'deploying')"#,
    )
    .bind(logs)
    .bind(&now)
    .bind(deployment_uuid)
    .execute(pool)
    .await;
}

/// Hook + tâche de flush debouncé (~400 ms) vers la base.
/// Dropper le dernier `Arc` du hook ferme le canal ; la tâche sort ensuite.
/// Appeler `abort()` sur le `JoinHandle` après `finalize` est sûr (les logs finaux
/// sont déjà écrits par `finalize_if_active`).
pub fn spawn_live_log_flusher(
    pool: PgPool,
    deployment_uuid: String,
) -> (devforge_deploy::DeployLogHook, tokio::task::JoinHandle<()>) {
    let (tx, mut rx) = watch::channel(String::new());
    let handle = tokio::spawn(async move {
        loop {
            if rx.changed().await.is_err() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
            let logs = rx.borrow_and_update().clone();
            if !logs.is_empty() {
                set_live_logs(&pool, &deployment_uuid, &logs).await;
            }
        }
    });
    let hook: devforge_deploy::DeployLogHook = Arc::new(move |logs: &str| {
        let _ = tx.send(logs.to_string());
    });
    (hook, handle)
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

/// Déploiements actifs sans tâche vivante depuis plus de `older_than` → `failed`.
/// Évite les lignes bloquées en « running » à vie (future droppé, crash de tâche).
pub async fn reap_orphans(queue: &DeployQueue, pool: &PgPool, older_than: chrono::Duration) -> u64 {
    let cutoff = (chrono::Utc::now() - older_than).to_rfc3339();
    let rows: Vec<(String, i64)> = sqlx::query_as(
        r#"SELECT uuid, project_id FROM deployments
           WHERE status IN ('queued', 'running', 'building')
             AND updated_at < $1"#,
    )
    .bind(&cutoff)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let mut reaped = 0u64;
    for (uuid, project_id) in rows {
        if queue.has_live_task(&uuid).await {
            continue;
        }
        let now = now_str();
        let res = sqlx::query(
            r#"UPDATE deployments
               SET status = 'failed',
                   logs = COALESCE(logs, '') || $1,
                   error_summary = COALESCE(error_summary, 'Déploiement interrompu : aucune tâche active'),
                   finished_at = $2,
                   updated_at = $2
               WHERE uuid = $3 AND status IN ('queued', 'running', 'building')"#,
        )
        .bind("\n[devforge] déploiement interrompu (aucune tâche active) — marqué en échec.\n")
        .bind(&now)
        .bind(&uuid)
        .execute(pool)
        .await;
        if !matches!(res, Ok(r) if r.rows_affected() == 1) {
            continue;
        }
        reaped += 1;
        tracing::warn!(deployment = %uuid, project_id, "Déploiement orphelin marqué en échec");
        // Statut projet : « live » si une révision a déjà réussi, sinon « failed ».
        let _ = sqlx::query(
            r#"UPDATE projects SET status = CASE WHEN EXISTS (
                   SELECT 1 FROM deployments WHERE project_id = $1 AND status = 'success'
                     AND environment = 'production'
               ) THEN 'live' ELSE 'failed' END,
               updated_at = $2
               WHERE id = $1 AND status = 'deploying'
                 AND NOT EXISTS (
                   SELECT 1 FROM deployments WHERE project_id = $1
                     AND environment = 'production'
                     AND status IN ('queued', 'running', 'building')
                 )"#,
        )
        .bind(project_id)
        .bind(&now)
        .execute(pool)
        .await;
    }
    reaped
}

/// Statut projet recalculé quand plus rien n'est actif : `live` si une révision prod
/// a réussi, `failed` si un échec prod n'est pas acquitté, sinon `idle`.
const SETTLED_STATUS_SQL: &str = r#"CASE
       WHEN EXISTS (SELECT 1 FROM deployments d WHERE d.project_id = p.id
                      AND d.environment = 'production'
                      AND d.status IN ('success', 'deployed', 'ok')) THEN 'live'
       WHEN EXISTS (SELECT 1 FROM deployments d WHERE d.project_id = p.id
                      AND d.environment = 'production'
                      AND d.status IN ('failed', 'error')
                      AND (d.dismissed_at IS NULL OR d.dismissed_at = '')) THEN 'failed'
       ELSE 'idle' END"#;

/// Aucun déploiement actif du projet, tous environnements confondus (prod, dev, previews).
const NO_ACTIVE_DEPLOYMENT_SQL: &str = r#"NOT EXISTS (
       SELECT 1 FROM deployments d WHERE d.project_id = p.id
         AND d.status IN ('queued', 'running', 'building', 'pending', 'deploying'))"#;

/// Libère `projects.status = 'deploying'` seulement si plus aucun déploiement du projet
/// n'est actif. Une seule requête : un déploiement prod inséré entre-temps garde le verrou.
/// Retourne `true` si le statut a été recalculé.
pub async fn release_deploying_if_no_active(pool: &PgPool, project_id: i64) -> bool {
    let sql = format!(
        "UPDATE projects p SET status = {SETTLED_STATUS_SQL}, updated_at = $1
          WHERE p.id = $2 AND p.status = 'deploying' AND {NO_ACTIVE_DEPLOYMENT_SQL}"
    );
    let res = sqlx::query(&sql)
        .bind(now_str())
        .bind(project_id)
        .execute(pool)
        .await;
    matches!(res, Ok(r) if r.rows_affected() == 1)
}

/// Garde-fou (boot + boucle de nettoyage) : projets restés `deploying` alors qu'aucun
/// déploiement actif ne leur correspond (verrou orphelin). `older_than` laisse le temps
/// à un démarrage en cours d'insérer sa ligne. Retourne les ids libérés.
pub async fn release_orphan_project_locks(pool: &PgPool, older_than: chrono::Duration) -> Vec<i64> {
    let cutoff = (chrono::Utc::now() - older_than).to_rfc3339();
    let sql = format!(
        "UPDATE projects p SET status = {SETTLED_STATUS_SQL}, updated_at = $1
          WHERE p.status = 'deploying'
            AND (p.updated_at IS NULL OR p.updated_at < $2)
            AND {NO_ACTIVE_DEPLOYMENT_SQL}
          RETURNING p.id"
    );
    let rows: Vec<(i64,)> = sqlx::query_as(&sql)
        .bind(now_str())
        .bind(&cutoff)
        .fetch_all(pool)
        .await
        .unwrap_or_default();
    let ids: Vec<i64> = rows.into_iter().map(|(id,)| id).collect();
    for id in &ids {
        tracing::warn!(project_id = id, "Verrou « deploying » orphelin libéré");
    }
    ids
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
                environment TEXT NOT NULL DEFAULT 'production',
                logs TEXT,
                error_summary TEXT,
                error_hint TEXT,
                finished_at TEXT,
                dismissed_at TEXT,
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
                environment TEXT NOT NULL DEFAULT 'production',
                logs TEXT,
                error_summary TEXT,
                error_hint TEXT,
                finished_at TEXT,
                dismissed_at TEXT,
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
    async fn supersede_keeps_prod_and_dev_independent() {
        let pool = devforge_database::ephemeral_pg().await;
        sqlx::query(
            r#"CREATE TABLE deployments (
                uuid TEXT PRIMARY KEY,
                project_id BIGINT NOT NULL,
                status TEXT NOT NULL,
                environment TEXT NOT NULL DEFAULT 'production',
                logs TEXT,
                error_summary TEXT,
                error_hint TEXT,
                finished_at TEXT,
                dismissed_at TEXT,
                updated_at TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        for (uuid, env) in [
            ("prod-run", "production"),
            ("dev-run", "dev"),
            ("dev-new", "dev"),
            ("prod-new", "production"),
        ] {
            sqlx::query(
                "INSERT INTO deployments (uuid, project_id, status, environment, logs) VALUES ($1, 9, 'running', $2, 'x')",
            )
            .bind(uuid)
            .bind(env)
            .execute(&pool)
            .await
            .unwrap();
        }
        let queue = DeployQueue::new();
        // Un nouveau déploiement dev n'annule que l'ancien dev.
        let cancelled = supersede_in_progress(&queue, &pool, 9, "dev-new").await;
        assert_eq!(cancelled, vec!["dev-run".to_string()]);
        // Un nouveau déploiement prod n'annule que l'ancienne prod.
        let cancelled = supersede_in_progress(&queue, &pool, 9, "prod-new").await;
        assert_eq!(cancelled, vec!["prod-run".to_string()]);
        let rows: Vec<(String, String)> =
            sqlx::query_as("SELECT uuid, status FROM deployments ORDER BY uuid")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            rows,
            vec![
                ("dev-new".into(), "running".into()),
                ("dev-run".into(), "cancelled".into()),
                ("prod-new".into(), "running".into()),
                ("prod-run".into(), "cancelled".into()),
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
                environment TEXT NOT NULL DEFAULT 'production',
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

    #[tokio::test]
    async fn cancel_one_marks_and_signals() {
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
                environment TEXT NOT NULL DEFAULT 'production',
                logs TEXT,
                error_summary TEXT,
                error_hint TEXT,
                finished_at TEXT,
                dismissed_at TEXT,
                created_at TEXT,
                updated_at TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO projects (id, uuid, status) VALUES (3, 'p', 'deploying')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO deployments (uuid, project_id, status, logs, created_at) VALUES ('dep-run', 3, 'running', 'x', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO deployments (uuid, project_id, status, logs, created_at) VALUES ('dep-ok', 3, 'success', 'ok', '2025-12-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        let queue = DeployQueue::new();
        let _rx = queue.register_cancel("dep-run").await;
        assert!(cancel_one_deployment(&queue, &pool, "dep-run")
            .await
            .unwrap());
        assert!(queue.is_cancelled("dep-run").await);
        // Already terminal → false
        assert!(!cancel_one_deployment(&queue, &pool, "dep-ok")
            .await
            .unwrap());
        assert!(!cancel_one_deployment(&queue, &pool, "dep-run")
            .await
            .unwrap());

        let st: (String,) = sqlx::query_as("SELECT status FROM deployments WHERE uuid = 'dep-run'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(st.0, "cancelled");
        let proj: (String,) = sqlx::query_as("SELECT status FROM projects WHERE id = 3")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(proj.0, "live");
    }

    #[tokio::test]
    async fn recompute_live_when_failed_dismissed_and_success_exists() {
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
                environment TEXT NOT NULL DEFAULT 'production',
                logs TEXT,
                dismissed_at TEXT,
                created_at TEXT,
                updated_at TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO projects (id, uuid, status) VALUES (7, 'starbase', 'failed')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO deployments (uuid, project_id, status, created_at) VALUES ('ok', 7, 'success', '2025-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO deployments (uuid, project_id, status, created_at) VALUES ('fail', 7, 'failed', '2026-01-01T00:00:00Z')",
        )
        .execute(&pool)
        .await
        .unwrap();

        recompute_project_status_after_deploy_change(&pool, 7)
            .await
            .unwrap();
        let before: (String,) = sqlx::query_as("SELECT status FROM projects WHERE id = 7")
            .fetch_one(&pool)
            .await
            .unwrap();
        // Succès existe → live même avec un échec non acquitté (même règle que cancel).
        assert_eq!(before.0, "live");

        sqlx::query("UPDATE projects SET status = 'failed' WHERE id = 7")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "UPDATE deployments SET dismissed_at = '2026-01-02T00:00:00Z' WHERE uuid = 'fail'",
        )
        .execute(&pool)
        .await
        .unwrap();
        recompute_project_status_after_deploy_change(&pool, 7)
            .await
            .unwrap();
        let after: (String,) = sqlx::query_as("SELECT status FROM projects WHERE id = 7")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(after.0, "live");
    }

    #[tokio::test]
    async fn recompute_failed_without_success_keeps_failed() {
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
                environment TEXT NOT NULL DEFAULT 'production',
                dismissed_at TEXT,
                updated_at TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO projects (id, uuid, status) VALUES (8, 'p', 'failed')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO deployments (uuid, project_id, status) VALUES ('fail', 8, 'failed')",
        )
        .execute(&pool)
        .await
        .unwrap();

        recompute_project_status_after_deploy_change(&pool, 8)
            .await
            .unwrap();
        let st: (String,) = sqlx::query_as("SELECT status FROM projects WHERE id = 8")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(st.0, "failed");

        sqlx::query("UPDATE deployments SET dismissed_at = 'now' WHERE uuid = 'fail'")
            .execute(&pool)
            .await
            .unwrap();
        recompute_project_status_after_deploy_change(&pool, 8)
            .await
            .unwrap();
        let idle: (String,) = sqlx::query_as("SELECT status FROM projects WHERE id = 8")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(idle.0, "idle");
    }

    #[tokio::test]
    async fn set_live_logs_updates_running_only() {
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
            "INSERT INTO deployments (uuid, project_id, status, logs, updated_at) VALUES ('run', 1, 'running', 'start', 't0')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO deployments (uuid, project_id, status, logs, updated_at) VALUES ('ok', 1, 'success', 'done', 't0')",
        )
        .execute(&pool)
        .await
        .unwrap();

        set_live_logs(&pool, "run", "mid\n").await;
        set_live_logs(&pool, "ok", "should-not-write").await;

        let run: (String,) = sqlx::query_as("SELECT logs FROM deployments WHERE uuid = 'run'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(run.0, "mid\n");
        let ok: (String,) = sqlx::query_as("SELECT logs FROM deployments WHERE uuid = 'ok'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(ok.0, "done");
    }

    #[tokio::test]
    async fn recompute_after_delete_uses_remaining_rows() {
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
                environment TEXT NOT NULL DEFAULT 'production',
                dismissed_at TEXT,
                updated_at TEXT
            )"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO projects (id, uuid, status) VALUES (9, 'p', 'failed')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO deployments (uuid, project_id, status) VALUES ('ok', 9, 'success')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO deployments (uuid, project_id, status) VALUES ('fail', 9, 'failed')",
        )
        .execute(&pool)
        .await
        .unwrap();

        sqlx::query("DELETE FROM deployments WHERE uuid = 'fail'")
            .execute(&pool)
            .await
            .unwrap();
        recompute_project_status_after_deploy_change(&pool, 9)
            .await
            .unwrap();
        let st: (String,) = sqlx::query_as("SELECT status FROM projects WHERE id = 9")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(st.0, "live");
    }

    async fn lock_tables(pool: &PgPool) {
        sqlx::query(
            r#"CREATE TABLE projects (
                id BIGINT PRIMARY KEY,
                uuid TEXT NOT NULL,
                name TEXT NOT NULL DEFAULT '',
                server_id TEXT,
                status TEXT NOT NULL,
                updated_at TEXT
            )"#,
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            r#"CREATE TABLE deployments (
                uuid TEXT PRIMARY KEY,
                project_id BIGINT NOT NULL,
                status TEXT NOT NULL,
                environment TEXT NOT NULL DEFAULT 'production',
                logs TEXT,
                dismissed_at TEXT,
                updated_at TEXT
            )"#,
        )
        .execute(pool)
        .await
        .unwrap();
    }

    async fn project_status(pool: &PgPool, id: i64) -> String {
        let st: (String,) = sqlx::query_as("SELECT status FROM projects WHERE id = $1")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap();
        st.0
    }

    /// Fusion d'une PR : la preview est annulée pendant que le push prod est en file.
    /// Le verrou du projet doit rester tant que la prod n'est pas terminée.
    #[tokio::test]
    async fn preview_cancel_keeps_lock_while_prod_is_active() {
        let pool = devforge_database::ephemeral_pg().await;
        lock_tables(&pool).await;
        sqlx::query("INSERT INTO projects (id, uuid, status) VALUES (20, 'p', 'deploying')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            r#"INSERT INTO deployments (uuid, project_id, status, environment) VALUES
               ('old-ok', 20, 'success', 'production'),
               ('prev', 20, 'cancelled', 'preview-3'),
               ('prod', 20, 'queued', 'production')"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        assert!(!release_deploying_if_no_active(&pool, 20).await);
        assert_eq!(project_status(&pool, 20).await, "deploying");

        sqlx::query("UPDATE deployments SET status = 'running' WHERE uuid = 'prod'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(!release_deploying_if_no_active(&pool, 20).await);
        assert_eq!(project_status(&pool, 20).await, "deploying");
    }

    /// Preview annulée et plus rien d'actif : le projet quitte `deploying`.
    #[tokio::test]
    async fn preview_cancel_releases_lock_when_nothing_active() {
        let pool = devforge_database::ephemeral_pg().await;
        lock_tables(&pool).await;
        sqlx::query(
            r#"INSERT INTO projects (id, uuid, status) VALUES
               (21, 'with-success', 'deploying'),
               (22, 'never-deployed', 'deploying'),
               (23, 'already-live', 'live')"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"INSERT INTO deployments (uuid, project_id, status, environment) VALUES
               ('ok', 21, 'success', 'production'),
               ('prev-21', 21, 'cancelled', 'preview-3'),
               ('prev-22', 22, 'cancelled', 'preview-1')"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        assert!(release_deploying_if_no_active(&pool, 21).await);
        assert_eq!(project_status(&pool, 21).await, "live");
        assert!(release_deploying_if_no_active(&pool, 22).await);
        assert_eq!(project_status(&pool, 22).await, "idle");
        // Statut autre que `deploying` : on n'y touche pas.
        assert!(!release_deploying_if_no_active(&pool, 23).await);
        assert_eq!(project_status(&pool, 23).await, "live");
    }

    /// Une preview encore active d'une autre PR garde aussi le verrou.
    #[tokio::test]
    async fn other_active_environment_keeps_lock() {
        let pool = devforge_database::ephemeral_pg().await;
        lock_tables(&pool).await;
        sqlx::query("INSERT INTO projects (id, uuid, status) VALUES (24, 'p', 'deploying')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            r#"INSERT INTO deployments (uuid, project_id, status, environment) VALUES
               ('prev-3', 24, 'cancelled', 'preview-3'),
               ('prev-4', 24, 'building', 'preview-4')"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        assert!(!release_deploying_if_no_active(&pool, 24).await);
        assert_eq!(project_status(&pool, 24).await, "deploying");
    }

    /// Garde-fou périodique : seuls les verrous sans déploiement actif et assez anciens
    /// sont libérés ; un échec prod non acquitté redonne `failed`.
    #[tokio::test]
    async fn orphan_sweep_frees_only_stale_unbacked_locks() {
        let pool = devforge_database::ephemeral_pg().await;
        lock_tables(&pool).await;
        let old = (chrono::Utc::now() - chrono::Duration::minutes(30)).to_rfc3339();
        let fresh = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            r#"INSERT INTO projects (id, uuid, status, updated_at) VALUES
               (30, 'orphan-live', 'deploying', $1),
               (31, 'orphan-failed', 'deploying', $1),
               (32, 'backed', 'deploying', $1),
               (33, 'just-started', 'deploying', $2),
               (34, 'idle', 'idle', $1)"#,
        )
        .bind(&old)
        .bind(&fresh)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"INSERT INTO deployments (uuid, project_id, status, environment) VALUES
               ('ok-30', 30, 'success', 'production'),
               ('prev-30', 30, 'cancelled', 'preview-3'),
               ('fail-31', 31, 'failed', 'production'),
               ('q-32', 32, 'queued', 'production')"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        let mut freed = release_orphan_project_locks(&pool, chrono::Duration::minutes(2)).await;
        freed.sort();
        assert_eq!(freed, vec![30, 31]);
        assert_eq!(project_status(&pool, 30).await, "live");
        assert_eq!(project_status(&pool, 31).await, "failed");
        assert_eq!(project_status(&pool, 32).await, "deploying");
        assert_eq!(project_status(&pool, 33).await, "deploying");
        assert_eq!(project_status(&pool, 34).await, "idle");
    }

    #[test]
    fn waiting_note_names_the_holder() {
        let holder = (
            "popcornn-server".to_string(),
            "preview-201".to_string(),
            "7974710e-aaaa".to_string(),
        );
        let n = waiting_note("default", Some(&holder));
        assert!(n.contains("« default »"));
        assert!(n.contains("popcornn-server (preview-201, 7974710e)"));
        assert!(waiting_note("default", None).contains("un autre déploiement est en cours"));
    }

    /// Déploiement en file derrière un autre build du même nœud : la file n'est pas muette.
    #[tokio::test]
    async fn queued_deploy_logs_who_holds_the_node() {
        let pool = devforge_database::ephemeral_pg().await;
        lock_tables(&pool).await;
        sqlx::query(
            r#"INSERT INTO projects (id, uuid, name, server_id, status) VALUES
               (40, 'a', 'jeser', NULL, 'deploying'),
               (41, 'b', 'popcornn-server', 'default', 'live')"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"INSERT INTO deployments (uuid, project_id, status, environment, logs, updated_at) VALUES
               ('waiting', 40, 'queued', 'production', '[devforge] webhook push…\n', 't1'),
               ('holder', 41, 'running', 'preview-201', '', 't0')"#,
        )
        .execute(&pool)
        .await
        .unwrap();

        let queue = DeployQueue::new();
        let hold = queue.acquire("default").await;
        assert!(queue.is_busy("default").await);
        assert!(!queue.is_busy("node-b").await);
        let _rx = queue.register_cancel("waiting").await;
        let (q2, p2) = (queue.clone(), pool.clone());
        let task = tokio::spawn(async move {
            run_in_node_slot(&q2, &p2, "", "waiting", || async { "built" }).await
        });
        let mut logs = String::new();
        for _ in 0..50 {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            let row: (String,) =
                sqlx::query_as("SELECT logs FROM deployments WHERE uuid = 'waiting'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            logs = row.0;
            if logs.contains("en attente") {
                break;
            }
        }
        assert!(logs.contains("en attente du nœud « default »"), "{logs}");
        assert!(logs.contains("popcornn-server (preview-201"), "{logs}");
        assert!(!task.is_finished());
        drop(hold);
        match task.await.unwrap() {
            SlotOutcome::Completed(v) => assert_eq!(v, "built"),
            SlotOutcome::Cancelled => panic!("ne doit pas être annulé"),
        }
    }
}
