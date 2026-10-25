//! P2 : reçus d'approbation — API, branchement des confirmations (déployer, reconstruire,
//! redémarrer, arrêter, publier) et réconciliation avec l'issue des déploiements.
//! Le cœur (hash, usage unique, 30 min, `unknown` au redémarrage) est dans
//! `devforge_agent::receipts`, partagé avec la boucle d'agent.

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::get,
    Json, Router,
};
use devforge_agent::receipts::{self as core, NewReceipt, Receipt};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::auth_routes::UserRow;
use crate::routes::ApiError;
use crate::state::{AppState, Project};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/receipts", get(list_receipts))
        .route("/api/v1/receipts/{uuid}", get(get_receipt))
}

pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::Error> {
    core::migrate(pool).await
}

/// Issue d'un déploiement → issue du reçu (`success` → done, `failed`/`cancelled` → failed).
/// Éclaircit aussi un `unknown` quand le déploiement repris après redémarrage se termine.
pub async fn reconcile(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let r = sqlx::query(
        r#"UPDATE approval_receipts r
           SET status = CASE WHEN d.status = 'success' THEN 'done' ELSE 'failed' END,
               version = COALESCE(NULLIF(NULLIF(d.git_sha, 'pending'), 'unknown'), r.version),
               detail = CASE
                   WHEN d.status = 'success' AND r.status = 'unknown'
                       THEN 'Terminé après un redémarrage de DevForge.'
                   WHEN d.status = 'success' THEN r.detail
                   WHEN d.status = 'cancelled' THEN 'Déploiement annulé (arrêté ou remplacé par un plus récent).'
                   ELSE COALESCE(d.error_summary, 'Échec du déploiement')
               END,
               finished_at = now(), updated_at = now()
           FROM deployments d
           WHERE r.deployment_uuid = d.uuid
             AND r.status IN ('executing', 'unknown')
             AND d.status IN ('success', 'failed', 'cancelled')"#,
    )
    .execute(pool)
    .await?;
    Ok(r.rows_affected())
}

/// Au démarrage : actions coupées → `unknown` (jamais rejouées), puis ce qui est déjà connu.
pub async fn recover_at_boot(pool: &PgPool) {
    match core::mark_interrupted(pool).await {
        Ok(0) => {}
        Ok(n) => tracing::warn!(
            count = n,
            "reçus : actions coupées par le redémarrage → issue inconnue"
        ),
        Err(e) => tracing::error!(error = %e, "reçus : reprise au démarrage"),
    }
    let _ = reconcile(pool).await;
    let _ = core::expire_stale(pool).await;
}

/// D'où vient la confirmation : en-tête explicite, sinon déduit du client.
pub fn source_from_headers(headers: &HeaderMap) -> String {
    let explicit = headers
        .get("x-devforge-client")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim().to_lowercase())
        .unwrap_or_default();
    if matches!(explicit.as_str(), "web" | "android" | "api" | "agent") {
        return explicit;
    }
    let ua = headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    if ua.contains("okhttp") || ua.contains("devforge-android") {
        "android".into()
    } else if ua.contains("mozilla") {
        "web".into()
    } else {
        "api".into()
    }
}

pub fn user_label(user: &UserRow) -> String {
    let name = user.name.trim();
    if name.is_empty() {
        user.email.clone()
    } else {
        name.to_string()
    }
}

/// Libellé français d'une action confirmée.
pub fn action_label(action: &str) -> &'static str {
    match action {
        "deploy" => "Mettre en ligne",
        "rebuild" => "Reconstruire",
        "retry" => "Relancer la mise en ligne",
        "publish" => "Publier sur GitHub",
        "restart" => "Redémarrer",
        "stop" => "Arrêter",
        "build" => "Reconstruire l'image",
        "cancel_deploy" => "Arrêter un déploiement",
        "publish_approval" => "Accord de publication à l'agent",
        _ => "Action",
    }
}

/// Action de déploiement annoncée par le client (`deploy` par défaut).
pub fn deploy_action(requested: Option<&str>) -> &'static str {
    match requested.map(|s| s.trim().to_lowercase()).as_deref() {
        Some("rebuild") => "rebuild",
        Some("retry") => "retry",
        Some("publish") => "publish",
        _ => "deploy",
    }
}

/// Reçu d'une action confirmée dans l'UI, lancée tout de suite (validation consommée).
/// Ne bloque jamais l'action : une erreur d'écriture est seulement journalisée.
pub async fn begin_for_user(
    pool: &PgPool,
    headers: &HeaderMap,
    user: &UserRow,
    project: &Project,
    action: &str,
    target: Option<String>,
    version: Option<String>,
) -> Option<String> {
    let version = version
        .filter(|v| !v.trim().is_empty() && v != "pending")
        .or_else(|| project.git_branch.clone().filter(|b| !b.trim().is_empty()));
    let r = NewReceipt {
        workspace_uuid: Some(project.workspace_uuid.clone()),
        project_uuid: Some(project.uuid.clone()),
        project_name: Some(project.name.clone()),
        action: action.to_string(),
        action_label: action_label(action).to_string(),
        target: target.unwrap_or_else(|| project.name.clone()),
        version,
        source: source_from_headers(headers),
        approved_by: Some(user.uuid.clone()),
        approved_by_label: Some(user_label(user)),
        ..Default::default()
    };
    match core::begin(pool, &r).await {
        Ok(uuid) => Some(uuid),
        Err(e) => {
            tracing::warn!(error = %e, action, "reçu non enregistré");
            None
        }
    }
}

pub async fn finish(pool: &PgPool, receipt: Option<&String>, ok: bool, detail: Option<&str>) {
    if let Some(uuid) = receipt {
        let status = if ok { "done" } else { "failed" };
        if let Err(e) = core::finish(pool, uuid, status, detail).await {
            tracing::warn!(error = %e, "issue du reçu non enregistrée");
        }
    }
}

pub async fn link_deployment(pool: &PgPool, receipt: Option<&String>, deployment_uuid: &str) {
    if let Some(uuid) = receipt {
        let _ = core::link_deployment(pool, uuid, deployment_uuid).await;
    }
}

/// L'utilisateur donne l'accord de publication : reçu + propositions de l'agent approuvées.
pub async fn record_publish_approval(
    pool: &PgPool,
    headers: &HeaderMap,
    user: &UserRow,
    project: &Project,
) {
    let label = user_label(user);
    let approved = core::approve_pending(pool, &project.uuid, Some(&user.uuid), Some(&label))
        .await
        .unwrap_or(0);
    let r = NewReceipt {
        workspace_uuid: Some(project.workspace_uuid.clone()),
        project_uuid: Some(project.uuid.clone()),
        project_name: Some(project.name.clone()),
        action: "publish_approval".into(),
        action_label: action_label("publish_approval").into(),
        target: project.name.clone(),
        version: project.git_branch.clone(),
        source: source_from_headers(headers),
        approved_by: Some(user.uuid.clone()),
        approved_by_label: Some(label),
        detail: Some(if approved > 0 {
            format!("Accord de 15 min ; {approved} action(s) de l'agent validée(s).")
        } else {
            "Accord de 15 min pour les actions distantes de l'agent.".into()
        }),
        ..Default::default()
    };
    if let Err(e) = core::record_done(pool, &r).await {
        tracing::warn!(error = %e, "reçu d'accord non enregistré");
    }
}

#[derive(Debug, Deserialize, Default)]
pub struct ListQuery {
    pub project: Option<String>,
    /// Liste séparée par des virgules : done,failed,unknown…
    pub status: Option<String>,
    pub action: Option<String>,
    pub source: Option<String>,
    /// Curseur : reçus créés avant cette date (RFC 3339).
    pub before: Option<String>,
    pub limit: Option<i64>,
}

fn csv(v: &Option<String>) -> Option<Vec<String>> {
    let items: Vec<String> = v
        .as_deref()
        .unwrap_or("")
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    (!items.is_empty()).then_some(items)
}

pub async fn list_for_workspace(
    pool: &PgPool,
    workspace_uuid: &str,
    q: &ListQuery,
) -> Result<Vec<Receipt>, sqlx::Error> {
    let _ = core::expire_stale(pool).await;
    let _ = reconcile(pool).await;
    let limit = q.limit.unwrap_or(50).clamp(1, 200);
    let before = q
        .before
        .as_deref()
        .and_then(|b| chrono::DateTime::parse_from_rfc3339(b.trim()).ok())
        .map(|d| d.with_timezone(&chrono::Utc));
    sqlx::query_as::<_, Receipt>(
        r#"SELECT r.* FROM approval_receipts r
           WHERE (r.workspace_uuid = $1
                  OR r.project_uuid IN (SELECT uuid FROM projects WHERE workspace_uuid = $1))
             AND ($2::text IS NULL OR r.project_uuid = $2)
             AND ($3::text[] IS NULL OR r.status = ANY($3))
             AND ($4::text[] IS NULL OR r.action = ANY($4))
             AND ($5::text IS NULL OR r.source = $5)
             AND ($6::timestamptz IS NULL OR r.created_at < $6)
           ORDER BY r.created_at DESC
           LIMIT $7"#,
    )
    .bind(workspace_uuid)
    .bind(q.project.as_deref().filter(|p| !p.trim().is_empty()))
    .bind(csv(&q.status))
    .bind(csv(&q.action))
    .bind(q.source.as_deref().filter(|p| !p.trim().is_empty()))
    .bind(before)
    .bind(limit)
    .fetch_all(pool)
    .await
}

pub async fn get_for_workspace(
    pool: &PgPool,
    workspace_uuid: &str,
    uuid: &str,
) -> Result<Option<Receipt>, sqlx::Error> {
    let _ = reconcile(pool).await;
    sqlx::query_as::<_, Receipt>(
        r#"SELECT r.* FROM approval_receipts r
           WHERE r.uuid = $2
             AND (r.workspace_uuid = $1
                  OR r.project_uuid IN (SELECT uuid FROM projects WHERE workspace_uuid = $1))"#,
    )
    .bind(workspace_uuid)
    .bind(uuid)
    .fetch_optional(pool)
    .await
}

/// GET /api/v1/receipts?project=&status=done,failed&action=&source=&before=&limit=
async fn list_receipts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<ListQuery>,
) -> Result<Json<Value>, ApiError> {
    let (_user, workspace) = crate::auth_routes::current_workspace(&state, &headers)
        .await
        .map_err(ApiError::from_auth)?;
    let rows = list_for_workspace(&state.pool, &workspace.uuid, &q)
        .await
        .map_err(ApiError::from)?;
    let limit = q.limit.unwrap_or(50).clamp(1, 200) as usize;
    let next_before = (rows.len() == limit)
        .then(|| rows.last().map(|r| r.created_at.to_rfc3339()))
        .flatten();
    Ok(Json(json!({"data": rows, "next_before": next_before})))
}

/// GET /api/v1/receipts/{uuid}
async fn get_receipt(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (_user, workspace) = crate::auth_routes::current_workspace(&state, &headers)
        .await
        .map_err(ApiError::from_auth)?;
    let row = get_for_workspace(&state.pool, &workspace.uuid, &uuid)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("receipt"))?;
    Ok(Json(json!({"data": row})))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn pool_with_projects() -> PgPool {
        let pool = devforge_database::ephemeral_pg().await;
        crate::db::migrate(&pool).await.unwrap();
        // Migration rejouable sans erreur (ADD/CREATE IF NOT EXISTS).
        crate::db::migrate(&pool).await.unwrap();
        for (id, uuid, ws) in [(1, "p1", "ws1"), (2, "p2", "ws2")] {
            sqlx::query("INSERT INTO projects (id, uuid, name, slug, workspace_uuid, created_at, updated_at) VALUES ($1,$2,$2,$2,$3,'x','x')")
                .bind(id as i64).bind(uuid).bind(ws).execute(&pool).await.unwrap();
        }
        pool
    }

    fn new(project: &str, action: &str) -> NewReceipt {
        NewReceipt {
            project_uuid: Some(project.into()),
            action: action.into(),
            action_label: action_label(action).into(),
            target: project.into(),
            approved_by: Some("u1".into()),
            approved_by_label: Some("Mathieu".into()),
            ..Default::default()
        }
    }

    async fn deployment(pool: &PgPool, uuid: &str, status: &str, err: Option<&str>) {
        sqlx::query("INSERT INTO deployments (uuid, project_id, status, git_sha, error_summary, created_at, updated_at) VALUES ($1, 1, $2, 'abc1234', $3, 'x', 'x')")
            .bind(uuid).bind(status).bind(err).execute(pool).await.unwrap();
    }

    #[tokio::test]
    async fn deployment_outcome_settles_receipt() {
        let pool = pool_with_projects().await;
        let ok = core::begin(&pool, &new("p1", "deploy")).await.unwrap();
        let ko = core::begin(&pool, &new("p1", "rebuild")).await.unwrap();
        let running = core::begin(&pool, &new("p1", "retry")).await.unwrap();
        deployment(&pool, "d-ok", "success", None).await;
        deployment(&pool, "d-ko", "failed", Some("npm build a échoué")).await;
        deployment(&pool, "d-run", "running", None).await;
        core::link_deployment(&pool, &ok, "d-ok").await.unwrap();
        core::link_deployment(&pool, &ko, "d-ko").await.unwrap();
        core::link_deployment(&pool, &running, "d-run")
            .await
            .unwrap();

        assert_eq!(reconcile(&pool).await.unwrap(), 2);
        let ok = core::get(&pool, &ok).await.unwrap().unwrap();
        assert_eq!(
            (ok.status.as_str(), ok.version.as_deref()),
            ("done", Some("abc1234"))
        );
        let ko = core::get(&pool, &ko).await.unwrap().unwrap();
        assert_eq!(ko.status, "failed");
        assert_eq!(ko.detail.as_deref(), Some("npm build a échoué"));
        assert_eq!(
            core::get(&pool, &running).await.unwrap().unwrap().status,
            "executing"
        );
    }

    #[tokio::test]
    async fn boot_marks_unknown_then_late_success_clears_it() {
        let pool = pool_with_projects().await;
        let r = core::begin(&pool, &new("p1", "deploy")).await.unwrap();
        deployment(&pool, "d1", "running", None).await;
        core::link_deployment(&pool, &r, "d1").await.unwrap();
        recover_at_boot(&pool).await;
        assert_eq!(
            core::get(&pool, &r).await.unwrap().unwrap().status,
            "unknown"
        );
        sqlx::query("UPDATE deployments SET status = 'success' WHERE uuid = 'd1'")
            .execute(&pool)
            .await
            .unwrap();
        reconcile(&pool).await.unwrap();
        let got = core::get(&pool, &r).await.unwrap().unwrap();
        assert_eq!(got.status, "done");
        assert!(got.detail.unwrap().contains("redémarrage"));
    }

    #[tokio::test]
    async fn list_is_scoped_to_workspace_and_filtered() {
        let pool = pool_with_projects().await;
        let a = core::begin(&pool, &new("p1", "stop")).await.unwrap();
        core::finish(&pool, &a, "done", None).await.unwrap();
        let b = core::begin(&pool, &new("p1", "restart")).await.unwrap();
        core::finish(&pool, &b, "failed", Some("boom"))
            .await
            .unwrap();
        let other = core::begin(&pool, &new("p2", "stop")).await.unwrap();

        let all = list_for_workspace(&pool, "ws1", &ListQuery::default())
            .await
            .unwrap();
        assert_eq!(all.len(), 2);
        assert!(all.iter().all(|r| r.project_uuid.as_deref() == Some("p1")));
        assert_eq!(all[0].uuid, b, "plus récent d'abord");

        let failed = list_for_workspace(
            &pool,
            "ws1",
            &ListQuery {
                status: Some("failed,unknown".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(failed.len(), 1);
        let stops = list_for_workspace(
            &pool,
            "ws1",
            &ListQuery {
                action: Some("stop".into()),
                limit: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(stops.len(), 1);
        assert_eq!(stops[0].uuid, a);

        assert!(get_for_workspace(&pool, "ws1", &other)
            .await
            .unwrap()
            .is_none());
        assert!(get_for_workspace(&pool, "ws2", &other)
            .await
            .unwrap()
            .is_some());
    }

    #[test]
    fn source_and_action_detection() {
        let mut h = HeaderMap::new();
        h.insert("x-devforge-client", "android".parse().unwrap());
        assert_eq!(source_from_headers(&h), "android");
        let mut h = HeaderMap::new();
        h.insert(
            axum::http::header::USER_AGENT,
            "okhttp/4.12".parse().unwrap(),
        );
        assert_eq!(source_from_headers(&h), "android");
        let mut h = HeaderMap::new();
        h.insert(
            axum::http::header::USER_AGENT,
            "Mozilla/5.0".parse().unwrap(),
        );
        assert_eq!(source_from_headers(&h), "web");
        assert_eq!(source_from_headers(&HeaderMap::new()), "api");
        assert_eq!(deploy_action(Some("Rebuild")), "rebuild");
        assert_eq!(deploy_action(Some("n'importe")), "deploy");
        assert_eq!(deploy_action(None), "deploy");
    }
}
