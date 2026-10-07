//! Boîte de réception de l'app native (Android) : événements qui méritent une notification.
//!
//! `GET /api/v1/mobile/inbox?since=RFC3339` — lecture seule, scoping workspace.
//! - `deploy_failed` : mise en ligne échouée depuis `since` ;
//! - `app_down` : app en ligne qui ne répond plus (probe live, borné en temps) ;
//! - `spec_waiting` : Braise attend une validation explicite (spec `awaiting_validation`).
//!
//! `GET /api/v1/mobile/conversations` — onglet « Braise » : dernière réplique de chaque
//! conversation et ce qu'elle attend de toi (`spec` à valider, `plan` à lancer, `question`).
//!
//! Les identifiants sont stables : le client compare avec son instantané précédent
//! pour ne notifier qu'une fois. Conçu pour un sync périodique ; un push (FCM /
//! UnifiedPush) pourra réutiliser la même forme d'événement.

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    routing::get,
    Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::routes::ApiError;
use crate::state::{AppState, Project};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/mobile/inbox", get(inbox))
        .route("/api/v1/mobile/conversations", get(conversations))
}

#[derive(Deserialize)]
struct InboxQuery {
    #[serde(default)]
    since: Option<String>,
    /// `false` pour sauter la probe HTTP (statut Postgres seul).
    #[serde(default)]
    probe: Option<bool>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct InboxEvent {
    pub id: String,
    pub kind: &'static str,
    pub project_uuid: String,
    pub project_name: String,
    pub title: String,
    pub body: String,
    pub created_at: String,
}

/// `since` absent ou invalide → 24 h ; jamais plus de 7 jours en arrière.
pub fn normalize_since(raw: Option<&str>, now: DateTime<Utc>) -> String {
    let floor = now - Duration::days(7);
    let parsed = raw
        .and_then(|s| DateTime::parse_from_rfc3339(s.trim()).ok())
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or(now - Duration::hours(24));
    parsed.max(floor).to_rfc3339()
}

pub fn deploy_failed_event(
    project: &Project,
    deployment_uuid: &str,
    created_at: &str,
    summary: Option<&str>,
) -> InboxEvent {
    let body = summary
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.chars().take(180).collect::<String>())
        .unwrap_or_else(|| "Rustine 🩹 peut regarder les logs et réparer.".to_string());
    InboxEvent {
        id: format!("deploy:{deployment_uuid}"),
        kind: "deploy_failed",
        project_uuid: project.uuid.clone(),
        project_name: project.name.clone(),
        title: format!("Mise en ligne échouée · {}", project.name),
        body,
        created_at: created_at.to_string(),
    }
}

pub fn app_down_event(project: &Project, status: &str, now: &str) -> Option<InboxEvent> {
    let body = match status {
        "unhealthy" => "L'app ne répond plus correctement. Phare 🗼 a repéré le souci.",
        "unrouted" => "L'adresse publique ne mène plus à l'app. Phare 🗼 a repéré le souci.",
        _ => return None,
    };
    Some(InboxEvent {
        id: format!("down:{}:{status}", project.uuid),
        kind: "app_down",
        project_uuid: project.uuid.clone(),
        project_name: project.name.clone(),
        title: format!("{} ne répond plus", project.name),
        body: body.to_string(),
        created_at: now.to_string(),
    })
}

pub fn spec_waiting_event(
    project: &Project,
    spec: &devforge_agent::sdd::FeatureStatus,
) -> Option<InboxEvent> {
    if spec.phase != "awaiting_validation" || spec.dismissed {
        return None;
    }
    Some(InboxEvent {
        id: format!("spec:{}:{}", project.uuid, spec.slug),
        kind: "spec_waiting",
        project_uuid: project.uuid.clone(),
        project_name: project.name.clone(),
        title: format!("Braise attend ton OK · {}", project.name),
        body: format!(
            "« {} » est prête. Relis-la et approuve-la quand tu veux.",
            spec.title
        ),
        created_at: spec.updated_at.clone(),
    })
}

async fn inbox(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<InboxQuery>,
) -> Result<Json<Value>, ApiError> {
    let (_user, workspace) = crate::auth_routes::current_workspace(&state, &headers)
        .await
        .map_err(ApiError::from_auth)?;
    let now = Utc::now();
    let now_s = now.to_rfc3339();
    let since = normalize_since(q.since.as_deref(), now);
    let probe = q.probe.unwrap_or(true);

    let projects = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects WHERE workspace_uuid = $1 ORDER BY updated_at DESC",
    )
    .bind(&workspace.uuid)
    .fetch_all(&state.pool)
    .await
    .map_err(ApiError::from)?;

    let mut events: Vec<InboxEvent> = Vec::new();

    // 1. Mises en ligne échouées depuis `since`.
    let failed: Vec<(String, i64, String, Option<String>)> = sqlx::query_as(
        r#"SELECT d.uuid, d.project_id, d.created_at, d.error_summary
           FROM deployments d JOIN projects p ON p.id = d.project_id
           WHERE p.workspace_uuid = $1 AND d.status IN ('failed', 'error') AND d.created_at > $2
           ORDER BY d.created_at DESC LIMIT 50"#,
    )
    .bind(&workspace.uuid)
    .bind(&since)
    .fetch_all(&state.pool)
    .await
    .map_err(ApiError::from)?;
    for (dep_uuid, project_id, created_at, summary) in &failed {
        if let Some(p) = projects.iter().find(|p| p.id == *project_id) {
            events.push(deploy_failed_event(
                p,
                dep_uuid,
                created_at,
                summary.as_deref(),
            ));
        }
    }

    // 2. Apps en panne (probe live bornée, en parallèle).
    let statuses = futures_util::future::join_all(projects.iter().map(|p| {
        let state = state.clone();
        async move {
            let fut = async {
                if probe {
                    crate::routes::resolve_project_status_live(&state, p).await
                } else {
                    crate::routes::resolve_project_status_db(&state, p).await
                }
            };
            match tokio::time::timeout(std::time::Duration::from_secs(8), fut).await {
                Ok(Ok(s)) => s,
                _ => p.status.clone(),
            }
        }
    }))
    .await;
    let mut summary = Vec::with_capacity(projects.len());
    for (p, status) in projects.iter().zip(statuses.iter()) {
        if let Some(e) = app_down_event(p, status, &now_s) {
            events.push(e);
        }
        summary.push(json!({"uuid": p.uuid, "name": p.name, "status": status}));
    }

    // 3. Specs en attente de validation explicite (lecture seule du workdir).
    for p in &projects {
        let root = crate::spec_routes::workdir_of(&p.uuid, p.workdir.as_deref());
        if !root.exists() {
            continue;
        }
        if let Ok(features) = devforge_agent::sdd::list_features(&root) {
            events.extend(features.iter().filter_map(|f| spec_waiting_event(p, f)));
        }
    }

    events.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(Json(json!({
        "data": {
            "events": events,
            "projects": summary,
            "since": since,
            "server_time": now_s,
        }
    })))
}

/// Ce que la dernière réplique attend de toi. Une spec à valider prime ; sinon, si Braise a
/// parlé en dernier : un plan à lancer, ou une question. Rien si c'est toi qui as parlé en dernier.
pub fn conversation_waiting(
    last_role: &str,
    content: &str,
    tool_calls_json: &str,
    spec_waiting: bool,
) -> Option<&'static str> {
    if spec_waiting {
        return Some("spec");
    }
    if last_role != "assistant" {
        return None;
    }
    if has_plan(tool_calls_json) {
        return Some("plan");
    }
    let tail = content.trim_end().trim_end_matches(|c: char| !c.is_alphanumeric() && c != '?' && c != '？');
    if tail.ends_with('?') || tail.ends_with('？') {
        return Some("question");
    }
    None
}

/// Même règle que l'app : un appel `propose_plan` dont le résultat porte un plan titré.
fn has_plan(tool_calls_json: &str) -> bool {
    serde_json::from_str::<Vec<Value>>(tool_calls_json)
        .unwrap_or_default()
        .iter()
        .any(|tc| {
            tc.get("name").and_then(Value::as_str) == Some("propose_plan")
                && tc.pointer("/result/plan/title").is_some()
        })
}

/// Extrait lisible d'une réplique (sans balisage markdown courant), sur une ligne.
pub fn excerpt(content: &str, max: usize) -> String {
    let flat: String = content
        .lines()
        .map(|l| l.trim().trim_start_matches(['#', '>', '-', '*', ' ']).trim())
        .filter(|l| !l.is_empty() && !l.starts_with("```"))
        .collect::<Vec<_>>()
        .join(" ")
        .replace("**", "")
        .replace('`', "");
    if flat.chars().count() <= max {
        flat
    } else {
        let cut: String = flat.chars().take(max.saturating_sub(1)).collect();
        format!("{}…", cut.trim_end())
    }
}

async fn conversations(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let (_user, workspace) = crate::auth_routes::current_workspace(&state, &headers)
        .await
        .map_err(ApiError::from_auth)?;

    let projects = sqlx::query_as::<_, Project>(
        "SELECT * FROM projects WHERE workspace_uuid = $1 ORDER BY updated_at DESC",
    )
    .bind(&workspace.uuid)
    .fetch_all(&state.pool)
    .await
    .map_err(ApiError::from)?;

    // Dernière réplique (toi ou Braise) de chaque fil coordinateur.
    let last: Vec<(String, String, String, String, String, String)> = sqlx::query_as(
        r#"SELECT DISTINCT ON (m.project_uuid)
                  m.project_uuid, m.role, m.content, m.tool_calls_json, m.created_at, a.status
           FROM agent_messages m
           JOIN project_agents a ON a.uuid = m.agent_uuid AND a.role = 'coordinator'
           JOIN projects p ON p.uuid = m.project_uuid
           WHERE p.workspace_uuid = $1 AND m.role IN ('user', 'assistant')
           ORDER BY m.project_uuid, m.id DESC"#,
    )
    .bind(&workspace.uuid)
    .fetch_all(&state.pool)
    .await
    .map_err(ApiError::from)?;

    let mut items: Vec<Value> = Vec::new();
    for p in &projects {
        let spec = {
            let root = crate::spec_routes::workdir_of(&p.uuid, p.workdir.as_deref());
            if root.exists() {
                devforge_agent::sdd::list_features(&root)
                    .ok()
                    .and_then(|fs| fs.into_iter().find(|f| f.phase == "awaiting_validation" && !f.dismissed))
            } else {
                None
            }
        };
        let row = last.iter().find(|r| r.0 == p.uuid);
        if row.is_none() && spec.is_none() {
            continue;
        }
        let (role, content, tools, created_at, agent_status) = row
            .map(|r| (r.1.as_str(), r.2.as_str(), r.3.as_str(), r.4.clone(), r.5.as_str()))
            .unwrap_or(("", "", "[]", String::new(), "idle"));
        let waiting = conversation_waiting(role, content, tools, spec.is_some());
        let created = spec
            .as_ref()
            .map(|f| f.updated_at.clone())
            .filter(|u| u > &created_at)
            .unwrap_or(created_at);
        items.push(json!({
            "project_uuid": p.uuid,
            "project_name": p.name,
            "production_url": p.production_url,
            "git_repository": p.git_repository,
            "last_role": role,
            "excerpt": excerpt(content, 160),
            "created_at": created,
            "waiting": waiting,
            "spec_title": spec.as_ref().map(|f| f.title.clone()),
            "working": agent_status == "working",
        }));
    }
    // En attente d'abord, puis les plus récentes.
    items.sort_by(|a, b| {
        let wa = a["waiting"].is_null();
        let wb = b["waiting"].is_null();
        wa.cmp(&wb).then_with(|| {
            b["created_at"].as_str().unwrap_or("").cmp(a["created_at"].as_str().unwrap_or(""))
        })
    });
    Ok(Json(json!({ "data": { "conversations": items } })))
}

#[cfg(test)]
#[path = "mobile_routes_tests.rs"]
mod tests;
