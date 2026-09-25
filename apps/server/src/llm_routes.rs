//! LLM catalog + multi-provider configs (UX type MCP).

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::FromRow;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/llm/catalog", get(llm_catalog))
        .route(
            "/api/v1/llm/providers",
            get(list_providers).post(upsert_provider),
        )
        .route(
            "/api/v1/llm/providers/{id}",
            axum::routing::delete(delete_provider),
        )
        .route("/api/v1/llm/providers/{id}/test", post(test_provider))
        .route(
            "/api/v1/llm/providers/{id}/activate",
            post(activate_provider),
        )
        .route("/api/v1/llm/providers/reorder", post(reorder_providers))
        .route("/api/v1/llm/providers/probe", post(probe_all_providers))
        .route("/api/v1/llm/status", get(llm_status))
        .route(
            "/api/v1/llm/connect",
            post(llm_connect).delete(llm_disconnect),
        )
        .route("/api/v1/llm/models", post(llm_list_models))
        .route(
            "/api/v1/llm/agents-provider",
            get(get_agents_provider).put(set_agents_provider),
        )
}

/// Provider des agents autonomes (Coordinateur, auto-réparation…). `null` = ordre de la chaîne.
async fn get_agents_provider(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let user_uuid = require_user(&state, &headers).await?;
    let id = crate::user_prefs::agents_llm_provider(&state.pool, &user_uuid).await;
    Ok(Json(json!({
        "provider_id": if id.is_empty() { Value::Null } else { json!(id) },
    })))
}

#[derive(Deserialize)]
pub struct AgentsProviderBody {
    pub provider_id: Option<String>,
}

async fn set_agents_provider(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<AgentsProviderBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let user_uuid = require_user(&state, &headers).await?;
    let id = body.provider_id.unwrap_or_default().trim().to_string();
    if !id.is_empty() {
        let exists: Option<(String,)> =
            sqlx::query_as("SELECT id FROM llm_providers WHERE id = $1 AND user_uuid = $2")
                .bind(&id)
                .bind(&user_uuid)
                .fetch_optional(&state.pool)
                .await
                .ok()
                .flatten();
        if exists.is_none() {
            return Err((
                axum::http::StatusCode::NOT_FOUND,
                Json(json!({"error": "provider introuvable"})),
            ));
        }
    }
    crate::user_prefs::set_agents_llm_provider(&state.pool, &user_uuid, &id)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        })?;
    Ok(Json(json!({
        "ok": true,
        "provider_id": if id.is_empty() { Value::Null } else { json!(id) },
    })))
}

async fn require_user(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<String, (axum::http::StatusCode, Json<Value>)> {
    let (user, _) = crate::auth_routes::current_workspace(state, headers).await?;
    Ok(user.uuid)
}

fn chain_label(rows: &[ProviderRow]) -> String {
    let enabled: Vec<&ProviderRow> = rows.iter().filter(|r| r.enabled != 0).collect();
    match enabled.len() {
        0 => "stub".into(),
        1 => enabled[0].name.clone(),
        _ => format!(
            "chain:{}",
            enabled
                .iter()
                .map(|r| r.name.as_str())
                .collect::<Vec<_>>()
                .join(">")
        ),
    }
}

fn now_str() -> String {
    chrono::Utc::now().to_rfc3339()
}

async fn llm_catalog() -> Json<Value> {
    Json(devforge_llm::catalog_as_json())
}

#[derive(FromRow)]
struct ProviderRow {
    id: String,
    catalog_id: String,
    name: String,
    provider: String,
    api_key: String,
    base_url: String,
    model: String,
    is_default: i64,
    enabled: i64,
    priority: i64,
    healthy: i64,
    last_probe_at: String,
    last_probe_error: String,
    resolved_model: String,
}

fn present(row: &ProviderRow) -> Value {
    let masked = if row.api_key.is_empty() {
        String::new()
    } else if row.api_key.len() <= 8 {
        "••••".into()
    } else {
        format!(
            "{}…{}",
            &row.api_key[..4.min(row.api_key.len())],
            &row.api_key[row.api_key.len().saturating_sub(4)..]
        )
    };
    json!({
        "id": row.id,
        "catalog_id": row.catalog_id,
        "name": row.name,
        "provider": row.provider,
        "base_url": row.base_url,
        "model": row.model,
        "is_default": row.is_default != 0,
        "enabled": row.enabled != 0,
        "priority": row.priority,
        "has_api_key": !row.api_key.is_empty(),
        "key_hint": masked,
        "healthy": row.healthy != 0,
        "last_probe_at": row.last_probe_at,
        "last_probe_error": row.last_probe_error,
        "resolved_model": row.resolved_model,
        "in_chain": row.enabled != 0 && row.healthy != 0,
    })
}

const SELECT_PROVIDERS: &str = "SELECT id, catalog_id, name, provider, api_key, base_url, model, is_default, enabled, priority, COALESCE(healthy, 1) as healthy, COALESCE(last_probe_at, '') as last_probe_at, COALESCE(last_probe_error, '') as last_probe_error, COALESCE(resolved_model, '') as resolved_model FROM llm_providers WHERE user_uuid = $1 ORDER BY priority ASC, name ASC";

const SELECT_ONE: &str = "SELECT id, catalog_id, name, provider, api_key, base_url, model, is_default, enabled, priority, COALESCE(healthy, 1) as healthy, COALESCE(last_probe_at, '') as last_probe_at, COALESCE(last_probe_error, '') as last_probe_error, COALESCE(resolved_model, '') as resolved_model FROM llm_providers WHERE id = $1 AND user_uuid = $2";

async fn list_providers(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let user_uuid = require_user(&state, &headers).await?;
    let rows = sqlx::query_as::<_, ProviderRow>(SELECT_PROVIDERS)
        .bind(&user_uuid)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        })?;

    // L’admin récupère l’ancienne config d’instance une seule fois, sur son compte.
    if rows.is_empty() {
        let is_admin: Option<(String,)> = sqlx::query_as("SELECT role FROM users WHERE uuid = $1")
            .bind(&user_uuid)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
        if is_admin
            .as_ref()
            .is_some_and(|(role,)| role == "instance_admin")
        {
            let legacy: Option<(String, String, String, String)> = sqlx::query_as(
                "SELECT llm_provider, llm_api_key, llm_model, llm_base_url FROM instance_settings WHERE id = 1",
            )
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
            if let Some((prov, key, model, base)) = legacy {
                if prov != "stub" && (!key.is_empty() || !base.is_empty() || prov == "ollama") {
                    let id = uuid::Uuid::new_v4().to_string();
                    let now = now_str();
                    let name = format!("{prov} (migré)");
                    let _ = sqlx::query(
                        r#"INSERT INTO llm_providers (id, catalog_id, name, provider, api_key, base_url, model, is_default, enabled, priority, user_uuid, created_at, updated_at)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 1, 0, $8, $9, $10)"#,
                    )
                    .bind(&id)
                    .bind(&prov)
                    .bind(&name)
                    .bind(&prov)
                    .bind(&key)
                    .bind(&base)
                    .bind(&model)
                    .bind(&user_uuid)
                    .bind(&now)
                    .bind(&now)
                    .execute(&state.pool)
                    .await;
                    let rows = sqlx::query_as::<_, ProviderRow>(SELECT_PROVIDERS)
                        .bind(&user_uuid)
                        .fetch_all(&state.pool)
                        .await
                        .unwrap_or_default();
                    return Ok(Json(json!({
                        "data": rows.iter().map(present).collect::<Vec<_>>(),
                        "active_mode": chain_label(&rows),
                    })));
                }
            }
        }
    }

    Ok(Json(json!({
        "data": rows.iter().map(present).collect::<Vec<_>>(),
        "active_mode": chain_label(&rows),
    })))
}

#[derive(Deserialize)]
pub struct UpsertProviderBody {
    pub id: Option<String>,
    pub catalog_id: Option<String>,
    pub name: Option<String>,
    pub provider: Option<String>,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub is_default: Option<bool>,
    pub enabled: Option<bool>,
    pub fields: Option<std::collections::HashMap<String, String>>,
}

async fn upsert_provider(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<UpsertProviderBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let user_uuid = require_user(&state, &headers).await?;
    let fields = body.fields.unwrap_or_default();
    let catalog_id = body
        .catalog_id
        .or_else(|| fields.get("catalog_id").cloned())
        .unwrap_or_default();
    let preset = if !catalog_id.is_empty() {
        devforge_llm::find_preset(&catalog_id)
    } else {
        None
    };
    let provider = body
        .provider
        .or_else(|| preset.as_ref().map(|p| p.provider.clone()))
        .unwrap_or_else(|| "openai".into());
    let name = body
        .name
        .filter(|s| !s.trim().is_empty())
        .or_else(|| preset.as_ref().map(|p| p.name.clone()))
        .unwrap_or_else(|| provider.clone());
    let mut api_key = body
        .api_key
        .or_else(|| fields.get("api_key").cloned())
        .unwrap_or_default();
    let mut base_url = body
        .base_url
        .or_else(|| fields.get("base_url").cloned())
        .unwrap_or_else(|| {
            preset
                .as_ref()
                .and_then(|p| p.default_url.clone())
                .unwrap_or_default()
        });
    let model = body
        .model
        .or_else(|| fields.get("model").cloned())
        .unwrap_or_else(|| "auto".into());
    let prefer_first = body.is_default.unwrap_or(false);
    let enabled = body.enabled.unwrap_or(true);
    let now = now_str();

    let next_priority: i64 = if prefer_first {
        0
    } else {
        let max: Option<(i64,)> = sqlx::query_as(
            "SELECT COALESCE(MAX(priority), -1) FROM llm_providers WHERE user_uuid = $1",
        )
        .bind(&user_uuid)
        .fetch_optional(&state.pool)
        .await
        .ok()
        .flatten();
        max.map(|(m,)| m + 1).unwrap_or(0)
    };

    let id = if let Some(existing) = body.id.filter(|s| !s.is_empty()) {
        // Preserve key if empty on update
        if api_key.trim().is_empty() {
            let stored: Option<(String,)> = sqlx::query_as(
                "SELECT api_key FROM llm_providers WHERE id = $1 AND user_uuid = $2",
            )
            .bind(&existing)
            .bind(&user_uuid)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
            if let Some((k,)) = stored {
                api_key = k;
            }
        }
        if base_url.trim().is_empty() {
            if let Some(def) = preset.as_ref().and_then(|p| p.default_url.clone()) {
                base_url = def;
            }
        }
        let prio: i64 = if prefer_first {
            0
        } else {
            let cur: Option<(i64,)> = sqlx::query_as(
                "SELECT priority FROM llm_providers WHERE id = $1 AND user_uuid = $2",
            )
            .bind(&existing)
            .bind(&user_uuid)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
            cur.map(|(p,)| p).unwrap_or(next_priority)
        };
        if prefer_first {
            // Décale les autres pour laisser la place en tête
            sqlx::query("UPDATE llm_providers SET priority = priority + 1 WHERE id != $1 AND user_uuid = $2")
                .bind(&existing)
                .bind(&user_uuid)
                .execute(&state.pool)
                .await
                .ok();
        }
        sqlx::query(
            r#"UPDATE llm_providers SET catalog_id=$1, name=$2, provider=$3, api_key=$4, base_url=$5, model=$6, is_default=$7, enabled=$8, priority=$9, updated_at=$10 WHERE id=$11 AND user_uuid=$12"#,
        )
        .bind(&catalog_id)
        .bind(&name)
        .bind(&provider)
        .bind(&api_key)
        .bind(&base_url)
        .bind(&model)
        .bind(if prefer_first { 1 } else { 0 })
        .bind(if enabled { 1 } else { 0 })
        .bind(prio)
        .bind(&now)
        .bind(&existing)
        .bind(&user_uuid)
        .execute(&state.pool)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        })?;
        existing
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        if prefer_first {
            sqlx::query("UPDATE llm_providers SET priority = priority + 1 WHERE user_uuid = $1")
                .bind(&user_uuid)
                .execute(&state.pool)
                .await
                .ok();
        }
        sqlx::query(
            r#"INSERT INTO llm_providers (id, catalog_id, name, provider, api_key, base_url, model, is_default, enabled, priority, user_uuid, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)"#,
        )
        .bind(&id)
        .bind(&catalog_id)
        .bind(&name)
        .bind(&provider)
        .bind(&api_key)
        .bind(&base_url)
        .bind(&model)
        .bind(if prefer_first { 1 } else { 0 })
        .bind(if enabled { 1 } else { 0 })
        .bind(next_priority)
        .bind(&user_uuid)
        .bind(&now)
        .bind(&now)
        .execute(&state.pool)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        })?;
        id
    };

    state.reload_llm_chain().await.map_err(|e| {
        (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    let row = sqlx::query_as::<_, ProviderRow>(SELECT_ONE)
        .bind(&id)
        .bind(&user_uuid)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        })?;

    Ok(Json(
        json!({ "data": present(&row), "active_mode": row.name }),
    ))
}

async fn activate_row(
    state: &AppState,
    id: &str,
    user_uuid: &str,
) -> Result<(), (axum::http::StatusCode, Json<Value>)> {
    // Passe en tête de priorité (0) et décale les autres du même compte
    sqlx::query(
        "UPDATE llm_providers SET priority = priority + 1 WHERE id != $1 AND user_uuid = $2",
    )
    .bind(id)
    .bind(user_uuid)
    .execute(&state.pool)
    .await
    .map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    sqlx::query(
        "UPDATE llm_providers SET priority = 0, is_default = 1, enabled = 1, updated_at = $1 WHERE id = $2 AND user_uuid = $3",
    )
    .bind(now_str())
    .bind(id)
    .bind(user_uuid)
    .execute(&state.pool)
    .await
    .map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    sqlx::query("UPDATE llm_providers SET is_default = 0 WHERE id != $1 AND user_uuid = $2")
        .bind(id)
        .bind(user_uuid)
        .execute(&state.pool)
        .await
        .ok();
    state.reload_llm_chain().await.map_err(|e| {
        (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    Ok(())
}

async fn delete_provider(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let user_uuid = require_user(&state, &headers).await?;
    sqlx::query("DELETE FROM llm_providers WHERE id = $1 AND user_uuid = $2")
        .bind(&id)
        .bind(&user_uuid)
        .execute(&state.pool)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        })?;
    let remaining: Option<(i64,)> =
        sqlx::query_as("SELECT COUNT(*) FROM llm_providers WHERE enabled = 1 AND user_uuid = $1")
            .bind(&user_uuid)
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
    let mode = if remaining == Some((0,)) || remaining.is_none() {
        "stub"
    } else {
        "configured"
    };
    Ok(Json(json!({"ok": true, "active_mode": mode})))
}

async fn test_provider(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let user_uuid = require_user(&state, &headers).await?;
    let row = sqlx::query_as::<_, ProviderRow>(SELECT_ONE)
        .bind(&id)
        .bind(&user_uuid)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        })?
        .ok_or_else(|| {
            (
                axum::http::StatusCode::NOT_FOUND,
                Json(json!({"error": "provider introuvable"})),
            )
        })?;

    let result = persist_probe(&state, &row).await;
    if result.ok {
        // Recharge la chaîne pour inclure ce provider s’il était KO
        let _ = state.reload_llm_chain().await;
        Ok(Json(json!({
            "ok": true,
            "message": result.message,
            "resolved_model": result.resolved_model,
            "latency_ms": result.latency_ms,
            "active_mode": row.name,
        })))
    } else {
        let _ = state.reload_llm_chain().await;
        Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({
                "ok": false,
                "error": result.error.clone().unwrap_or_else(|| "probe failed".into()),
                "resolved_model": result.resolved_model,
                "latency_ms": result.latency_ms,
                "active_mode": row.name,
            })),
        ))
    }
}

async fn persist_probe(state: &AppState, row: &ProviderRow) -> devforge_llm::ProbeResult {
    let result = devforge_llm::probe(&devforge_llm::ProbeRequest {
        provider: row.provider.clone(),
        base_url: row.base_url.clone(),
        api_key: row.api_key.clone(),
        model: row.model.clone(),
    })
    .await;
    let now = now_str();
    let _ = sqlx::query(
        r#"UPDATE llm_providers
           SET healthy = $1, last_probe_at = $2, last_probe_error = $3, resolved_model = $4
           WHERE id = $5"#,
    )
    .bind(if result.ok { 1i64 } else { 0i64 })
    .bind(&now)
    .bind(result.error.as_deref().unwrap_or(""))
    .bind(&result.resolved_model)
    .bind(&row.id)
    .execute(&state.pool)
    .await;
    result
}

/// Probe tous les providers enabled — seuls les healthy restent dans la chaîne.
async fn probe_all_providers(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let user_uuid = require_user(&state, &headers).await?;
    let rows = sqlx::query_as::<_, ProviderRow>(SELECT_PROVIDERS)
        .bind(&user_uuid)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        })?;
    for row in rows.iter().filter(|r| r.enabled != 0) {
        persist_probe(&state, row).await;
    }

    let rows = sqlx::query_as::<_, ProviderRow>(SELECT_PROVIDERS)
        .bind(&user_uuid)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        })?;

    let results: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.id,
                "name": row.name,
                "ok": row.healthy != 0 && row.enabled != 0,
                "skipped": row.enabled == 0,
                "message": if row.enabled == 0 {
                    "désactivé".into()
                } else if row.healthy != 0 {
                    format!("OK · {}", row.resolved_model)
                } else {
                    row.last_probe_error.clone()
                },
                "error": if row.healthy == 0 && row.enabled != 0 {
                    Some(row.last_probe_error.clone())
                } else {
                    None
                },
                "resolved_model": row.resolved_model,
            })
        })
        .collect();

    let healthy = results
        .iter()
        .filter(|r| r["ok"].as_bool() == Some(true))
        .count();
    Ok(Json(json!({
        "ok": true,
        "healthy": healthy,
        "total": results.len(),
        "results": results,
        "active_mode": chain_label(&rows),
    })))
}

/// Remonte en priorité 1 (tête de chaîne).
async fn activate_provider(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let user_uuid = require_user(&state, &headers).await?;
    activate_row(&state, &id, &user_uuid).await?;
    Ok(Json(json!({
        "ok": true,
        "active_mode": "configured",
    })))
}

#[derive(Deserialize)]
pub struct ReorderBody {
    /// Liste ordonnée des ids (index 0 = priorité la plus haute).
    pub ordered_ids: Vec<String>,
}

async fn reorder_providers(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<ReorderBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let user_uuid = require_user(&state, &headers).await?;
    let now = now_str();
    for (i, id) in body.ordered_ids.iter().enumerate() {
        sqlx::query(
            "UPDATE llm_providers SET priority = $1, is_default = $2, updated_at = $3 WHERE id = $4 AND user_uuid = $5",
        )
        .bind(i as i64)
        .bind(if i == 0 { 1 } else { 0 })
        .bind(&now)
        .bind(id)
        .bind(&user_uuid)
        .execute(&state.pool)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        })?;
    }
    Ok(Json(json!({
        "ok": true,
        "active_mode": "configured",
    })))
}

// --- Legacy single-config endpoints (compat Settings) ---

async fn llm_status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let user_uuid = require_user(&state, &headers).await?;
    let rows = sqlx::query_as::<_, ProviderRow>(SELECT_PROVIDERS)
        .bind(&user_uuid)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        })?;
    let active = rows.iter().find(|r| r.enabled != 0);
    let provider = active
        .map(|r| r.provider.clone())
        .unwrap_or_else(|| "stub".into());
    let key = active.map(|r| r.api_key.clone()).unwrap_or_default();
    let model = active
        .map(|r| r.model.clone())
        .unwrap_or_else(|| "gpt-4o-mini".into());
    let base = active.map(|r| r.base_url.clone()).unwrap_or_default();
    let mode = chain_label(&rows);
    let masked = if key.is_empty() {
        String::new()
    } else if key.len() <= 8 {
        "••••".into()
    } else {
        format!("{}…{}", &key[..4], &key[key.len() - 4..])
    };
    Ok(Json(json!({
        "mode": mode,
        "provider": provider,
        "model": model,
        "base_url": base,
        "has_key": !key.is_empty(),
        "key_hint": masked,
    })))
}

#[derive(Deserialize)]
pub struct LlmConnectBody {
    pub provider: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub base_url: Option<String>,
}

async fn llm_connect(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<LlmConnectBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let user_uuid = require_user(&state, &headers).await?;
    let provider = body.provider.unwrap_or_else(|| "openai".into());
    let mut api_key = body.api_key.unwrap_or_default();
    let model = body.model.unwrap_or_else(|| "gpt-4o-mini".into());
    let base_url = body.base_url.unwrap_or_default();
    if api_key.trim().is_empty() {
        let stored: Option<(String,)> =
            sqlx::query_as(
                "SELECT api_key FROM llm_providers WHERE user_uuid = $1 AND api_key <> '' ORDER BY priority ASC LIMIT 1",
            )
                .bind(&user_uuid)
                .fetch_optional(&state.pool)
                .await
                .map_err(|e| {
                    (
                        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({"error": e.to_string()})),
                    )
                })?;
        if let Some((k,)) = stored {
            api_key = k;
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_str();
    sqlx::query(
        r#"INSERT INTO llm_providers (id, catalog_id, name, provider, api_key, base_url, model, is_default, enabled, priority, user_uuid, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 1, 0, $8, $9, $10)"#,
    )
    .bind(&id)
    .bind(&provider)
    .bind(&provider)
    .bind(&provider)
    .bind(&api_key)
    .bind(&base_url)
    .bind(&model)
    .bind(&user_uuid)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(|e| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    Ok(Json(json!({
        "ok": true,
        "mode": provider,
        "provider": provider,
        "model": model,
    })))
}

async fn llm_disconnect(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let user_uuid = require_user(&state, &headers).await?;
    sqlx::query("UPDATE llm_providers SET enabled = 0, is_default = 0 WHERE user_uuid = $1")
        .bind(&user_uuid)
        .execute(&state.pool)
        .await
        .map_err(|e| {
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": e.to_string()})),
            )
        })?;
    Ok(Json(json!({"ok": true, "mode": "stub"})))
}

#[derive(Deserialize)]
pub struct LlmModelsBody {
    pub provider: Option<String>,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
}

async fn llm_list_models(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<LlmModelsBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    let user_uuid = require_user(&state, &headers).await?;
    let provider = body
        .provider
        .unwrap_or_else(|| "openai".into())
        .trim()
        .to_lowercase();
    let mut api_key = body.api_key.unwrap_or_default();
    let mut base_url = body.base_url.unwrap_or_default().trim().to_string();

    if api_key.trim().is_empty() || base_url.is_empty() {
        // xAI : ne jamais réutiliser la clé d'un autre fournisseur.
        let sql = if provider == "xai" {
            "SELECT api_key, base_url FROM llm_providers WHERE user_uuid = $1 AND provider = 'xai' ORDER BY priority ASC LIMIT 1"
        } else {
            "SELECT api_key, base_url FROM llm_providers WHERE user_uuid = $1 AND enabled = 1 ORDER BY priority ASC LIMIT 1"
        };
        let row: Option<(String, String)> =
            sqlx::query_as(sql)
                .bind(&user_uuid)
                .fetch_optional(&state.pool)
                .await
                .map_err(|e| {
                    (
                        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({"error": e.to_string()})),
                    )
                })?;
        if let Some((stored_key, stored_base)) = row {
            if api_key.trim().is_empty() {
                api_key = stored_key;
            }
            if base_url.is_empty() {
                base_url = stored_base;
            }
        }
    }

    if base_url.is_empty() {
        if provider == "ollama" {
            base_url = "http://127.0.0.1:11434".into();
        } else if let Some(def) =
            devforge_llm::OpenAiCompatibleProvider::default_base_url(&provider)
        {
            base_url = def.to_string();
        } else if let Some(p) = devforge_llm::find_preset(&provider) {
            if let Some(u) = p.default_url {
                base_url = u;
            }
        }
    }
    if base_url.is_empty() {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"error": "renseigne l’URL de l’API pour charger les modèles"})),
        ));
    }

    let is_custom_endpoint = !base_url.is_empty()
        && !base_url.contains("api.openai.com")
        && !base_url.contains("openrouter.ai")
        && !base_url.contains("generativelanguage.googleapis.com");
    if matches!(
        provider.as_str(),
        "openai" | "openrouter" | "auto" | "gemini" | "anthropic"
    ) && api_key.trim().is_empty()
        && !is_custom_endpoint
        && provider != "ollama"
    {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(
                json!({"error": format!("Une clé API est requise pour lister les modèles {provider}.")}),
            ),
        ));
    }

    let models = devforge_llm::OpenAiCompatibleProvider::list_models_for_provider(
        if provider == "gemini" || provider == "anthropic" {
            "openai"
        } else {
            &provider
        },
        &base_url,
        &api_key,
    )
    .await
    .map_err(|e| {
        (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({"error": e.to_string()})),
        )
    })?;

    Ok(Json(json!({
        "ok": true,
        "base_url": base_url,
        "models": models,
    })))
}
