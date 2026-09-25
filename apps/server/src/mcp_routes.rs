use crate::auth_routes::{bearer_from, current_workspace, resolve_auth, user_team};
use crate::routes::ApiError;
use crate::state::{AppState, Project};
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use base64::{engine::general_purpose, Engine as _};
use chrono::Utc;
use devforge_auth::{has_ability, ABILITY_READ, ABILITY_WRITE};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use uuid::Uuid;

/// Résout l'URL publique de l'instance dans cet ordre :
/// 1. `instance_url` depuis DB (settings)
/// 2. Dérivé depuis request headers (Host + X-Forwarded-Proto/Forwarded)
/// 3. APP_URL env (fallback optionnel)
///
/// Retourne une erreur seulement si aucune source ne fournit une URL HTTPS valide
/// (ou localhost pour dev).
pub(crate) async fn resolve_public_base_url(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<String, ApiError> {
    // 1. Essayer instance_url depuis DB
    if let Ok(row) =
        sqlx::query_as::<_, (String,)>("SELECT instance_url FROM instance_settings WHERE id = 1")
            .fetch_one(&state.pool)
            .await
    {
        let url = row.0.trim().trim_end_matches('/');
        if !url.is_empty()
            && (url.starts_with("https://")
                || url.starts_with("http://localhost")
                || url.starts_with("http://127.0.0.1"))
        {
            return Ok(url.to_string());
        }
    }

    // 2. Dériver depuis Host + X-Forwarded-Proto/Forwarded
    if let Some(host) = headers.get("host").and_then(|h| h.to_str().ok()) {
        let scheme = if let Some(proto) = headers
            .get("x-forwarded-proto")
            .and_then(|p| p.to_str().ok())
        {
            proto
        } else if let Some(fwd) = headers.get("forwarded").and_then(|f| f.to_str().ok()) {
            // Parser "Forwarded: proto=https;host=..."
            if fwd.contains("proto=https") {
                "https"
            } else if fwd.contains("proto=http") {
                "http"
            } else {
                "http"
            }
        } else {
            "http"
        };

        let derived = format!("{}://{}", scheme, host);
        let trimmed = derived.trim_end_matches('/');

        if trimmed.starts_with("https://")
            || trimmed.starts_with("http://localhost")
            || trimmed.starts_with("http://127.0.0.1")
        {
            return Ok(trimmed.to_string());
        }
    }

    // 3. Fallback APP_URL (optionnel)
    if let Ok(app_url) = std::env::var("APP_URL") {
        let url = app_url.trim().trim_end_matches('/');
        if !url.is_empty()
            && (url.starts_with("https://")
                || url.starts_with("http://localhost")
                || url.starts_with("http://127.0.0.1"))
        {
            return Ok(url.to_string());
        }
    }

    // Échec : aucune source valide
    Err(ApiError {
        status: axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        message: "Impossible de déterminer l'URL publique de l'instance. Configure le domaine public dans Settings → Domaine (instance_url), ou assure-toi que les headers Host/X-Forwarded-Proto sont corrects, ou définis APP_URL en variable d'environnement.".into(),
    })
}

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
        .route(
            "/api/v1/mcp",
            post(mcp_jsonrpc).get(mcp_get).delete(mcp_get),
        )
        .route("/mcp", post(mcp_jsonrpc).get(mcp_get).delete(mcp_get))
        .route(
            "/api/v1/projects/{uuid}/resources",
            get(list_project_resources).post(link_project_resource),
        )
        .route(
            "/api/v1/projects/{uuid}/resources/{link_id}",
            delete(unlink_project_resource),
        )
        // OAuth MCP routes
        .route(
            "/api/v1/mcp/servers/{id}/oauth/start",
            post(start_oauth_flow),
        )
        .route("/api/v1/mcp/oauth/callback", get(oauth_callback))
        .route(
            "/api/v1/mcp/servers/{id}/oauth/disconnect",
            post(disconnect_oauth),
        )
        // Client ID Metadata Document (CIMD)
        .route("/.well-known/oauth-client", get(oauth_client_metadata))
        .route(
            "/api/v1/mcp/oauth/client-metadata.json",
            get(oauth_client_metadata),
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
            let bearer = if tok.starts_with("Bearer ") {
                tok.clone()
            } else {
                format!("Bearer {tok}")
            };
            headers_map.insert("Authorization".into(), bearer);
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
            oauth_access_token: String::new(),
            oauth_refresh_token: String::new(),
            oauth_expires_at: String::new(),
            oauth_scopes: String::new(),
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
    sqlx::query("DELETE FROM mcp_servers WHERE id = $1")
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
    Ok(Json(
        json!({ "data": state.mcp.server.tools_list_payload().await }),
    ))
}

#[derive(Deserialize)]
struct JsonRpcRequest {
    #[serde(default)]
    #[allow(dead_code)]
    jsonrpc: Option<String>,
    #[serde(default)]
    id: Option<Value>,
    #[serde(default)]
    method: String,
    #[serde(default)]
    params: Option<Value>,
}

/// Versions du protocole MCP acceptées (la première = la plus récente).
const MCP_PROTOCOL_VERSIONS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

/// Renvoie la version demandée si supportée, sinon la plus récente.
/// Sans version (anciens clients) : 2024-11-05, comme avant.
pub(crate) fn negotiate_protocol_version(requested: Option<&str>) -> &'static str {
    match requested {
        Some(v) => MCP_PROTOCOL_VERSIONS
            .iter()
            .find(|x| **x == v)
            .copied()
            .unwrap_or(MCP_PROTOCOL_VERSIONS[0]),
        None => "2024-11-05",
    }
}

enum McpAuthError {
    Missing,
    Invalid,
    Other(ApiError),
}

/// Bearer accepté sur le MCP : session `df_…`, API token `dfat_…` ou access token OAuth `dfoa_…`.
async fn mcp_authenticate(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(crate::auth_routes::UserRow, Vec<String>), McpAuthError> {
    let token = bearer_from(headers).ok_or(McpAuthError::Missing)?;
    if token.starts_with(crate::mcp_oauth::ACCESS_TOKEN_PREFIX) {
        return match crate::mcp_oauth::resolve_access_token(&state.pool, &token).await {
            Ok(Some(found)) => Ok(found),
            Ok(None) => Err(McpAuthError::Invalid),
            Err(e) => Err(McpAuthError::Other(ApiError::from(e))),
        };
    }
    match resolve_auth(state, &token).await {
        Ok(Some(found)) => Ok(found),
        Ok(None) => Err(McpAuthError::Invalid),
        Err(err) => Err(McpAuthError::Other(ApiError::from_auth(err))),
    }
}

fn mcp_path(uri: &axum::http::Uri) -> &'static str {
    if uri.path().trim_end_matches('/') == "/mcp" {
        "/mcp"
    } else {
        "/api/v1/mcp"
    }
}

/// 401 + `WWW-Authenticate: Bearer resource_metadata=…` (découverte OAuth, RFC 9728).
async fn mcp_unauthorized(
    state: &AppState,
    headers: &HeaderMap,
    path: &str,
    invalid: bool,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let message = if invalid {
        "Token invalide ou expiré"
    } else {
        "Bearer token requis (dfat_… ou session)"
    };
    let mut res = ApiError {
        status: axum::http::StatusCode::UNAUTHORIZED,
        message: message.into(),
    }
    .into_response();
    if let Ok(base) = resolve_public_base_url(state, headers).await {
        if let Ok(v) = axum::http::HeaderValue::from_str(&crate::mcp_oauth::www_authenticate(
            &base, path, invalid,
        )) {
            res.headers_mut()
                .insert(axum::http::header::WWW_AUTHENTICATE, v);
        }
    }
    res
}

async fn mcp_auth_or_response(
    state: &AppState,
    headers: &HeaderMap,
    path: &str,
) -> Result<(crate::auth_routes::UserRow, Vec<String>), axum::response::Response> {
    use axum::response::IntoResponse;
    match mcp_authenticate(state, headers).await {
        Ok(found) => Ok(found),
        Err(McpAuthError::Missing) => Err(mcp_unauthorized(state, headers, path, false).await),
        Err(McpAuthError::Invalid) => Err(mcp_unauthorized(state, headers, path, true).await),
        Err(McpAuthError::Other(e)) => Err(e.into_response()),
    }
}

/// GET/DELETE sur l'endpoint MCP : pas de flux SSE serveur ni de session à fermer.
async fn mcp_get(
    State(state): State<AppState>,
    uri: axum::http::Uri,
    headers: HeaderMap,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    if let Err(res) = mcp_auth_or_response(&state, &headers, mcp_path(&uri)).await {
        return res;
    }
    let mut res = (
        axum::http::StatusCode::METHOD_NOT_ALLOWED,
        Json(json!({"ok": false, "error": "Utilise POST (MCP Streamable HTTP, réponses JSON)"})),
    )
        .into_response();
    res.headers_mut().insert(
        axum::http::header::ALLOW,
        axum::http::HeaderValue::from_static("POST"),
    );
    res
}

/// Endpoint MCP (Streamable HTTP, réponses JSON) pour clients externes (Cursor, Claude, Grok…).
/// Auth : Bearer session `df_…`, API token `dfat_…` ou access token OAuth `dfoa_…`.
async fn mcp_jsonrpc(
    State(state): State<AppState>,
    uri: axum::http::Uri,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let path = mcp_path(&uri);
    let (user, abilities) = match mcp_auth_or_response(&state, &headers, path).await {
        Ok(found) => found,
        Err(res) => return res,
    };
    match user_team(&state, &user.uuid).await {
        Ok(Some(_)) => {}
        Ok(None) => {
            return ApiError {
                status: axum::http::StatusCode::FORBIDDEN,
                message: "Aucun workspace".into(),
            }
            .into_response()
        }
        Err(err) => return ApiError::from_auth(err).into_response(),
    }
    if !has_ability(&abilities, ABILITY_READ) {
        return ApiError {
            status: axum::http::StatusCode::FORBIDDEN,
            message: "Ability `read` requise".into(),
        }
        .into_response();
    }

    let parsed: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            return (
                axum::http::StatusCode::BAD_REQUEST,
                Json(json!({
                    "jsonrpc": "2.0",
                    "id": Value::Null,
                    "error": { "code": -32700, "message": format!("Parse error: {e}") },
                })),
            )
                .into_response()
        }
    };

    if let Value::Array(items) = parsed {
        let mut out = Vec::new();
        for item in items {
            if let Some(resp) = mcp_handle_one(&state, &abilities, item).await {
                out.push(resp);
            }
        }
        if out.is_empty() {
            return axum::http::StatusCode::ACCEPTED.into_response();
        }
        return Json(Value::Array(out)).into_response();
    }
    match mcp_handle_one(&state, &abilities, parsed).await {
        Some(resp) => Json(resp).into_response(),
        None => axum::http::StatusCode::ACCEPTED.into_response(),
    }
}

/// Traite un message JSON-RPC. `None` = notification (réponse HTTP 202 sans corps).
async fn mcp_handle_one(state: &AppState, abilities: &[String], raw: Value) -> Option<Value> {
    let body: JsonRpcRequest = match serde_json::from_value(raw) {
        Ok(b) => b,
        Err(e) => {
            return Some(json!({
                "jsonrpc": "2.0",
                "id": Value::Null,
                "error": { "code": -32600, "message": format!("Invalid Request: {e}") },
            }))
        }
    };
    if body.id.is_none() && body.method.starts_with("notifications/") {
        return None;
    }
    let id = body.id.clone().unwrap_or(Value::Null);
    let rpc_ok = |result: Value| {
        Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result,
        }))
    };
    let rpc_err = |code: i64, message: &str| {
        Some(json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message },
        }))
    };

    match body.method.as_str() {
        "initialize" => {
            let requested = body
                .params
                .as_ref()
                .and_then(|p| p.get("protocolVersion"))
                .and_then(|v| v.as_str());
            rpc_ok(json!({
                "protocolVersion": negotiate_protocol_version(requested),
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": {
                    "name": "devforge",
                    "title": "DevForge",
                    "version": env!("CARGO_PKG_VERSION"),
                },
                "instructions": "DevForge : PaaS auto-hébergé. Outils pour lister les projets, lire/écrire des fichiers, déployer, lire les logs et vérifier la santé des applications.",
            }))
        }
        "notifications/initialized" | "notifications/cancelled" => rpc_ok(json!({})),
        "ping" => rpc_ok(json!({})),
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
            rpc_ok(json!({ "tools": mapped }))
        }
        "resources/list" => rpc_ok(json!({ "resources": [] })),
        "prompts/list" => rpc_ok(json!({ "prompts": [] })),
        "tools/call" => {
            if !has_ability(abilities, ABILITY_WRITE) {
                return rpc_err(-32001, "Ability `write` requise pour tools/call");
            }
            let params = body.params.clone().unwrap_or(json!({}));
            let name = params
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("")
                .to_string();
            if name.is_empty() {
                return rpc_err(-32602, "params.name requis");
            }
            let arguments = params.get("arguments").cloned().unwrap_or(json!({}));
            match state.registry.execute(&name, arguments).await {
                Ok(result) => rpc_ok(json!({
                    "content": [{
                        "type": "text",
                        "text": serde_json::to_string_pretty(&result).unwrap_or_else(|_| result.to_string()),
                    }],
                    "isError": false,
                })),
                Err(e) => rpc_ok(json!({
                    "content": [{ "type": "text", "text": e.to_string() }],
                    "isError": true,
                })),
            }
        }
        other => rpc_err(-32601, &format!("Method not found: {other}")),
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
        // Essayer d'abord via MCP tools OAuth (préféré)
        if !server.oauth_access_token.is_empty() {
            match state
                .mcp
                .clients
                .call_remote_tool(&id, "list_databases", json!({}))
                .await
            {
                Ok(result) => {
                    // Le tool list_databases retourne { "databases": [...] }
                    let databases = result
                        .get("databases")
                        .or_else(|| result.get("content"))
                        .and_then(|c| {
                            if c.is_array() {
                                Some(c.clone())
                            } else if let Some(arr) = c.as_array() {
                                Some(json!(arr))
                            } else if let Some(s) = c.as_str() {
                                // Peut-être du JSON stringifié
                                serde_json::from_str::<Value>(s).ok().and_then(|v| {
                                    v.get("databases").or(Some(&v)).and_then(|d| {
                                        if d.is_array() {
                                            Some(d.clone())
                                        } else {
                                            None
                                        }
                                    })
                                })
                            } else {
                                None
                            }
                        })
                        .or_else(|| {
                            // Si result est directement un array
                            if result.is_array() {
                                Some(result.clone())
                            } else {
                                None
                            }
                        })
                        .unwrap_or_else(|| json!([]));

                    // Extraire org si présent (top-level ou dans chaque db)
                    let org_from_response = result
                        .get("organization")
                        .or_else(|| result.get("org"))
                        .or_else(|| result.get("organizationSlug"))
                        .and_then(|o| o.as_str())
                        .map(|s| s.to_string());

                    // Convertir en format attendu par le frontend
                    let dbs: Vec<Value> = databases
                        .as_array()
                        .unwrap_or(&vec![])
                        .iter()
                        .filter_map(|db| {
                            let name = db
                                .get("name")
                                .or_else(|| db.get("Name"))
                                .and_then(|n| n.as_str())?
                                .to_string();
                            let hostname = db
                                .get("hostname")
                                .or_else(|| db.get("Hostname"))
                                .and_then(|h| h.as_str())
                                .unwrap_or("")
                                .to_string();
                            if hostname.is_empty() {
                                return None;
                            }
                            let db_id = db
                                .get("dbId")
                                .or_else(|| db.get("DbId"))
                                .or_else(|| db.get("id"))
                                .and_then(|i| i.as_str())
                                .map(str::to_string);
                            let regions = db
                                .get("regions")
                                .and_then(|r| r.as_array())
                                .map(|arr| {
                                    arr.iter()
                                        .filter_map(|v| v.as_str().map(str::to_string))
                                        .collect()
                                })
                                .unwrap_or_else(|| Vec::new());

                            // Extraire org de chaque db si pas au top-level
                            let org = db
                                .get("organization")
                                .or_else(|| db.get("org"))
                                .or_else(|| db.get("organizationSlug"))
                                .and_then(|o| o.as_str())
                                .map(|s| s.to_string())
                                .or_else(|| org_from_response.clone());

                            let mut obj = json!({
                                "name": name,
                                "hostname": hostname,
                                "regions": regions,
                            });
                            if let Some(id) = db_id {
                                obj["db_id"] = json!(id);
                            }
                            if let Some(o) = org {
                                obj["organization"] = json!(o);
                            }
                            Some(obj)
                        })
                        .collect();

                    return Ok(Json(json!({
                        "ok": true,
                        "kind": "database",
                        "provider": "turso",
                        "data": dbs,
                    })));
                }
                Err(e) => {
                    // Si erreur OAuth, fallback vers Platform API si disponible
                    tracing::warn!(
                        "MCP OAuth list_databases failed, trying Platform API fallback: {}",
                        e
                    );
                }
            }
        }

        // Fallback: Platform API (ancien mode)
        let token = server
            .secrets
            .get("api_token")
            .map(String::as_str)
            .unwrap_or("");
        let org = server.meta.get("org").map(String::as_str).unwrap_or("");
        if token.is_empty() || org.is_empty() {
            return Err(ApiError::message(
                "Turso: Connecte-toi via OAuth (bouton « Se connecter avec OAuth » dans MCP → Turso) OU configure Platform API Token + org dans la section Avancé.".to_string()
            ));
        }
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
    pub org: Option<String>,
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

    let db_name = body
        .resource_name
        .clone()
        .unwrap_or_else(|| body.resource_id.clone());

    // Essayer d'abord via MCP tools OAuth (préféré)
    let (hostname, jwt, org_for_meta) = if !server.oauth_access_token.is_empty() {
        match link_turso_via_mcp(
            &state,
            &body.server_id,
            &db_name,
            body.hostname.as_deref(),
            body.org.as_deref(),
        )
        .await
        {
            Ok((h, j)) => (h, j, String::new()),
            Err(e) => {
                tracing::warn!("MCP OAuth link failed, trying Platform API fallback: {}", e);
                link_turso_via_platform_api(&state, &server, &db_name, &body).await?
            }
        }
    } else {
        link_turso_via_platform_api(&state, &server, &db_name, &body).await?
    };

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
    let mut meta_map = serde_json::Map::new();
    meta_map.insert("hostname".to_string(), json!(hostname));
    meta_map.insert("libsql_url".to_string(), json!(libsql));
    if !org_for_meta.is_empty() {
        meta_map.insert("org".to_string(), json!(org_for_meta));
    }
    let meta = Value::Object(meta_map);
    sqlx::query(
        r#"
        INSERT INTO project_resource_links (id, project_uuid, provider, server_id, resource_id, resource_name, meta_json, created_at)
        VALUES ($1, $2, 'turso', $3, $4, $5, $6, $7)
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
        "SELECT id, provider, server_id, resource_id, resource_name, meta_json, created_at FROM project_resource_links WHERE project_uuid = $1 ORDER BY created_at DESC",
    )
    .bind(&uuid)
    .fetch_all(&state.pool)
    .await
    .map_err(ApiError::from)?;
    let data: Vec<Value> = rows
        .into_iter()
        .map(
            |(id, provider, server_id, resource_id, resource_name, meta_json, created_at)| {
                let mut meta: Value = serde_json::from_str(&meta_json).unwrap_or(json!({}));
                if let Some(obj) = meta.as_object_mut() {
                    obj.remove("password");
                    obj.remove("replication_password");
                }
                json!({
                    "id": id,
                    "provider": provider,
                    "server_id": server_id,
                    "resource_id": resource_id,
                    "resource_name": resource_name,
                    "meta": meta,
                    "created_at": created_at,
                })
            },
        )
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
    let res = sqlx::query("DELETE FROM project_resource_links WHERE id = $1 AND project_uuid = $2")
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
    let p = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE uuid = $1")
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

/// Démarrer le flux OAuth pour un serveur MCP
async fn start_oauth_flow(
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
    if catalog.is_empty() {
        return Err(ApiError::message(
            "catalog_id requis pour déterminer le flux OAuth",
        ));
    }

    // === CAS SPÉCIAL SLACK : Vérifier config AVANT toute tentative OAuth ===
    // Slack MCP ne supporte PAS Dynamic Client Registration (DCR/CIMD).
    // Docs: https://docs.slack.dev/ai/slack-mcp-server/
    // Exige un client_id + client_secret pré-enregistré d'une Slack App.
    if catalog == "slack" {
        let client_id_opt = server
            .secrets
            .get("client_id")
            .or_else(|| server.meta.get("client_id"));

        let client_secret_opt = server.secrets.get("client_secret");

        if client_id_opt.is_none() || client_secret_opt.is_none() {
            return Err(ApiError::message(
                "OAuth Slack requiert une Slack App pré-enregistrée. Crée une app sur https://api.slack.com/apps, configure les Redirect URLs (https://web.jeser.app/api/v1/mcp/oauth/callback) et les scopes user OAuth (search:read.public, chat:write, channels:history), puis renseigne le Client ID et Client Secret dans les champs ci-dessus avant de cliquer sur « Se connecter avec OAuth »."
            ));
        }
    }

    // Générer PKCE + state
    let verifier = devforge_mcp::generate_code_verifier();
    let challenge = devforge_mcp::code_challenge(&verifier);
    let state_param = devforge_mcp::generate_state();

    // Résoudre URL publique (DB settings, headers, ou APP_URL fallback)
    let app_url = resolve_public_base_url(&state, &headers).await?;
    let redirect_uri = format!("{}/api/v1/mcp/oauth/callback", app_url);

    // === CAS SPÉCIAL SLACK : OAuth pré-enregistré (pas de DCR) ===
    if catalog == "slack" {
        // Slack exige client_id + client_secret pré-enregistrés (pas de CIMD/DCR)
        let client_id = server
            .secrets
            .get("client_id")
            .or_else(|| server.meta.get("client_id"))
            .expect("client_id vérifié ci-dessus")
            .clone();

        let _client_secret = server
            .secrets
            .get("client_secret")
            .expect("client_secret vérifié ci-dessus")
            .clone();

        // Endpoints OAuth Slack (user tokens)
        let auth_endpoint = "https://slack.com/oauth/v2_user/authorize";
        let token_endpoint = "https://slack.com/api/oauth.v2.user.access";

        // Scopes Slack minimum pour MCP
        let scopes = vec!["search:read.public", "chat:write", "channels:history"];

        // Construire URL authorization manuellement (pas de build_authorization_url car on skip discovery)
        let mut params = vec![
            ("response_type", "code"),
            ("client_id", client_id.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("state", state_param.as_str()),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
        ];
        let scope_str = scopes.join(" ");
        params.push(("scope", &scope_str));

        let query = params
            .into_iter()
            .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
            .collect::<Vec<_>>()
            .join("&");
        let auth_url = format!("{}?{}", auth_endpoint, query);

        // Stocker état + token_endpoint pour callback
        let now = Utc::now();
        let expires_at = (now + chrono::Duration::minutes(10)).to_rfc3339();
        sqlx::query(
            r#"
            INSERT INTO mcp_oauth_pending (state, server_id, workspace_uuid, code_verifier, redirect_uri, auth_url, created_at, expires_at, token_endpoint)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            "#,
        )
        .bind(&state_param)
        .bind(&server.id)
        .bind(&ws)
        .bind(&verifier)
        .bind(&redirect_uri)
        .bind(&auth_url)
        .bind(now.to_rfc3339())
        .bind(expires_at)
        .bind(token_endpoint)
        .execute(&state.pool)
        .await
        .map_err(ApiError::from)?;

        return Ok(Json(json!({
            "auth_url": auth_url,
            "state": state_param,
        })));
    }

    // === FLUX GÉNÉRIQUE (Turso, Cloudflare, etc.) avec découverte OAuth ===
    let base_url = if !server.url.is_empty() {
        let url = server.url.trim_end_matches("/mcp");
        url.to_string()
    } else {
        return Err(ApiError::message("URL MCP vide — configure le serveur"));
    };

    let doc = devforge_mcp::discover_oauth(&base_url, &server.url)
        .await
        .map_err(|e| ApiError::message(format!("Découverte OAuth échouée : {}", e)))?;

    if doc.authorization_endpoint.is_none() || doc.token_endpoint.is_none() {
        return Err(ApiError::message(
            "Endpoints OAuth manquants dans le document de découverte",
        ));
    }

    // Déterminer client_id : CIMD si supporté, sinon erreur claire
    let client_id = if doc.client_id_metadata_document_supported {
        format!("{}/.well-known/oauth-client", app_url)
    } else {
        // Provider ne supporte pas DCR — doit avoir client_id pré-enregistré en config
        return Err(ApiError::message(format!(
            "Le serveur OAuth de {} ne supporte pas Dynamic Client Registration (CIMD). Configure un client_id pré-enregistré dans les champs avancés, ou contacte le support si ce provider devrait supporter DCR.",
            catalog
        )));
    };

    // Scopes suggérés selon le preset
    let scopes = if catalog == "turso" {
        vec!["read", "write"]
    } else {
        vec![]
    };

    let auth_url = devforge_mcp::build_authorization_url(
        &doc,
        &client_id,
        &redirect_uri,
        &state_param,
        &challenge,
        &scopes,
    )
    .map_err(|e| ApiError::message(format!("Construction URL OAuth : {}", e)))?;

    // Stocker l'état en attente (expire 10min)
    let now = Utc::now();
    let expires_at = (now + chrono::Duration::minutes(10)).to_rfc3339();
    sqlx::query(
        r#"
        INSERT INTO mcp_oauth_pending (state, server_id, workspace_uuid, code_verifier, redirect_uri, auth_url, created_at, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(&state_param)
    .bind(&server.id)
    .bind(&ws)
    .bind(&verifier)
    .bind(&redirect_uri)
    .bind(&auth_url)
    .bind(now.to_rfc3339())
    .bind(expires_at)
    .execute(&state.pool)
    .await
    .map_err(ApiError::from)?;

    Ok(Json(json!({
        "auth_url": auth_url,
        "state": state_param,
    })))
}

#[derive(Deserialize)]
struct OAuthCallbackQuery {
    code: String,
    state: String,
}

/// Callback OAuth : échanger code → access_token
async fn oauth_callback(
    State(state): State<AppState>,
    Query(params): Query<OAuthCallbackQuery>,
    headers: HeaderMap,
) -> Result<axum::response::Html<String>, ApiError> {
    // Récupérer l'état pending
    let row: Option<(String, String, String, String, String, String, String)> = sqlx::query_as(
        "SELECT server_id, workspace_uuid, code_verifier, redirect_uri, auth_url, expires_at, token_endpoint FROM mcp_oauth_pending WHERE state = $1",
    )
    .bind(&params.state)
    .fetch_optional(&state.pool)
    .await
    .map_err(ApiError::from)?;

    let (server_id, ws_uuid, verifier, redirect_uri, _auth_url, expires_at, stored_token_endpoint) =
        row.ok_or_else(|| ApiError::message("État OAuth invalide ou expiré"))?;

    // Vérifier expiration
    if let Ok(exp) = chrono::DateTime::parse_from_rfc3339(&expires_at) {
        if exp.timestamp() < chrono::Utc::now().timestamp() {
            let _ = sqlx::query("DELETE FROM mcp_oauth_pending WHERE state = $1")
                .bind(&params.state)
                .execute(&state.pool)
                .await;
            return Err(ApiError::message("État OAuth expiré"));
        }
    }

    // Charger le serveur MCP
    let mut server = state
        .mcp
        .clients
        .get(&server_id)
        .await
        .ok_or_else(|| ApiError::not_found("mcp server"))?;

    if !server.workspace_uuid.is_empty() && server.workspace_uuid != ws_uuid {
        return Err(ApiError::message("Workspace mismatch"));
    }

    let catalog = server.catalog_id.as_deref().unwrap_or("");

    // === CAS SPÉCIAL SLACK : OAuth avec client_secret ===
    if catalog == "slack" {
        let client_id = server
            .secrets
            .get("client_id")
            .or_else(|| server.meta.get("client_id"))
            .ok_or_else(|| ApiError::message("Slack OAuth : client_id manquant"))?
            .clone();

        let client_secret = server
            .secrets
            .get("client_secret")
            .ok_or_else(|| ApiError::message("Slack OAuth : client_secret manquant"))?
            .clone();

        // Utiliser token_endpoint stocké (Slack user token endpoint)
        let token_endpoint = if !stored_token_endpoint.is_empty() {
            stored_token_endpoint
        } else {
            "https://slack.com/api/oauth.v2.user.access".to_string()
        };

        // Échanger code → tokens avec client_secret (Slack exige client_secret en POST body)
        let token_resp = exchange_code_with_secret(
            &token_endpoint,
            &client_id,
            &client_secret,
            &redirect_uri,
            &params.code,
            &verifier,
        )
        .await
        .map_err(|e| ApiError::message(format!("Échange OAuth Slack échoué : {}", e.message)))?;

        // Calculer expiration
        let expires_at = if let Some(exp) = token_resp.expires_in {
            (Utc::now() + chrono::Duration::seconds(exp)).to_rfc3339()
        } else {
            String::new()
        };

        // Persister tokens
        server.oauth_access_token = token_resp.access_token;
        server.oauth_refresh_token = token_resp.refresh_token;
        server.oauth_expires_at = expires_at;
        server.oauth_scopes = token_resp.scope;

        state.mcp.clients.upsert(server.clone()).await;
        persist_mcp(&state, &server).await?;

        // Supprimer l'état pending
        let _ = sqlx::query("DELETE FROM mcp_oauth_pending WHERE state = $1")
            .bind(&params.state)
            .execute(&state.pool)
            .await;

        return Ok(axum::response::Html(success_html().to_string()));
    }

    // === FLUX GÉNÉRIQUE (Turso, Cloudflare, etc.) ===
    let base_url = if !server.url.is_empty() {
        let url = server.url.trim_end_matches("/mcp");
        url.to_string()
    } else {
        return Err(ApiError::message("URL MCP vide"));
    };

    let doc = devforge_mcp::discover_oauth(&base_url, &server.url)
        .await
        .map_err(|e| ApiError::message(format!("Découverte OAuth : {}", e)))?;

    let token_endpoint = doc
        .token_endpoint
        .as_deref()
        .ok_or_else(|| ApiError::message("token_endpoint manquant"))?;

    // Résoudre URL publique (DB settings, headers, ou APP_URL fallback)
    let app_url = resolve_public_base_url(&state, &headers).await?;

    let client_id = if doc.client_id_metadata_document_supported {
        format!("{}/.well-known/oauth-client", app_url)
    } else {
        format!("devforge-{}", catalog)
    };

    // Échanger code → tokens (PKCE sans client_secret)
    let token_resp = devforge_mcp::exchange_code(
        token_endpoint,
        &client_id,
        &redirect_uri,
        &params.code,
        &verifier,
    )
    .await
    .map_err(|e| ApiError::message(format!("Échange OAuth échoué : {}", e)))?;

    // Calculer expiration
    let expires_at = if let Some(exp) = token_resp.expires_in {
        (Utc::now() + chrono::Duration::seconds(exp)).to_rfc3339()
    } else {
        String::new()
    };

    // Persister tokens
    server.oauth_access_token = token_resp.access_token;
    server.oauth_refresh_token = token_resp.refresh_token;
    server.oauth_expires_at = expires_at;
    server.oauth_scopes = token_resp.scope;

    state.mcp.clients.upsert(server.clone()).await;
    persist_mcp(&state, &server).await?;

    // Supprimer l'état pending
    let _ = sqlx::query("DELETE FROM mcp_oauth_pending WHERE state = $1")
        .bind(&params.state)
        .execute(&state.pool)
        .await;

    Ok(axum::response::Html(success_html().to_string()))
}

/// HTML de succès OAuth (factorisation)
fn success_html() -> &'static str {
    r#"
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Connexion OAuth réussie</title>
    <style>
        body {
            font-family: system-ui, -apple-system, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            background: #1c1c1e;
            color: #fff;
        }
        .card {
            background: #2a2a2e;
            border-radius: 16px;
            padding: 2rem;
            text-align: center;
            max-width: 400px;
        }
        .success {
            font-size: 4rem;
            margin-bottom: 1rem;
        }
        h1 {
            font-size: 1.5rem;
            margin: 0 0 0.5rem;
        }
        p {
            color: #a0a0a8;
            margin: 0;
        }
    </style>
    <script>
        // Fermer popup après 2s
        setTimeout(() => {
            if (window.opener) {
                window.opener.postMessage({ type: 'mcp_oauth_success' }, '*');
                window.close();
            }
        }, 2000);
    </script>
</head>
<body>
    <div class="card">
        <div class="success">✓</div>
        <h1>Connexion OAuth réussie</h1>
        <p>Tu peux fermer cette fenêtre.</p>
    </div>
</body>
</html>
    "#
}

/// Échange code OAuth → tokens avec client_secret (Slack, providers confidentiels)
async fn exchange_code_with_secret(
    token_endpoint: &str,
    client_id: &str,
    client_secret: &str,
    redirect_uri: &str,
    code: &str,
    code_verifier: &str,
) -> Result<devforge_mcp::TokenResponse, ApiError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| ApiError::message(format!("Reqwest build: {e}")))?;

    let params = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("code_verifier", code_verifier),
    ];

    let res = client
        .post(token_endpoint)
        .form(&params)
        .send()
        .await
        .map_err(|e| ApiError::message(format!("Token exchange POST: {e}")))?;

    let status = res.status();
    let text = res.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(ApiError::message(format!(
            "Token exchange → HTTP {status}: {}",
            text.chars().take(300).collect::<String>()
        )));
    }

    let token: devforge_mcp::TokenResponse =
        serde_json::from_str(&text).map_err(|e| ApiError::message(format!("Token parse: {e}")))?;

    Ok(token)
}

/// Déconnecter OAuth (revoke + clear tokens)
async fn disconnect_oauth(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let ws = workspace_uuid(&state, &headers).await?;
    let mut server = state
        .mcp
        .clients
        .get(&id)
        .await
        .ok_or_else(|| ApiError::not_found("mcp server"))?;

    if !server.workspace_uuid.is_empty() && server.workspace_uuid != ws {
        return Err(ApiError::not_found("mcp server"));
    }

    // Clear OAuth tokens
    server.oauth_access_token.clear();
    server.oauth_refresh_token.clear();
    server.oauth_expires_at.clear();
    server.oauth_scopes.clear();

    state.mcp.clients.upsert(server.clone()).await;
    persist_mcp(&state, &server).await?;

    Ok(Json(json!({ "ok": true })))
}

/// Servir Client ID Metadata Document (CIMD / SEP-991)
/// Pour serveurs OAuth avec client_id_metadata_document_supported (ex. Turso)
async fn oauth_client_metadata(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    // Résoudre URL publique (DB settings, headers, ou APP_URL fallback)
    let app_url = resolve_public_base_url(&state, &headers).await?;

    let redirect_uri = format!("{}/api/v1/mcp/oauth/callback", app_url);
    let client_metadata_url = format!("{}/.well-known/oauth-client", app_url);

    Ok(Json(json!({
        "client_id": client_metadata_url,
        "client_name": "DevForge",
        "redirect_uris": [redirect_uri],
        "token_endpoint_auth_method": "none",
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "client_uri": app_url,
        "logo_uri": format!("{}/favicon.ico", app_url),
    })))
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
        INSERT INTO mcp_servers (id, workspace_uuid, name, url, enabled, catalog_id, headers_json, meta_json, secrets_json, 
                                  oauth_access_token, oauth_refresh_token, oauth_expires_at, oauth_scopes, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT(id) DO UPDATE SET
            workspace_uuid = excluded.workspace_uuid,
            name = excluded.name,
            url = excluded.url,
            enabled = excluded.enabled,
            catalog_id = excluded.catalog_id,
            headers_json = excluded.headers_json,
            meta_json = excluded.meta_json,
            secrets_json = excluded.secrets_json,
            oauth_access_token = excluded.oauth_access_token,
            oauth_refresh_token = excluded.oauth_refresh_token,
            oauth_expires_at = excluded.oauth_expires_at,
            oauth_scopes = excluded.oauth_scopes,
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
    .bind(&cfg.oauth_access_token)
    .bind(&cfg.oauth_refresh_token)
    .bind(&cfg.oauth_expires_at)
    .bind(&cfg.oauth_scopes)
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
        String,
        String,
        String,
        String,
    )> = sqlx::query_as(
        "SELECT id, workspace_uuid, name, url, enabled, catalog_id, headers_json, meta_json, secrets_json, 
                COALESCE(oauth_access_token, '') as oauth_access_token,
                COALESCE(oauth_refresh_token, '') as oauth_refresh_token,
                COALESCE(oauth_expires_at, '') as oauth_expires_at,
                COALESCE(oauth_scopes, '') as oauth_scopes
         FROM mcp_servers",
    )
    .fetch_all(&state.pool)
    .await?;
    for (
        id,
        ws,
        name,
        url,
        enabled,
        catalog_id,
        headers_json,
        meta_json,
        secrets_json,
        oauth_access,
        oauth_refresh,
        oauth_expires,
        oauth_scopes,
    ) in rows
    {
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
                oauth_access_token: oauth_access,
                oauth_refresh_token: oauth_refresh,
                oauth_expires_at: oauth_expires,
                oauth_scopes,
            })
            .await;
    }
    Ok(())
}

/// Extrait org claim du JWT OAuth (décodage base64 non-vérifié, lecture seule)
fn extract_org_from_jwt(token: &str) -> Option<String> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return None;
    }

    // Décoder le payload (segment du milieu) - essayer URL_SAFE_NO_PAD puis STANDARD
    let payload_b64 = parts[1];
    let decoded = general_purpose::URL_SAFE_NO_PAD
        .decode(payload_b64)
        .or_else(|_| general_purpose::STANDARD.decode(payload_b64))
        .ok()?;

    let payload: Value = serde_json::from_slice(&decoded).ok()?;

    // Chercher org claim (différents champs possibles)
    payload
        .get("org")
        .or_else(|| payload.get("organization"))
        .or_else(|| payload.get("org_slug"))
        .and_then(|o| o.as_str())
        .map(|s| s.to_string())
}

/// Lie une base Turso via MCP tools OAuth + Platform API (préféré)
async fn link_turso_via_mcp(
    state: &AppState,
    server_id: &str,
    db_name: &str,
    hostname_hint: Option<&str>,
    org_hint: Option<&str>,
) -> Result<(String, String), String> {
    // 1. Récupérer le serveur pour avoir oauth_access_token
    let server = state
        .mcp
        .clients
        .get(server_id)
        .await
        .ok_or_else(|| "Server not found for OAuth token".to_string())?;

    let oauth_token = server.oauth_access_token.clone();
    if oauth_token.is_empty() {
        return Err("OAuth access token missing".to_string());
    }

    // 2. TOUJOURS lister pour découvrir hostname + org (même si hostname fourni)
    let list_result = state
        .mcp
        .clients
        .call_remote_tool(server_id, "list_databases", json!({}))
        .await
        .map_err(|e| format!("list_databases MCP failed: {}", e))?;

    // Extraire databases en gérant différents formats de réponse
    let databases = if let Some(dbs) = list_result.get("databases").and_then(|d| d.as_array()) {
        dbs.clone()
    } else if let Some(content) = list_result.get("content") {
        if let Some(arr) = content.as_array() {
            arr.clone()
        } else if let Some(s) = content.as_str() {
            if let Ok(parsed) = serde_json::from_str::<Value>(s) {
                if let Some(dbs) = parsed.get("databases").and_then(|d| d.as_array()) {
                    dbs.clone()
                } else if let Some(arr) = parsed.as_array() {
                    arr.clone()
                } else {
                    return Err("list_databases content parse failed".to_string());
                }
            } else {
                return Err("list_databases content not JSON".to_string());
            }
        } else {
            return Err("list_databases content invalid".to_string());
        }
    } else if let Some(arr) = list_result.as_array() {
        arr.clone()
    } else {
        return Err("list_databases response invalid".to_string());
    };

    // 3. Extraire hostname (préférer hint si fourni, sinon chercher dans list)
    let hostname = if let Some(h) = hostname_hint.filter(|h| !h.is_empty()) {
        h.to_string()
    } else {
        databases
            .iter()
            .find(|db| {
                db.get("name")
                    .or_else(|| db.get("Name"))
                    .and_then(|n| n.as_str())
                    == Some(db_name)
            })
            .and_then(|db| {
                db.get("hostname")
                    .or_else(|| db.get("Hostname"))
                    .and_then(|h| h.as_str())
                    .map(|s| s.to_string())
            })
            .ok_or_else(|| format!("DB {} not found in list_databases", db_name))?
    };

    // 4. Résoudre org avec fallbacks multiples
    let mut org = String::new();

    // Fallback 0: org_hint from frontend
    if let Some(hint) = org_hint.filter(|h| !h.is_empty()) {
        org = hint.to_string();
    }

    // Fallback 1: Top-level dans list_result
    if org.is_empty() {
        org = list_result
            .get("organization")
            .or_else(|| list_result.get("org"))
            .or_else(|| list_result.get("organizationSlug"))
            .and_then(|o| o.as_str())
            .unwrap_or("")
            .to_string();
    }

    // Fallback 2: Dans chaque objet database
    if org.is_empty() {
        org = databases
            .iter()
            .find_map(|db| {
                db.get("organization")
                    .or_else(|| db.get("org"))
                    .or_else(|| db.get("organizationSlug"))
                    .and_then(|o| o.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_default();
    }

    // Fallback 3: server.meta.org
    if org.is_empty() {
        org = server.meta.get("org").cloned().unwrap_or_default();
    }

    // Fallback 4: Décoder JWT OAuth pour extraire org claim
    if org.is_empty() {
        org = extract_org_from_jwt(&oauth_token).unwrap_or_default();
    }

    if org.is_empty() {
        return Err(
            "Organization slug missing (tried list_databases response, server.meta, JWT decode)"
                .to_string(),
        );
    }

    // 5. Persister org dans server.meta si découvert et pas déjà là
    if !org.is_empty() && server.meta.get("org").map(|s| s.as_str()) != Some(org.as_str()) {
        let mut updated_server = server.clone();
        updated_server.meta.insert("org".to_string(), org.clone());
        state.mcp.clients.upsert(updated_server.clone()).await;

        // Persister en DB
        let meta_json = serde_json::to_string(&updated_server.meta).unwrap_or_default();
        let _ = sqlx::query("UPDATE mcp_servers SET meta_json = $1 WHERE id = $2")
            .bind(&meta_json)
            .bind(server_id)
            .execute(&state.pool)
            .await;
    }

    // 3. Générer JWT via Platform REST API en utilisant OAuth token comme Bearer
    let url = format!(
        "https://api.turso.tech/v1/organizations/{}/databases/{}/auth/tokens",
        org, db_name
    );

    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|e| format!("HTTP client failed: {}", e))?;

    let res = http_client
        .post(&url)
        .bearer_auth(&oauth_token)
        .json(&json!({}))
        .send()
        .await
        .map_err(|e| format!("Platform API token request failed: {}", e))?;

    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(format!(
            "Platform API HTTP {}: {}",
            status,
            text.chars().take(280).collect::<String>()
        ));
    }

    let response: Value = res
        .json()
        .await
        .map_err(|e| format!("Platform API response parse failed: {}", e))?;

    let jwt = response
        .get("jwt")
        .or_else(|| response.get("token"))
        .and_then(|t| t.as_str())
        .ok_or_else(|| "Platform API response missing jwt".to_string())?
        .to_string();

    Ok((hostname, jwt))
}

/// Fallback: lie une base Turso via Platform REST API (nécessite api_token + org)
async fn link_turso_via_platform_api(
    state: &AppState,
    server: &devforge_mcp::McpServerConfig,
    db_name: &str,
    body: &LinkResourceBody,
) -> Result<(String, String, String), ApiError> {
    let token = server.secrets.get("api_token")
        .ok_or_else(|| ApiError::message("Turso: Connecte-toi via OAuth (MCP → Turso → Se connecter) OU configure Platform API Token + org dans Avancé."))?;
    let org = server.meta.get("org").ok_or_else(|| {
        ApiError::message("Turso: org slug requis. Configure-le dans MCP → Turso → Avancé.")
    })?;

    let hostname = if let Some(h) = body.hostname.as_ref().filter(|h| !h.is_empty()) {
        h.clone()
    } else {
        let dbs = devforge_mcp::list_databases(token, org)
            .await
            .map_err(|e| ApiError::message(e.to_string()))?;
        dbs.into_iter()
            .find(|d| d.name == *db_name || d.db_id.as_deref() == Some(body.resource_id.as_str()))
            .map(|d| d.hostname)
            .ok_or_else(|| ApiError::message(format!("DB Turso introuvable: {db_name}")))?
    };

    let jwt = devforge_mcp::create_db_token(token, org, db_name)
        .await
        .map_err(|e| ApiError::message(e.to_string()))?;

    Ok((hostname, jwt, org.clone()))
}
