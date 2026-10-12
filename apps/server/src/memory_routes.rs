//! Mémoire durable (P3) côté serveur : API « Réglages → Mémoire » (P3-07), écritures
//! automatiques (P3-06), purge planifiée et métriques (P3-08).

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use devforge_memory::{
    rules, ListReq, MemoryItem, MemoryStore, Scope, Tier, WriteOutcome, WriteReq,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

use crate::routes::ApiError;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/memory",
            get(list_memory).post(create_memory).delete(erase_memory),
        )
        .route(
            "/api/v1/memory/{uuid}",
            axum::routing::patch(correct_memory).delete(forget_memory),
        )
        .route("/api/v1/memory/{uuid}/history", get(memory_history))
        .route("/api/v1/memory/{uuid}/pin", post(pin_memory))
        .route("/api/v1/memory/{uuid}/unpin", post(unpin_memory))
}

fn store(state: &AppState) -> Result<Arc<dyn MemoryStore>, ApiError> {
    state
        .registry
        .memory()
        .ok_or_else(|| ApiError::message("mémoire indisponible"))
}

async fn auth(state: &AppState, headers: &HeaderMap) -> Result<(String, String), ApiError> {
    let (user, team) = crate::auth_routes::current_workspace(state, headers)
        .await
        .map_err(ApiError::from_auth)?;
    Ok((user.uuid, team.uuid))
}

fn mem_err(e: devforge_memory::MemoryError) -> ApiError {
    match e {
        devforge_memory::MemoryError::NotFound => ApiError::not_found("souvenir"),
        devforge_memory::MemoryError::Invalid(m) => ApiError::message(m),
        devforge_memory::MemoryError::Db(m) => ApiError {
            status: axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            message: m,
        },
    }
}

/// Propriétaire d'un projet (mémoire des réveils sans utilisateur courant) : owner de
/// l'équipe du projet, sinon premier membre ; projets hérités sans équipe → administrateur.
pub async fn project_owner(pool: &sqlx::PgPool, project_uuid: &str) -> Option<String> {
    let owner: Option<String> = sqlx::query_scalar(
        r#"SELECT tm.user_uuid FROM projects p
           JOIN team_members tm ON tm.team_uuid = p.workspace_uuid
           WHERE p.uuid = $1
           ORDER BY (tm.role = 'owner') DESC, tm.created_at ASC
           LIMIT 1"#,
    )
    .bind(project_uuid)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    if owner.is_some() {
        return owner;
    }
    sqlx::query_scalar(
        r#"SELECT u.uuid FROM users u
           WHERE EXISTS (SELECT 1 FROM projects p WHERE p.uuid = $1 AND p.workspace_uuid = '')
           ORDER BY (u.role = 'admin') DESC, u.created_at ASC LIMIT 1"#,
    )
    .bind(project_uuid)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
}

async fn project_in_workspace(state: &AppState, project_uuid: &str, team_uuid: &str) -> bool {
    sqlx::query_scalar::<_, i64>(
        "SELECT 1::bigint FROM projects WHERE uuid = $1 AND (workspace_uuid = $2 OR workspace_uuid = '')",
    )
    .bind(project_uuid)
    .bind(team_uuid)
    .fetch_optional(&state.pool)
    .await
    .ok()
    .flatten()
    .is_some()
}

async fn project_names(state: &AppState, items: &[MemoryItem]) -> HashMap<String, String> {
    let ids: Vec<String> = items
        .iter()
        .filter_map(|i| i.project_uuid.clone())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    if ids.is_empty() {
        return HashMap::new();
    }
    sqlx::query_as::<_, (String, String)>("SELECT uuid, name FROM projects WHERE uuid = ANY($1)")
        .bind(&ids)
        .fetch_all(&state.pool)
        .await
        .unwrap_or_default()
        .into_iter()
        .collect()
}

async fn agent_names(state: &AppState, items: &[MemoryItem]) -> HashMap<String, String> {
    let ids: Vec<String> = items
        .iter()
        .flat_map(|i| {
            [
                i.scope.agent_id().map(str::to_string),
                i.created_by.strip_prefix("agent:").map(str::to_string),
            ]
        })
        .flatten()
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    if ids.is_empty() {
        return HashMap::new();
    }
    sqlx::query_as::<_, (String, String)>(
        "SELECT uuid, name FROM project_agents WHERE uuid = ANY($1)",
    )
    .bind(&ids)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .collect()
}

fn item_json(
    i: &MemoryItem,
    projects: &HashMap<String, String>,
    agents: &HashMap<String, String>,
) -> Value {
    let by_agent = i.created_by.strip_prefix("agent:");
    json!({
        "uuid": i.uuid,
        "scope": i.scope.name(),
        "project_uuid": i.project_uuid,
        "project_name": i.project_uuid.as_ref().and_then(|p| projects.get(p)),
        "agent_uuid": i.scope.agent_id(),
        "agent_name": i.scope.agent_id().and_then(|a| agents.get(a)),
        "tier": i.tier.as_str(),
        "kind": i.kind,
        "key": i.key,
        "content": i.content,
        "source": i.source,
        "confidence": i.confidence,
        "inferred": i.confidence < 1.0,
        "pinned": i.pinned,
        "created_by": i.created_by,
        "created_by_name": by_agent.and_then(|a| agents.get(a)),
        "created_at": i.created_at.to_rfc3339(),
        "updated_at": i.updated_at.to_rfc3339(),
        "expires_at": i.expires_at.map(|e| e.to_rfc3339()),
        "superseded_by": i.superseded_by,
    })
}

async fn items_json(state: &AppState, items: &[MemoryItem]) -> Vec<Value> {
    let (p, a) = (
        project_names(state, items).await,
        agent_names(state, items).await,
    );
    items.iter().map(|i| item_json(i, &p, &a)).collect()
}

#[derive(Deserialize, Default)]
struct ListQuery {
    scope: Option<String>,
    tier: Option<String>,
    q: Option<String>,
    project_uuid: Option<String>,
    include_superseded: Option<bool>,
    offset: Option<usize>,
    all: Option<bool>,
    confirm: Option<String>,
}

/// Taille du profil toujours injecté (portée utilisateur) pour la barre de budget.
fn profile_usage(items: &[MemoryItem]) -> usize {
    let block = rules::profile_block(items, chrono::Utc::now());
    block
        .text
        .lines()
        .filter(|l| l.starts_with('[') && !l.starts_with("[notes]"))
        .map(|l| l.chars().count() + 1)
        .sum()
}

async fn list_memory(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<ListQuery>,
) -> Result<Json<Value>, ApiError> {
    let (user, _) = auth(&state, &headers).await?;
    let store = store(&state)?;
    let req = ListReq {
        scope: q
            .scope
            .filter(|s| matches!(s.as_str(), "user" | "project" | "agent")),
        tier: q.tier.as_deref().and_then(Tier::parse),
        query: q.q,
        project_uuid: q.project_uuid,
        include_superseded: q.include_superseded.unwrap_or(false),
        limit: devforge_memory::store::MAX_LIST,
        offset: q.offset.unwrap_or(0),
    };
    let items = store.list(&user, &req).await.map_err(mem_err)?;
    let user_profile = store.profile(&user, None, None).await.map_err(mem_err)?;
    let used = profile_usage(&user_profile);
    // Nombre de versions remplacées par entrée (historique dépliable dans l'UI).
    let uuids: Vec<String> = items.iter().map(|i| i.uuid.clone()).collect();
    let versions: HashMap<String, i64> = sqlx::query_as::<_, (String, i64)>(
        "SELECT superseded_by, count(*) FROM agent_memories WHERE user_uuid = $1 AND superseded_by = ANY($2) GROUP BY superseded_by",
    )
    .bind(&user)
    .bind(&uuids)
    .fetch_all(&state.pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .collect();
    let mut out = items_json(&state, &items).await;
    for (v, i) in out.iter_mut().zip(items.iter()) {
        v["versions"] = json!(versions.get(&i.uuid).copied().unwrap_or(0));
    }
    Ok(Json(json!({
        "ok": true,
        "items": out,
        "has_more": items.len() == devforge_memory::store::MAX_LIST,
        "profile_budget": { "used": used, "max": rules::PROFILE_BUDGET },
    })))
}

#[derive(Deserialize)]
struct CreateBody {
    content: String,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    project_uuid: Option<String>,
    #[serde(default)]
    tier: Option<String>,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    key: Option<String>,
    #[serde(default)]
    expires_in_hours: Option<u64>,
}

fn outcome_json(o: WriteOutcome) -> Result<Value, ApiError> {
    match o {
        WriteOutcome::Rejected(e) => Err(ApiError::message(e)),
        WriteOutcome::Superseded { old, new } => {
            Ok(json!({"ok": true, "outcome": "superseded", "uuid": new, "replaced": old}))
        }
        o => Ok(json!({"ok": true, "outcome": o.label(), "uuid": o.uuid()})),
    }
}

async fn create_memory(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(b): Json<CreateBody>,
) -> Result<Json<Value>, ApiError> {
    let (user, team) = auth(&state, &headers).await?;
    let scope = match b.scope.as_deref().unwrap_or("user") {
        "user" => Scope::User,
        "project" => {
            let p = b
                .project_uuid
                .clone()
                .filter(|p| !p.is_empty())
                .ok_or_else(|| ApiError::message("projet requis"))?;
            if !project_in_workspace(&state, &p, &team).await {
                return Err(ApiError::forbidden("projet hors de ton espace"));
            }
            Scope::Project(p)
        }
        _ => return Err(ApiError::message("portée : user ou project")),
    };
    let tier = Tier::parse(b.tier.as_deref().unwrap_or("profile"))
        .ok_or_else(|| ApiError::message("tier inconnu"))?;
    let mut req = WriteReq::new(
        &user,
        scope,
        tier,
        b.kind.as_deref().unwrap_or("fact"),
        &b.content,
    );
    req.key = b.key.filter(|k| !k.trim().is_empty());
    req.source = "user_said".into();
    req.created_by = "user".into();
    req.project_uuid = b.project_uuid;
    req.expires_in = b
        .expires_in_hours
        .map(|h| std::time::Duration::from_secs(h.clamp(1, 168) * 3600));
    let out = store(&state)?.write(req).await.map_err(mem_err)?;
    Ok(Json(outcome_json(out)?))
}

#[derive(Deserialize)]
struct CorrectBody {
    content: String,
}

async fn correct_memory(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(b): Json<CorrectBody>,
) -> Result<Json<Value>, ApiError> {
    let (user, _) = auth(&state, &headers).await?;
    let out = store(&state)?
        .correct(&user, &uuid, &b.content)
        .await
        .map_err(mem_err)?;
    Ok(Json(outcome_json(out)?))
}

async fn forget_memory(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (user, _) = auth(&state, &headers).await?;
    let n = store(&state)?
        .forget(
            &user,
            devforge_memory::ForgetTarget::Uuid(uuid),
            Some("oublié depuis les réglages".into()),
        )
        .await
        .map_err(mem_err)?;
    if n == 0 {
        return Err(ApiError::not_found("souvenir"));
    }
    Ok(Json(json!({"ok": true, "forgotten": n})))
}

/// « Tout effacer » : purge physique, avec confirmation explicite.
async fn erase_memory(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<ListQuery>,
) -> Result<Json<Value>, ApiError> {
    let (user, _) = auth(&state, &headers).await?;
    if q.all != Some(true) || q.confirm.as_deref() != Some("EFFACER") {
        return Err(ApiError::message(
            "confirmation requise : all=true&confirm=EFFACER",
        ));
    }
    let n = store(&state)?.erase_all(&user).await.map_err(mem_err)?;
    tracing::info!(user_uuid = %user, erased = n, "mémoire : tout effacé à la demande de l'utilisateur");
    Ok(Json(json!({"ok": true, "erased": n})))
}

async fn memory_history(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let (user, _) = auth(&state, &headers).await?;
    let items = store(&state)?
        .history(&user, &uuid)
        .await
        .map_err(mem_err)?;
    Ok(Json(
        json!({"ok": true, "items": items_json(&state, &items).await}),
    ))
}

async fn set_pin(
    state: AppState,
    headers: HeaderMap,
    uuid: String,
    pinned: bool,
) -> Result<Json<Value>, ApiError> {
    let (user, _) = auth(&state, &headers).await?;
    if !store(&state)?
        .set_pinned(&user, &uuid, pinned)
        .await
        .map_err(mem_err)?
    {
        return Err(ApiError::not_found("souvenir"));
    }
    Ok(Json(json!({"ok": true, "pinned": pinned})))
}

async fn pin_memory(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    set_pin(state, headers, uuid, true).await
}

async fn unpin_memory(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    set_pin(state, headers, uuid, false).await
}

// ---------------------------------------------------------------------------------------------
// Écritures automatiques (P3-06)
// ---------------------------------------------------------------------------------------------

/// SHA court s'il ressemble à un vrai commit (« pending », « unknown » ignorés).
fn short_sha(sha: &str) -> Option<String> {
    let sha = sha.trim();
    (sha.len() >= 7 && sha.chars().all(|c| c.is_ascii_hexdigit()))
        .then(|| sha.chars().take(7).collect())
}

async fn deployment_sha(state: &AppState, dep_uuid: &str) -> Option<String> {
    let sha: Option<String> = sqlx::query_scalar("SELECT git_sha FROM deployments WHERE uuid = $1")
        .bind(dep_uuid)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten()
        .flatten();
    sha.as_deref().and_then(short_sha)
}

pub(crate) async fn system_write(
    state: &AppState,
    project_uuid: &str,
    kind: &str,
    key: Option<String>,
    content: String,
    source_ref: &str,
) {
    let Some(store) = state.registry.memory() else {
        return;
    };
    let Some(owner) = project_owner(&state.pool, project_uuid).await else {
        tracing::debug!(
            project_uuid,
            "mémoire : pas de propriétaire, journal non écrit"
        );
        return;
    };
    let mut req = WriteReq::new(
        &owner,
        Scope::Project(project_uuid.to_string()),
        Tier::Log,
        kind,
        &content,
    );
    req.key = key;
    req.source = "system".into();
    req.source_ref = Some(source_ref.to_string());
    req.created_by = "system".into();
    match store.write(req).await {
        Ok(WriteOutcome::Rejected(e)) => {
            tracing::info!(project_uuid, error = %e, "mémoire : journal système refusé")
        }
        Ok(_) => {}
        Err(e) => tracing::warn!(project_uuid, error = %e, "mémoire : journal système non écrit"),
    }
}

/// Déploiement réussi et vérifié : une ligne à jour par projet (clé `deploy.last_success`,
/// l'historique reste consultable via les versions remplacées).
pub async fn record_deploy_success(
    state: &AppState,
    project_uuid: &str,
    dep_uuid: &str,
    smoke: &str,
) {
    let sha = deployment_sha(state, dep_uuid)
        .await
        .map(|s| format!(" {s}"))
        .unwrap_or_default();
    let day = chrono::Utc::now().format("%d/%m/%Y");
    system_write(
        state,
        project_uuid,
        "decision",
        Some("deploy.last_success".into()),
        format!("Déploiement{sha} du {day} : succès — smoke {smoke}."),
        dep_uuid,
    )
    .await;
}

/// Cause d'échec (P1-07) : une ligne par cause (clé `wake.cause.<hash>`), le plus récent remplace.
pub async fn record_wake_cause(
    state: &AppState,
    project_uuid: &str,
    dep_uuid: &str,
    cause: &crate::wake_causes::CauseState,
    summary: &str,
) {
    let sha = deployment_sha(state, dep_uuid)
        .await
        .map(|s| format!(" {s}"))
        .unwrap_or_default();
    let decision = match cause.decision {
        crate::wake_causes::WakeDecision::Normal => "réveil et réparation",
        crate::wake_causes::WakeDecision::Escalate => "escalade à l'utilisateur",
        crate::wake_causes::WakeDecision::Silent => "compteur seulement (déjà escaladée)",
    };
    let action = match cause.last_action.as_deref().filter(|a| !a.is_empty()) {
        Some(last) => format!("{decision} (précédente : {last})"),
        None => decision.to_string(),
    };
    let summary: String = summary
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(400)
        .collect();
    let content = format!(
        "Échec de déploiement{sha} : {summary} — cause #{} vue {} fois depuis le {}, dernière action : {action}.",
        cause.hash,
        cause.occurrences,
        cause.first_seen.format("%d/%m/%Y"),
    );
    system_write(
        state,
        project_uuid,
        "incident",
        Some(format!("wake.cause.{}", cause.hash)),
        content,
        dep_uuid,
    )
    .await;
}

// ---------------------------------------------------------------------------------------------
// Purge planifiée & observabilité (P3-08)
// ---------------------------------------------------------------------------------------------

async fn writable(state: &AppState) -> bool {
    state
        .cluster
        .local()
        .await
        .map(|l| !l.writes_fenced && l.role == devforge_cluster::NodeRole::Leader)
        .unwrap_or(false)
}

/// Toutes les heures : notes expirées oubliées. Chaque nuit (~3 h UTC) : métriques.
pub fn spawn_maintenance(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(3600));
        let mut last_metrics_day = None;
        loop {
            interval.tick().await;
            let Some(store) = state.registry.memory() else {
                return;
            };
            if !writable(&state).await {
                continue;
            }
            let n = crate::run_events::purge(&state.pool).await;
            if n > 0 {
                tracing::info!(
                    purged = n,
                    "événements de run de plus de 14 jours supprimés"
                );
            }
            match store.purge_expired().await {
                Ok(0) => {}
                Ok(n) => tracing::info!(purged = n, "mémoire : notes expirées oubliées"),
                Err(e) => tracing::warn!(error = %e, "mémoire : purge impossible"),
            }
            let now = chrono::Utc::now();
            let today = now.date_naive();
            if last_metrics_day.is_none()
                || (last_metrics_day != Some(today) && now.format("%H").to_string() == "03")
            {
                last_metrics_day = Some(today);
                match store.stats().await {
                    Ok(s) => tracing::info!(
                        profile = s.profile,
                        log = s.log,
                        note = s.note,
                        superseded = s.superseded,
                        deleted = s.deleted,
                        secret_rejections = devforge_memory::secrets::rejections(),
                        "mémoire : métriques"
                    ),
                    Err(e) => tracing::warn!(error = %e, "mémoire : métriques illisibles"),
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn full_migration_is_idempotent_and_owner_is_resolved() {
        let pool = devforge_database::ephemeral_pg().await;
        crate::db::migrate(&pool).await.unwrap();
        crate::db::migrate(&pool).await.unwrap();
        for (uuid, email, role) in [
            ("u-admin", "a@x", "admin"),
            ("u-owner", "o@x", "user"),
            ("u-member", "m@x", "user"),
        ] {
            sqlx::query("INSERT INTO users (uuid, email, name, password_hash, role, created_at, updated_at) VALUES ($1,$2,$1,'',$3,'2026-01-01','2026-01-01')")
                .bind(uuid).bind(email).bind(role).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO team_members (team_uuid, user_uuid, role, created_at) VALUES ('t1','u-member','member','2026-01-01'), ('t1','u-owner','owner','2026-02-01')")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO projects (uuid, name, slug, workspace_uuid, created_at, updated_at) VALUES ('p-team','A','a','t1','x','x'), ('p-legacy','B','b','','x','x')")
            .execute(&pool).await.unwrap();
        assert_eq!(
            project_owner(&pool, "p-team").await.as_deref(),
            Some("u-owner")
        );
        assert_eq!(
            project_owner(&pool, "p-legacy").await.as_deref(),
            Some("u-admin")
        );
        assert_eq!(project_owner(&pool, "inconnu").await, None);

        // Table mémoire utilisable après la migration complète ; aucun secret en base.
        let store = devforge_memory::PgMemoryStore::new(pool.clone());
        let r = store
            .write(WriteReq::new(
                "u-owner",
                Scope::Project("p-team".into()),
                Tier::Log,
                "fact",
                "le token est ghp_abcdefghijklmnopqrstuvwxyz0123456789",
            ))
            .await
            .unwrap();
        assert!(matches!(r, WriteOutcome::Rejected(_)));
        let leaked: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM agent_memories WHERE content ~ 'ghp_|sk-|BEGIN'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(leaked, 0);
    }

    #[test]
    fn short_sha_ignores_placeholders() {
        assert_eq!(short_sha("54607a2ecdaf0def").as_deref(), Some("54607a2"));
        assert_eq!(short_sha("pending"), None);
        assert_eq!(short_sha("unknown"), None);
    }

    #[test]
    fn profile_usage_counts_only_profile_lines() {
        assert_eq!(profile_usage(&[]), 0);
    }
}
