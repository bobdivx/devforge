use crate::auth_routes::{bearer_from, current_workspace, resolve_auth, user_team};
use crate::routes::ApiError;
use crate::state::{AppState, Project};
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use chrono::Utc;
use devforge_auth::{has_ability, ABILITY_READ, ABILITY_WRITE};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/mcp/catalog", get(list_catalog))
        .route(
            "/api/v1/mcp/servers",
            get(list_mcp_servers).post(upsert_mcp_server),
        )
        .route("/api/v1/mcp/servers/{id}", delete(delete_mcp_server))
        .route("/api/v1/mcp/servers/{id}/tools", get(list_mcp_remote_tools))
        .route(
            "/api/v1/mcp/servers/{id}/resources",
            get(list_mcp_resources),
        )
        .route("/api/v1/mcp/tools", get(list_local_mcp_tools))
        .route("/api/v1/mcp", post(mcp_jsonrpc))
        .route("/mcp", post(mcp_jsonrpc))
        .route(
            "/api/v1/projects/{uuid}/resources",
            get(list_project_resources).post(link_project_resource),
        )
        .route(
            "/api/v1/projects/{uuid}/resources/{link_id}",
            delete(unlink_project_resource),
        )
}

async fn workspace_uuid(state: &AppState, headers: &HeaderMap) -> Result<String, ApiError> {
    let (_user, team) = current_workspace(state, headers)
        .await
        .map_err(|(status, Json(v))| ApiError {
            status,
            message: v
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("auth")
                .to_string(),
        })?;
    Ok(team.uuid)
}

async fn list_catalog(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let _ = workspace_uuid(&state, &headers).await?;
    Ok(Json(devforge_mcp::catalog_as_json()))
}

async fn list_mcp_servers(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let ws = workspace_uuid(&state, &headers).await?;
    let servers = state.mcp.clients.list_for_workspace(&ws).await;
    Ok(Json(json!({
        "data": servers.iter().map(|s| s.public_view()).collect::<Vec<_>>()
    })))
}

#[derive(Deserialize)]
pub struct UpsertMcpBody {
    pub id: Option<String>,
    pub catalog_id: Option<String>,
    pub name: Option<String>,
    pub url: Option<String>,
    pub enabled: Option<bool>,
    pub headers: Option<HashMap<String, String>>,
    pub meta: Option<HashMap<String, String>>,
    pub secrets: Option<HashMap<String, String>>,
    pub fields: Option<HashMap<String, String>>,
}

async fn upsert_mcp_server(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<UpsertMcpBody>,
) -> Result<Json<Value>, ApiError> {
    let ws = workspace_uuid(&state, &headers).await?;
    let mut fields = body.fields.unwrap_or_default();
    let catalog_id = body
        .catalog_id
        .or_else(|| fields.remove("catalog_id"))
        .filter(|s| !s.is_empty());

    let preset = catalog_id.as_deref().and_then(devforge_mcp::find_preset);

    let mut secrets = body.secrets.unwrap_or_default();
    let mut meta = body.meta.unwrap_or_default();
    let mut headers_map = body.headers.unwrap_or_default();
    let mut url = body.url.unwrap_or_default();
    let mut name = body.name.unwrap_or_default();

    if let Some(ref p) = preset {
        if name.trim().is_empty() {
            name = p.name.clone();
        }
        if url.trim().is_empty() {
            if let Some(u) = fields.remove("url") {
                url = u;
            } else if let Some(ref d) = p.default_url {
                url = d.clone();
            }
        }
        for f in &p.fields {
            if f.key == "url" || f.key == "name" {
                continue;
            }
            if let Some(val) = fields.remove(&f.key) {
                if val.trim().is_empty() {
                    continue;
                }
                if f.secret {
                    secrets.insert(f.key.clone(), val);
                } else {
                    meta.insert(f.key.clone(), val);
                }
            }
        }
    } else {
        if let Some(u) = fields.remove("url") {
            url = u;
        }
        if let Some(n) = fields.remove("name") {
            name = n;
        }
        if let Some(auth) = fields.remove("auth_header") {
            if !auth.trim().is_empty() {
                headers_map.insert("Authorization".into(), auth);
            }
        }
        for (k, v) in fields {
            if v.trim().is_empty() {
                continue;
            }
            if k.contains("token") || k.contains("key") || k.contains("secret") {
                secrets.insert(k, v);
            } else {
                meta.insert(k, v);
            }
        }
    }

    if name.trim().is_empty() {
        return Err(ApiError::message("name requis"));
    }

    let existing_id = body.id.clone().unwrap_or_default();
    if !existing_id.is_empty() {
        if let Some(prev) = state.mcp.clients.get(&existing_id).await {
            for (k, v) in prev.secrets {
                secrets.entry(k).or_insert(v);
            }
            for (k, v) in prev.meta {
                meta.entry(k).or_insert(v);
            }
            if url.trim().is_empty() {
                url = prev.url;
            }
        }
    }

    if !url.is_empty() {
        if let Some(tok) = secrets
            .get("api_token")
            .or_else(|| secrets.get("api_key"))
            .or_else(|| secrets.get("access_token"))
            .or_else(|| secrets.get("bot_token"))
            .or_else(|| secrets.get("token"))
            .or_else(|| secrets.get("auth_token"))
            .or_else(|| secrets.get("secret_key"))
            .or_else(|| secrets.get("integration_token"))
        {
            headers_map
                .entry("Authorization".into())
                .or_insert_with(|| format!("Bearer {tok}"));
        }
    }

    let cfg = state
        .mcp
        .clients
        .upsert(devforge_mcp::McpServerConfig {
            id: existing_id,
            name: name.trim().to_string(),
            url: url.trim().to_string(),
            enabled: body.enabled.unwrap_or(true),
            headers: headers_map,
            catalog_id,
            meta,
            secrets,
            workspace_uuid: ws,
        })
        .await;

    persist_mcp(&state, &cfg).await?;
    Ok(Json(json!({ "data": cfg.public_view() })))
}

async fn delete_mcp_server(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let ws = workspace_uuid(&state, &headers).await?;
    if let Some(s) = state.mcp.clients.get(&id).await {
        if !s.workspace_uuid.is_empty() && s.workspace_uuid != ws {
            return Err(ApiError::not_found("mcp server"));
        }
    }
    let ok = state.mcp.clients.remove(&id).await;
    sqlx::query("DELETE FROM mcp_servers WHERE id = ?")
        .bind(&id)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(json!({ "ok": ok })))
}

async fn list_mcp_remote_tools(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let tools = state
        .mcp
        .clients
        .list_remote_tools(&id)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;
    Ok(Json(json!({ "data": tools })))
}

async fn list_local_mcp_tools(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let _ = workspace_uuid(&state, &headers).await?;
    Ok(Json(json!({ "data": state.mcp.server.tools_list_payload().await })))
}

#[derive(Deserialize)]
struct JsonRpcRequest {
    #[serde(default)]
    jsonrpc: Option<String>,
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Option<Value>,
}

/// Endpoint MCP JSON-RPC pour clients externes (Cursor, Claude…).
/// Auth: Bearer session `df_…` ou API token `dfat_…`.
async fn mcp_jsonrpc(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<JsonRpcRequest>,
) -> Result<Json<Value>, ApiError> {
    let token = bearer_from(&headers).ok_or_else(|| ApiError {
        status: axum::http::StatusCode::UNAUTHORIZED,
        message: "Bearer token requis (dfat_… ou session)".into(),
    })?;
    let (user, abilities) = resolve_auth(&state, &token)
        .await
        .map_err(|(status, Json(v))| ApiError {
            status,
            message: v
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("auth")
                .to_string(),
        })?
        .ok_or_else(|| ApiError {
            status: axum::http::StatusCode::UNAUTHORIZED,
            message: "Token invalide ou expiré".into(),
        })?;
    let _team = user_team(&state, &user.uuid)
        .await
        .map_err(|(status, Json(v))| ApiError {
            status,
            message: v
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("auth")
                .to_string(),
        })?
        .ok_or_else(|| ApiError {
            status: axum::http::StatusCode::FORBIDDEN,
            message: "Aucun workspace".into(),
        })?;

    if !has_ability(&abilities, ABILITY_READ) {
        return Err(ApiError {
            status: axum::http::StatusCode::FORBIDDEN,
            message: "Ability `read` requise".into(),
        });
    }

    let id = body.id.clone().unwrap_or(Value::Null);
    let rpc_ok = |result: Value| {
        Json(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result,
        }))
    };
    let rpc_err = |code: i64, message: &str| {
        Json(json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message },
        }))
    };

    match body.method.as_str() {
        "initialize" => Ok(rpc_ok(json!({
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": {
                "name": "devforge",
                "version": env!("CARGO_PKG_VERSION"),
            },
        }))),
        "notifications/initialized" | "notifications/cancelled" => Ok(rpc_ok(json!({}))),
        "ping" => Ok(rpc_ok(json!({}))),
        "tools/list" => {
            let payload = state.mcp.server.tools_list_payload().await;
            let tools = payload.get("tools").cloned().unwrap_or_else(|| json!([]));
            // MCP expects inputSchema; our ToolDefinition uses `parameters`.
            let mapped: Vec<Value> = tools
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .map(|t| {
                    json!({
                        "name": t.get("name"),
                        "description": t.get("description"),
                        "inputSchema": t.get("inputSchema")
                            .or_else(|| t.get("parameters"))
                            .cloned()
                            .unwrap_or_else(|| json!({"type":"object","properties":{}})),
                    })
                })
                .collect();
            Ok(rpc_ok(json!({ "tools": mapped })))
        }
        "tools/call" => {
            if !has_ability(&abilities, ABILITY_WRITE) {
                return Ok(rpc_err(-32001, "Ability `write` requise pour tools/call"));
            }
            let params = body.params.unwrap_or(json!({}));
            let name = params
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("")
                .to_string();
            if name.is_empty() {
                return Ok(rpc_err(-32602, "params.name requis"));
            }
            let arguments = params.get("arguments").cloned().unwrap_or(json!({}));
            match state.registry.execute(&name, arguments).await {
                Ok(result) => Ok(rpc_ok(json!({
                    "content": [{
                        "type": "text",
                        "text": serde_json::to_string_pretty(&result).unwrap_or_else(|_| result.to_string()),
                    }],
                    "isError": false,
                }))),
                Err(e) => Ok(rpc_ok(json!({
                    "content": [{ "type": "text", "text": e.to_string() }],
                    "isError": true,
                }))),
            }
        }
        other => Ok(rpc_err(-32601, &format!("Method not found: {other}"))),
    }
}

async fn list_mcp_resources(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let ws = workspace_uuid(&state, &headers).await?;
    let server = state
        .mcp
        .clients
        .get(&id)
        .await
        .ok_or_else(|| ApiError::not_found("mcp server"))?;
    if !server.workspace_uuid.is_empty() && server.workspace_uuid != ws {
        return Err(ApiError::not_found("mcp server"));
    }
    let catalog = server.catalog_id.as_deref().unwrap_or("");
    if catalog == "turso" {
        let token = server
            .secrets
            .get("api_token")
            .map(String::as_str)
            .unwrap_or("");
        let org = server.meta.get("org").map(String::as_str).unwrap_or("");
        let dbs = devforge_mcp::list_databases(token, org)
            .await
            .map_err(|e| ApiError::message(e.to_string()))?;
        return Ok(Json(json!({
            "ok": true,
            "kind": "database",
            "provider": "turso",
            "data": dbs,
        })));
    }
    Err(ApiError::message(format!(
        "Pas de ressources listables pour « {catalog} » — configure Turso pour lier des DBs"
    )))
}

#[derive(Deserialize)]
pub struct LinkResourceBody {
    pub server_id: String,
    pub resource_id: String,
    pub resource_name: Option<String>,
    pub hostname: Option<String>,
}

async fn link_project_resource(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
    Json(body): Json<LinkResourceBody>,
) -> Result<Json<Value>, ApiError> {
    let ws = workspace_uuid(&state, &headers).await?;
    let project = fetch_project_ws(&state, &uuid, &ws).await?;
    let server = state
        .mcp
        .clients
        .get(&body.server_id)
        .await
        .ok_or_else(|| ApiError::not_found("mcp server"))?;
    if server.catalog_id.as_deref() != Some("turso") {
        return Err(ApiError::message(
            "Lien ressources supporté pour Turso pour l’instant",
        ));
    }
    let token = server
        .secrets
        .get("api_token")
        .ok_or_else(|| ApiError::message("Turso api_token manquant"))?;
    let org = server
        .meta
        .get("org")
        .ok_or_else(|| ApiError::message("Turso org manquant"))?;
    let db_name = body
        .resource_name
        .clone()
        .unwrap_or_else(|| body.resource_id.clone());
    let hostname = if let Some(h) = body.hostname.filter(|h| !h.is_empty()) {
        h
    } else {
        let dbs = devforge_mcp::list_databases(token, org)
            .await
            .map_err(|e| ApiError::message(e.to_string()))?;
        dbs.into_iter()
            .find(|d| d.name == db_name || d.db_id.as_deref() == Some(body.resource_id.as_str()))
            .map(|d| d.hostname)
            .ok_or_else(|| ApiError::message(format!("DB Turso introuvable: {db_name}")))?
    };
    let jwt = devforge_mcp::create_db_token(token, org, &db_name)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;
    let libsql = devforge_mcp::libsql_url(&hostname);

    let env_pairs = [
        ("TURSO_DATABASE_URL", libsql.as_str()),
        ("TURSO_AUTH_TOKEN", jwt.as_str()),
        ("DATABASE_URL", libsql.as_str()),
        ("LIBSQL_URL", libsql.as_str()),
    ];
    for (key, value) in env_pairs {
        state
            .env
            .upsert(
                &project.uuid,
                devforge_env::EnvVar {
                    key: key.into(),
                    value: value.into(),
                    secret: true,
                },
            )
            .await
            .map_err(|e| ApiError::message(e.to_string()))?;
    }
    let with_auth = format!("{libsql}?authToken={jwt}");
    state
        .env
        .upsert(
            &project.uuid,
            devforge_env::EnvVar {
                key: "TURSO_DATABASE_URL_AUTH".into(),
                value: with_auth,
                secret: true,
            },
        )
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;

    let link_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let meta = json!({
        "hostname": hostname,
        "org": org,
        "libsql_url": libsql,
    });
    sqlx::query(
        r#"
        INSERT INTO project_resource_links (id, project_uuid, provider, server_id, resource_id, resource_name, meta_json, created_at)
        VALUES (?, ?, 'turso', ?, ?, ?, ?, ?)
        ON CONFLICT(project_uuid, provider, resource_id) DO UPDATE SET
            server_id = excluded.server_id,
            resource_name = excluded.resource_name,
            meta_json = excluded.meta_json
        "#,
    )
    .bind(&link_id)
    .bind(&project.uuid)
    .bind(&body.server_id)
    .bind(&body.resource_id)
    .bind(&db_name)
    .bind(meta.to_string())
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(ApiError::from)?;

    Ok(Json(json!({
        "ok": true,
        "provider": "turso",
        "database": db_name,
        "hostname": hostname,
        "env_keys": ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "DATABASE_URL", "LIBSQL_URL", "TURSO_DATABASE_URL_AUTH"],
    })))
}

async fn list_project_resources(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(uuid): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let ws = workspace_uuid(&state, &headers).await?;
    let _ = fetch_project_ws(&state, &uuid, &ws).await?;
    let rows: Vec<(String, String, String, String, String, String, String)> = sqlx::query_as(
        "SELECT id, provider, server_id, resource_id, resource_name, meta_json, created_at FROM project_resource_links WHERE project_uuid = ? ORDER BY created_at DESC",
    )
    .bind(&uuid)
    .fetch_all(&state.pool)
    .await
    .map_err(ApiError::from)?;
    let data: Vec<Value> = rows
        .into_iter()
        .map(|(id, provider, server_id, resource_id, resource_name, meta_json, created_at)| {
            let meta: Value = serde_json::from_str(&meta_json).unwrap_or(json!({}));
            json!({
                "id": id,
                "provider": provider,
                "server_id": server_id,
                "resource_id": resource_id,
                "resource_name": resource_name,
                "meta": meta,
                "created_at": created_at,
            })
        })
        .collect();
    Ok(Json(json!({ "data": data })))
}

async fn unlink_project_resource(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path((uuid, link_id)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let ws = workspace_uuid(&state, &headers).await?;
    let _ = fetch_project_ws(&state, &uuid, &ws).await?;
    let res = sqlx::query("DELETE FROM project_resource_links WHERE id = ? AND project_uuid = ?")
        .bind(&link_id)
        .bind(&uuid)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;
    Ok(Json(json!({ "ok": res.rows_affected() > 0 })))
}

async fn fetch_project_ws(
    state: &AppState,
    uuid: &str,
    workspace_uuid: &str,
) -> Result<Project, ApiError> {
    let p = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE uuid = ?")
        .bind(uuid)
        .fetch_optional(&state.pool)
        .await
        .map_err(ApiError::from)?
        .ok_or_else(|| ApiError::not_found("project"))?;
    if !p.workspace_uuid.is_empty() && p.workspace_uuid != workspace_uuid {
        return Err(ApiError::not_found("project"));
    }
    Ok(p)
}

async fn persist_mcp(
    state: &AppState,
    cfg: &devforge_mcp::McpServerConfig,
) -> Result<(), ApiError> {
    let now = Utc::now().to_rfc3339();
    let headers = serde_json::to_string(&cfg.headers).unwrap_or_else(|_| "{}".into());
    let meta = serde_json::to_string(&cfg.meta).unwrap_or_else(|_| "{}".into());
    let secrets = serde_json::to_string(&cfg.secrets).unwrap_or_else(|_| "{}".into());
    sqlx::query(
        r#"
        INSERT INTO mcp_servers (id, workspace_uuid, name, url, enabled, catalog_id, headers_json, meta_json, secrets_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            workspace_uuid = excluded.workspace_uuid,
            name = excluded.name,
            url = excluded.url,
            enabled = excluded.enabled,
            catalog_id = excluded.catalog_id,
            headers_json = excluded.headers_json,
            meta_json = excluded.meta_json,
            secrets_json = excluded.secrets_json,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(&cfg.id)
    .bind(&cfg.workspace_uuid)
    .bind(&cfg.name)
    .bind(&cfg.url)
    .bind(if cfg.enabled { 1 } else { 0 })
    .bind(&cfg.catalog_id)
    .bind(&headers)
    .bind(&meta)
    .bind(&secrets)
    .bind(&now)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(ApiError::from)?;
    Ok(())
}

pub async fn load_mcp_from_db(state: &AppState) -> Result<(), sqlx::Error> {
    let rows: Vec<(
        String,
        String,
        String,
        String,
        i64,
        Option<String>,
        String,
        String,
        String,
    )> = sqlx::query_as(
        "SELECT id, workspace_uuid, name, url, enabled, catalog_id, headers_json, meta_json, secrets_json FROM mcp_servers",
    )
    .fetch_all(&state.pool)
    .await?;
    for (id, ws, name, url, enabled, catalog_id, headers_json, meta_json, secrets_json) in rows {
        let headers: HashMap<String, String> =
            serde_json::from_str(&headers_json).unwrap_or_default();
        let meta: HashMap<String, String> = serde_json::from_str(&meta_json).unwrap_or_default();
        let secrets: HashMap<String, String> =
            serde_json::from_str(&secrets_json).unwrap_or_default();
        state
            .mcp
            .clients
            .upsert(devforge_mcp::McpServerConfig {
                id,
                name,
                url,
                enabled: enabled != 0,
                headers,
                catalog_id,
                meta,
                secrets,
                workspace_uuid: ws,
            })
            .await;
    }
    Ok(())
}
