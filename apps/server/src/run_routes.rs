//! P4-02 / P4-03 / P4-05 : runs reprenables (SSE), runs actifs, annulation, fin des workers.

use std::{convert::Infallible, sync::Arc, time::Duration};

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse,
    },
    routing::{get, post},
    Json, Router,
};
use futures_util::stream::{self, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::routes::ApiError;
use crate::run_events::{self, Out};
use crate::state::{new_uuid, now_str, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/agent/runs/{run_uuid}", get(get_run))
        .route("/api/v1/agent/runs/{run_uuid}/events", get(run_events_sse))
        .route("/api/v1/agent/runs/{run_uuid}/cancel", post(cancel_run))
        .route("/api/v1/projects/{project_uuid}/agents/{agent_uuid}/active-run", get(active_run))
}

#[derive(sqlx::FromRow)]
struct RunInfo {
    uuid: String,
    project_uuid: String,
    agent_uuid: String,
    status: String,
    kind: String,
    title: Option<String>,
    progress: Option<String>,
    summary: Option<String>,
    parent_run_uuid: Option<String>,
    cancel_requested: bool,
    created_at: String,
    updated_at: String,
}

async fn load_run(state: &AppState, run_uuid: &str) -> Option<RunInfo> {
    sqlx::query_as::<_, RunInfo>(
        r#"SELECT uuid, project_uuid, agent_uuid, status, kind, title, progress::text AS progress, summary,
                  parent_run_uuid, cancel_requested, created_at, updated_at
           FROM agent_runs WHERE uuid = $1"#,
    )
    .bind(run_uuid)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten()
}

/// Run visible seulement si son projet appartient à l'espace de l'utilisateur.
async fn authorized_run(state: &AppState, headers: &HeaderMap, run_uuid: &str) -> Result<RunInfo, ApiError> {
    let run = load_run(state, run_uuid).await.ok_or_else(|| ApiError::not_found("run"))?;
    crate::routes::auth_project(state, headers, &run.project_uuid).await?;
    Ok(run)
}

async fn run_json(state: &AppState, r: &RunInfo) -> Value {
    let agent_name: Option<String> = sqlx::query_scalar("SELECT name FROM project_agents WHERE uuid = $1")
        .bind(&r.agent_uuid)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();
    json!({
        "run_uuid": r.uuid,
        "project_uuid": r.project_uuid,
        "agent_uuid": r.agent_uuid,
        "agent_name": agent_name,
        "status": r.status,
        "kind": r.kind,
        "title": r.title,
        "progress": r.progress.as_deref().and_then(|p| serde_json::from_str::<Value>(p).ok()).unwrap_or(json!([])),
        "summary": r.summary,
        "parent_run_uuid": r.parent_run_uuid,
        "cancel_requested": r.cancel_requested,
        "started_at": r.created_at,
        "updated_at": r.updated_at,
        "live": run_events::is_live(&r.uuid),
    })
}

async fn get_run(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(run_uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let run = authorized_run(&state, &headers, &run_uuid).await?;
    Ok(Json(json!({"data": run_json(&state, &run).await})))
}

#[derive(Deserialize)]
struct AfterQuery {
    after: Option<i64>,
}

/// Événements SSE d'un flux `follow` : `id: <seq>`, puis `event: done`.
pub fn sse_from(rx: tokio::sync::mpsc::Receiver<Out>) -> axum::response::Response {
    let s = stream::unfold(rx, |mut rx| async move {
        match rx.recv().await {
            Some(Out::Event(e)) => Some((
                Ok::<Event, Infallible>(Event::default().id(e.seq.to_string()).event("message").data(e.payload.to_string())),
                rx,
            )),
            Some(Out::Done(status)) => Some((
                Ok(Event::default().event("done").data(json!({"status": status}).to_string())),
                rx,
            )),
            None => None,
        }
    });
    Sse::new(s.boxed())
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
        .into_response()
}

/// `GET /agent/runs/{run}/events` : historique `seq > after` (ou `Last-Event-ID`) puis direct.
async fn run_events_sse(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(run_uuid): Path<String>,
    Query(q): Query<AfterQuery>,
) -> Result<axum::response::Response, ApiError> {
    authorized_run(&state, &headers, &run_uuid).await?;
    let header_after = headers
        .get("last-event-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<i64>().ok());
    let after = q.after.or(header_after).unwrap_or(0).max(0);
    Ok(sse_from(run_events::follow(state.pool.clone(), run_uuid, after)))
}

async fn active_run(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((project_uuid, agent_uuid)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    crate::routes::auth_project(&state, &headers, &project_uuid).await?;
    let run: Option<String> = sqlx::query_scalar(
        r#"SELECT uuid FROM agent_runs
           WHERE project_uuid = $1 AND agent_uuid = $2 AND status IN ('pending','running')
           ORDER BY created_at DESC LIMIT 1"#,
    )
    .bind(&project_uuid)
    .bind(&agent_uuid)
    .fetch_optional(&state.pool)
    .await
    .map_err(ApiError::from)?;
    let data = match run {
        Some(uuid) => match load_run(&state, &uuid).await {
            Some(r) => run_json(&state, &r).await,
            None => Value::Null,
        },
        None => Value::Null,
    };
    Ok(Json(json!({"data": data})))
}

/// `POST /agent/runs/{run}/cancel` : drapeau en base + jeton local ; un run pas encore démarré
/// est clos tout de suite.
async fn cancel_run(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(run_uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let run = authorized_run(&state, &headers, &run_uuid).await?;
    if run_events::is_terminal(&run.status) {
        return Ok(Json(json!({"data": {"ok": true, "status": run.status}})));
    }
    sqlx::query("UPDATE agent_runs SET cancel_requested = TRUE, updated_at = $1 WHERE uuid = $2")
        .bind(now_str())
        .bind(&run_uuid)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;
    let local = run_events::cancel_local(&run_uuid);
    let mut status = "cancelling".to_string();
    if !local && matches!(run.status.as_str(), "queued" | "pending") {
        // Pas encore démarré : on le clôt (le claim échouera).
        let res = sqlx::query("UPDATE agent_runs SET status = 'cancelled', updated_at = $1 WHERE uuid = $2 AND status IN ('queued','pending')")
            .bind(now_str())
            .bind(&run_uuid)
            .execute(&state.pool)
            .await
            .map_err(ApiError::from)?;
        if res.rows_affected() == 1 {
            status = "cancelled".into();
            let _ = sqlx::query("UPDATE project_agents SET status = 'idle', updated_at = $1 WHERE uuid = $2")
                .bind(now_str())
                .bind(&run.agent_uuid)
                .execute(&state.pool)
                .await;
            on_run_finished(&state, &run_uuid).await;
        }
    }
    tracing::info!(run_uuid, local, status, "annulation de run demandée");
    Ok(Json(json!({"data": {"ok": true, "status": status}})))
}

/* ---------------- Workers (P4-03) ---------------- */

/// Lanceur des workers délégués : même chemin que les réveils (claim + exécution).
pub struct ServerLauncher(pub AppState);

impl devforge_agent::WorkerLauncher for ServerLauncher {
    fn launch(&self, project_uuid: &str, agent_uuid: &str, run_uuid: &str) {
        start_run_now(self.0.clone(), project_uuid.to_string(), agent_uuid.to_string(), run_uuid.to_string());
    }
}

pub fn install_launcher(state: &AppState) {
    devforge_agent::set_worker_launcher(Arc::new(ServerLauncher(state.clone())));
}

/// Démarre un run `pending` en tâche de fond.
pub fn start_run_now(state: AppState, project_uuid: String, agent_uuid: String, run_uuid: String) {
    tokio::spawn(async move {
        let row: Option<(String, String)> = sqlx::query_as(
            "SELECT r.message_uuid, m.content FROM agent_runs r JOIN agent_messages m ON m.uuid = r.message_uuid WHERE r.uuid = $1",
        )
        .bind(&run_uuid)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();
        let Some((message_uuid, content)) = row else {
            tracing::warn!(run_uuid, "worker : run introuvable");
            return;
        };
        match crate::agent_runs::try_claim(&state.pool, &run_uuid).await {
            Ok(true) => {}
            _ => return,
        }
        let run = crate::agent_runs::RunRow { uuid: run_uuid.clone(), project_uuid, agent_uuid, message_uuid, content };
        if let Err(e) = crate::routes::execute_claimed_run(&state, &run).await {
            tracing::warn!(error = %e, run_uuid, "worker en échec");
        }
    });
}

/// Fonction synchrone : casse le cycle de types réveil → run → fin de run → réveil.
fn spawn_wake(state: AppState, project: String, agent: String, marker: String, body: String) {
    tokio::spawn(async move {
        let _ = crate::routes::wake_project_agent(&state, &project, &agent, &marker, &body).await;
    });
}

fn elapsed_ms(created_at: &str) -> Option<i64> {
    let t = chrono::DateTime::parse_from_rfc3339(created_at).ok()?;
    Some((chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_milliseconds().max(0))
}

/// Fichiers écrits par le worker (pour la carte).
pub fn touched_files(tools_json: &str) -> Vec<String> {
    let calls: Vec<Value> = serde_json::from_str(tools_json).unwrap_or_default();
    let mut out: Vec<String> = Vec::new();
    for c in calls {
        if c.get("name").and_then(|v| v.as_str()) != Some("write_project_file") {
            continue;
        }
        if c.get("result").and_then(|r| r.get("ok")).and_then(|v| v.as_bool()) == Some(false) {
            continue;
        }
        if let Some(p) = c.get("arguments").and_then(|a| a.get("path")).and_then(|v| v.as_str()) {
            if !out.iter().any(|x| x == p) {
                out.push(p.to_string());
            }
        }
    }
    out.truncate(8);
    out
}

/// Carte de résultat postée dans le fil parent.
pub fn job_result_card(run_uuid: &str, worker_uuid: &str, worker_name: &str, title: &str, status: &str, summary: &str, files: &[String], elapsed_ms: Option<i64>) -> (String, Value) {
    let content = match status {
        "completed" => format!("Worker « {title} » terminé : {summary}"),
        "cancelled" => format!("Worker « {title} » arrêté à ta demande."),
        _ => format!("Worker « {title} » en échec : {summary}"),
    };
    let card = json!([{
        "id": format!("job-{run_uuid}"),
        "name": "job_result",
        "arguments": {"run_uuid": run_uuid, "title": title},
        "result": {
            "ok": status == "completed",
            "kind": "worker",
            "status": status,
            "run_uuid": run_uuid,
            "worker_uuid": worker_uuid,
            "worker_name": worker_name,
            "title": title,
            "summary": summary,
            "files": files,
            "elapsed_ms": elapsed_ms,
        }
    }]);
    (content, card)
}

/// Fin d'un run : pour un worker, carte dans le fil parent, journal mémoire, réveil du parent en cas
/// d'échec (jamais en cas de succès : pas de boucle), puis worker suivant de la file.
pub async fn on_run_finished(state: &AppState, run_uuid: &str) {
    let Some(run) = load_run(state, run_uuid).await else { return };
    if run.kind != "worker" {
        return;
    }
    let title = run.title.clone().unwrap_or_else(|| "tâche".into());
    let last: Option<(String, String)> = sqlx::query_as(
        "SELECT content, COALESCE(tool_calls_json, '[]') FROM agent_messages WHERE agent_uuid = $1 AND role = 'assistant' ORDER BY id DESC LIMIT 1",
    )
    .bind(&run.agent_uuid)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten();
    let error: Option<String> = sqlx::query_scalar("SELECT error FROM agent_runs WHERE uuid = $1")
        .bind(run_uuid)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .flatten();
    let (summary, files) = match (&run.status[..], &last) {
        ("failed", _) => (crate::agent_runs::summary_line(error.as_deref().unwrap_or("erreur inconnue")), Vec::new()),
        (_, Some((content, tools))) => (crate::agent_runs::summary_line(content), touched_files(tools)),
        _ => (String::new(), Vec::new()),
    };
    let worker_name: String = sqlx::query_scalar("SELECT name FROM project_agents WHERE uuid = $1")
        .bind(&run.agent_uuid)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .unwrap_or_default();
    let parent_agent: Option<String> = match &run.parent_run_uuid {
        Some(p) => sqlx::query_scalar("SELECT agent_uuid FROM agent_runs WHERE uuid = $1")
            .bind(p)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten(),
        None => None,
    };
    let parent_agent = match parent_agent {
        Some(a) => Some(a),
        None => crate::db::ensure_coordinator_agent(&state.pool, &run.project_uuid).await.ok().flatten(),
    };
    let _ = sqlx::query("UPDATE agent_runs SET summary = $1 WHERE uuid = $2")
        .bind(&summary)
        .bind(run_uuid)
        .execute(&state.pool)
        .await;
    if let Some(parent) = parent_agent.as_deref() {
        let (content, card) = job_result_card(run_uuid, &run.agent_uuid, &worker_name, &title, &run.status, &summary, &files, elapsed_ms(&run.created_at));
        let _ = sqlx::query(
            r#"INSERT INTO agent_messages (uuid, project_uuid, agent_uuid, role, content, tool_calls_json, provider, created_at)
               VALUES ($1, $2, $3, 'assistant', $4, $5, 'system', $6)"#,
        )
        .bind(new_uuid())
        .bind(&run.project_uuid)
        .bind(parent)
        .bind(&content)
        .bind(card.to_string())
        .bind(now_str())
        .execute(&state.pool)
        .await;
        if run.status == "failed" {
            let marker = format!("[job:{run_uuid}]");
            let body = format!(
                "Le worker « {title} » a échoué : {summary}\nRegarde son fil ({worker_name}) et propose la suite à l'utilisateur. Ne relance pas de worker automatiquement."
            );
            spawn_wake(state.clone(), run.project_uuid.clone(), parent.to_string(), marker, body);
        }
    }
    let log = match &run.status[..] {
        "completed" => format!("Worker « {title} » : terminé — {summary}"),
        "cancelled" => format!("Worker « {title} » : arrêté par l'utilisateur."),
        _ => format!("Worker « {title} » : échec — {summary}"),
    };
    let kind = if run.status == "failed" { "incident" } else { "decision" };
    crate::memory_routes::system_write(state, &run.project_uuid, kind, None, log, run_uuid).await;
    if let Some((next, agent)) = crate::agent_runs::promote_queued(&state.pool, &run.project_uuid).await {
        start_run_now(state.clone(), run.project_uuid.clone(), agent, next);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use devforge_shared::Tool;

    #[tokio::test]
    async fn delegation_limits_concurrency_dedupes_and_promotes_the_queue() {
        let pool = devforge_database::ephemeral_pg().await;
        crate::db::migrate(&pool).await.unwrap();
        sqlx::query("INSERT INTO projects (uuid, name, slug, workspace_uuid, created_at, updated_at) VALUES ('p1','A','a','','x','x')")
            .execute(&pool).await.unwrap();
        for (uuid, role) in [("coord", "coordinator"), ("ops", "ops")] {
            sqlx::query("INSERT INTO project_agents (uuid, project_uuid, name, role, kind, status, created_at, updated_at) VALUES ($1,'p1',$1,$2,'required','idle','x','x')")
                .bind(uuid).bind(role).execute(&pool).await.unwrap();
        }
        let tool = devforge_agent::DelegateTaskTool { pool: Arc::new(pool.clone()) };
        let call = |title: &str, caller: &str| {
            json!({"project_uuid": "p1", "caller_agent_uuid": caller, "parent_run_uuid": "parent-run", "title": title, "instructions": "fais-le, build OK"})
        };
        let refused = tool.execute(call("x", "ops")).await.unwrap();
        assert_eq!(refused["ok"], false, "réservé au Coordinateur");
        let a = tool.execute(call("Refonte de l'accueil", "coord")).await.unwrap();
        let b = tool.execute(call("Page contact", "coord")).await.unwrap();
        let c = tool.execute(call("Page tarifs", "coord")).await.unwrap();
        assert_eq!((a["status"].as_str(), b["status"].as_str(), c["status"].as_str()), (Some("started"), Some("started"), Some("queued")));
        let dup = tool.execute(call("refonte de l’accueil !", "coord")).await.unwrap();
        assert_eq!(dup["status"], "already_running");
        assert_eq!(dup["run_uuid"], a["run_uuid"]);
        let (kind, parent, title): (String, Option<String>, Option<String>) =
            sqlx::query_as("SELECT kind, parent_run_uuid, title FROM agent_runs WHERE uuid = $1")
                .bind(a["run_uuid"].as_str().unwrap()).fetch_one(&pool).await.unwrap();
        assert_eq!((kind.as_str(), parent.as_deref(), title.as_deref()), ("worker", Some("parent-run"), Some("Refonte de l'accueil")));
        // Rien ne se libère : pas de promotion.
        assert!(crate::agent_runs::promote_queued(&pool, "p1").await.is_none());
        sqlx::query("UPDATE agent_runs SET status = 'completed' WHERE uuid = $1")
            .bind(a["run_uuid"].as_str().unwrap()).execute(&pool).await.unwrap();
        let (next, worker) = crate::agent_runs::promote_queued(&pool, "p1").await.expect("worker suivant");
        assert_eq!(next, c["run_uuid"].as_str().unwrap());
        assert_eq!(worker, c["worker_uuid"].as_str().unwrap());
        assert!(crate::agent_runs::promote_queued(&pool, "p1").await.is_none(), "2 actifs max");
    }

    #[test]
    fn card_lists_written_files_and_status() {
        let tools = r#"[{"name":"write_project_file","arguments":{"path":"src/pages/index.astro"},"result":{"ok":true}},
                        {"name":"write_project_file","arguments":{"path":"src/pages/index.astro"},"result":{"ok":true}},
                        {"name":"write_project_file","arguments":{"path":"src/x.ts"},"result":{"ok":false}},
                        {"name":"run_workdir_command","arguments":{"command":"npm run build"},"result":{"ok":true}}]"#;
        let files = touched_files(tools);
        assert_eq!(files, vec!["src/pages/index.astro"]);
        let (content, card) = job_result_card("r1", "w1", "worker-accueil", "Refonte", "completed", "Accueil refait, build OK.", &files, Some(61_000));
        assert_eq!(content, "Worker « Refonte » terminé : Accueil refait, build OK.");
        assert_eq!(card[0]["name"], "job_result");
        assert_eq!(card[0]["result"]["status"], "completed");
        assert_eq!(card[0]["result"]["ok"], true);
        let (failed, card) = job_result_card("r1", "w1", "w", "Refonte", "failed", "build KO", &[], None);
        assert!(failed.contains("en échec"));
        assert_eq!(card[0]["result"]["ok"], false);
    }
}
