//! Serveur d'autorisation OAuth 2.1 du MCP DevForge — connecteurs distants (Grok, etc.).
//!
//! - RFC 9728 : `/.well-known/oauth-protected-resource[/<chemin MCP>]`
//! - RFC 8414 : `/.well-known/oauth-authorization-server`
//! - RFC 7591 : enregistrement dynamique (`/oauth/register`)
//! - Client ID Metadata Document : `client_id` = URL https (document JSON, sinon règle
//!   « même origine » pour `redirect_uri`, comme les client IDs URL d'IndieAuth).
//! - PKCE S256 obligatoire ; codes à usage unique ; refresh tokens tournants.
//!
//! L'utilisateur est authentifié par la session DevForge existante (login local ou Pocket ID) :
//! `/oauth/authorize` enregistre la demande puis renvoie vers la page de consentement du front.

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{Html, IntoResponse, Redirect, Response},
    routing::{delete, get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD, engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{Duration, Utc};
use devforge_auth::{hash_api_token, ABILITY_READ, ABILITY_WRITE};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

use crate::auth_routes::{current_workspace, UserRow};
use crate::state::{now_str, AppState};

pub const ACCESS_TOKEN_PREFIX: &str = "dfoa_";
const REFRESH_TOKEN_PREFIX: &str = "dfor_";
const CODE_PREFIX: &str = "dfoc_";
const DCR_CLIENT_PREFIX: &str = "dfc_";

const ACCESS_TTL_SECS: i64 = 3600;
const REFRESH_TTL_DAYS: i64 = 90;
const CODE_TTL_SECS: i64 = 300;
const REQUEST_TTL_SECS: i64 = 900;

pub const SCOPE_MCP: &str = "mcp";
const SCOPE_OFFLINE: &str = "offline_access";

/// Chemins MCP servis (le premier est la ressource par défaut).
pub const MCP_PATHS: [&str; 2] = ["/api/v1/mcp", "/mcp"];

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/.well-known/oauth-protected-resource",
            get(protected_resource_root),
        )
        .route(
            "/.well-known/oauth-protected-resource/api/v1/mcp",
            get(protected_resource_api),
        )
        .route(
            "/.well-known/oauth-protected-resource/mcp",
            get(protected_resource_short),
        )
        .route(
            "/.well-known/oauth-authorization-server",
            get(authorization_server_metadata),
        )
        .route(
            "/.well-known/oauth-authorization-server/api/v1/mcp",
            get(authorization_server_metadata),
        )
        .route(
            "/.well-known/oauth-authorization-server/mcp",
            get(authorization_server_metadata),
        )
        .route("/oauth/register", post(register_client))
        .route("/oauth/authorize", get(authorize))
        .route("/oauth/token", post(token))
        .route("/oauth/revoke", post(revoke))
        .route("/api/v1/oauth/requests/{id}", get(get_request))
        .route("/api/v1/oauth/requests/{id}/approve", post(approve_request))
        .route("/api/v1/oauth/requests/{id}/deny", post(deny_request))
        .route("/api/v1/oauth/grants", get(list_grants))
        .route("/api/v1/oauth/grants/{family}", delete(revoke_grant))
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

fn random_secret(prefix: &str) -> String {
    format!(
        "{prefix}{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

fn token_hash(token: &str) -> String {
    hash_api_token(token)
}

/// BASE64URL(SHA256(verifier)) sans padding (RFC 7636).
pub fn pkce_s256(verifier: &str) -> String {
    let mut h = Sha256::new();
    h.update(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(h.finalize())
}

fn valid_code_verifier(v: &str) -> bool {
    (43..=128).contains(&v.len())
        && v.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_' | '~'))
}

fn constant_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes()
        .zip(b.bytes())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

fn in_secs(secs: i64) -> String {
    (Utc::now() + Duration::seconds(secs)).to_rfc3339()
}

/// Parse `application/x-www-form-urlencoded` (ou JSON objet plat).
fn parse_params(headers: &HeaderMap, body: &[u8]) -> HashMap<String, String> {
    let ct = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ct.contains("application/json") {
        if let Ok(Value::Object(map)) = serde_json::from_slice::<Value>(body) {
            return map
                .into_iter()
                .filter_map(|(k, v)| match v {
                    Value::String(s) => Some((k, s)),
                    Value::Number(n) => Some((k, n.to_string())),
                    Value::Bool(b) => Some((k, b.to_string())),
                    _ => None,
                })
                .collect();
        }
        return HashMap::new();
    }
    parse_form(&String::from_utf8_lossy(body))
}

pub fn parse_form(raw: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for pair in raw.split('&').filter(|p| !p.is_empty()) {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let dec = |s: &str| {
            urlencoding::decode(&s.replace('+', " "))
                .map(|c| c.into_owned())
                .unwrap_or_default()
        };
        out.insert(dec(k), dec(v));
    }
    out
}

fn oauth_error(status: StatusCode, error: &str, description: &str) -> Response {
    let mut res = (
        status,
        Json(json!({"error": error, "error_description": description})),
    )
        .into_response();
    no_store(&mut res);
    res
}

fn no_store(res: &mut Response) {
    res.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res.headers_mut()
        .insert(header::PRAGMA, HeaderValue::from_static("no-cache"));
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn error_page(title: &str, detail: &str) -> Response {
    let body = format!(
        r#"<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DevForge · Autorisation</title>
<style>body{{font-family:system-ui,sans-serif;background:#111113;color:#e7e7ea;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}}main{{max-width:28rem;padding:2rem;border:1px solid #2a2a2e;border-radius:1rem;background:#1c1c1e}}h1{{font-size:1.1rem}}p{{color:#a1a1aa;font-size:.9rem;line-height:1.5}}</style></head>
<body><main><h1>{}</h1><p>{}</p></main></body></html>"#,
        html_escape(title),
        html_escape(detail)
    );
    (StatusCode::BAD_REQUEST, Html(body)).into_response()
}

/// URL publique de l'instance (instance_url → en-têtes proxy → APP_URL).
pub async fn public_base(state: &AppState, headers: &HeaderMap) -> Result<String, Response> {
    crate::mcp_routes::resolve_public_base_url(state, headers)
        .await
        .map_err(|e| e.into_response())
}

pub fn resource_metadata_url(base: &str, mcp_path: &str) -> String {
    format!("{base}/.well-known/oauth-protected-resource{mcp_path}")
}

/// En-tête `WWW-Authenticate` pour un 401 sur le MCP (RFC 9728 §5.1).
pub fn www_authenticate(base: &str, mcp_path: &str, invalid_token: bool) -> String {
    let mut v = format!(
        r#"Bearer resource_metadata="{}", scope="{SCOPE_MCP}""#,
        resource_metadata_url(base, mcp_path)
    );
    if invalid_token {
        v.push_str(
            r#", error="invalid_token", error_description="invalid or expired access token""#,
        );
    }
    v
}

pub fn protected_resource_doc(base: &str, mcp_path: &str) -> Value {
    json!({
        "resource": format!("{base}{mcp_path}"),
        "authorization_servers": [base],
        "scopes_supported": [SCOPE_MCP, SCOPE_OFFLINE],
        "bearer_methods_supported": ["header"],
        "resource_name": "DevForge",
        "resource_documentation": base,
    })
}

pub fn authorization_server_doc(base: &str) -> Value {
    json!({
        "issuer": base,
        "authorization_endpoint": format!("{base}/oauth/authorize"),
        "token_endpoint": format!("{base}/oauth/token"),
        "registration_endpoint": format!("{base}/oauth/register"),
        "revocation_endpoint": format!("{base}/oauth/revoke"),
        "response_types_supported": ["code"],
        "response_modes_supported": ["query"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none", "client_secret_post", "client_secret_basic"],
        "revocation_endpoint_auth_methods_supported": ["none", "client_secret_post", "client_secret_basic"],
        "scopes_supported": [SCOPE_MCP, SCOPE_OFFLINE],
        "client_id_metadata_document_supported": true,
        "authorization_response_iss_parameter_supported": true,
        "service_documentation": base,
    })
}

// ---------------------------------------------------------------------------
// Métadonnées
// ---------------------------------------------------------------------------

async fn prm(state: &AppState, headers: &HeaderMap, path: &str) -> Response {
    match public_base(state, headers).await {
        Ok(base) => Json(protected_resource_doc(&base, path)).into_response(),
        Err(r) => r,
    }
}

async fn protected_resource_root(State(state): State<AppState>, headers: HeaderMap) -> Response {
    prm(&state, &headers, MCP_PATHS[0]).await
}

async fn protected_resource_api(State(state): State<AppState>, headers: HeaderMap) -> Response {
    prm(&state, &headers, "/api/v1/mcp").await
}

async fn protected_resource_short(State(state): State<AppState>, headers: HeaderMap) -> Response {
    prm(&state, &headers, "/mcp").await
}

async fn authorization_server_metadata(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    match public_base(&state, &headers).await {
        Ok(base) => Json(authorization_server_doc(&base)).into_response(),
        Err(r) => r,
    }
}

// ---------------------------------------------------------------------------
// Clients (DCR + client_id URL)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct ClientInfo {
    pub client_id: String,
    pub name: String,
    pub redirect_uris: Vec<String>,
    /// Client ID URL sans document JSON : `redirect_uri` doit partager l'origine.
    pub origin_rule: Option<String>,
}

fn is_loopback_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "[::1]" | "::1")
}

/// Redirect URI acceptable à l'enregistrement : https, loopback http, ou schéma natif.
pub fn redirect_uri_allowed(uri: &str) -> bool {
    let Ok(u) = reqwest::Url::parse(uri) else {
        return false;
    };
    if u.fragment().is_some() {
        return false;
    }
    match u.scheme() {
        "https" => u.host_str().is_some(),
        "http" => u.host_str().map(is_loopback_host).unwrap_or(false),
        "javascript" | "data" | "file" | "vbscript" | "blob" | "about" | "ftp" | "ws" | "wss" => {
            false
        }
        s => {
            s.contains('.')
                || s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '-')
        }
    }
}

fn origin_of(uri: &str) -> Option<String> {
    let u = reqwest::Url::parse(uri).ok()?;
    let host = u.host_str()?;
    let port = u.port().map(|p| format!(":{p}")).unwrap_or_default();
    Some(format!(
        "{}://{}{}",
        u.scheme(),
        host.to_ascii_lowercase(),
        port
    ))
}

/// Correspondance `redirect_uri` ↔ client : exacte, loopback (port libre, RFC 8252),
/// ou même origine / sous-domaine pour un client ID URL sans document.
pub fn redirect_matches(client: &ClientInfo, redirect_uri: &str) -> bool {
    if client.redirect_uris.iter().any(|r| r == redirect_uri) {
        return true;
    }
    if let Ok(req) = reqwest::Url::parse(redirect_uri) {
        if req.scheme() == "http" && req.host_str().map(is_loopback_host).unwrap_or(false) {
            for reg in &client.redirect_uris {
                if let Ok(r) = reqwest::Url::parse(reg) {
                    if r.scheme() == "http"
                        && r.host_str() == req.host_str()
                        && r.path() == req.path()
                    {
                        return true;
                    }
                }
            }
        }
    }
    if let Some(origin) = &client.origin_rule {
        let Ok(req) = reqwest::Url::parse(redirect_uri) else {
            return false;
        };
        let Ok(base) = reqwest::Url::parse(origin) else {
            return false;
        };
        if req.scheme() != "https" || base.scheme() != "https" || req.fragment().is_some() {
            return false;
        }
        let (Some(rh), Some(bh)) = (req.host_str(), base.host_str()) else {
            return false;
        };
        let rh = rh.to_ascii_lowercase();
        let bh = bh.to_ascii_lowercase();
        let same_port = req.port_or_known_default() == base.port_or_known_default();
        return same_port && (rh == bh || rh.ends_with(&format!(".{bh}")));
    }
    false
}

fn is_public_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            !(v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified()
                || v4.is_documentation()
                || v4.octets()[0] == 100 && (64..128).contains(&v4.octets()[1])
                || v4.octets()[0] == 0)
        }
        std::net::IpAddr::V6(v6) => {
            let seg = v6.segments();
            !(v6.is_loopback()
                || v6.is_unspecified()
                || (seg[0] & 0xfe00) == 0xfc00
                || (seg[0] & 0xffc0) == 0xfe80
                || v6
                    .to_ipv4_mapped()
                    .is_some_and(|v4| v4.is_private() || v4.is_loopback() || v4.is_link_local()))
        }
    }
}

/// Récupère un Client ID Metadata Document (https public uniquement, 64 Ko max).
async fn fetch_client_metadata(url: &reqwest::Url) -> Option<Value> {
    let host = url.host_str()?.to_string();
    let port = url.port_or_known_default().unwrap_or(443);
    let addrs: Vec<std::net::SocketAddr> = tokio::net::lookup_host((host.as_str(), port))
        .await
        .ok()?
        .collect();
    if addrs.is_empty() || addrs.iter().any(|a| !is_public_ip(a.ip())) {
        tracing::warn!(client_id = %url, "client_id URL non publique — document ignoré");
        return None;
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .ok()?;
    let res = client
        .get(url.clone())
        .header(header::ACCEPT, "application/json")
        .header(header::USER_AGENT, "DevForge-OAuth/1.0")
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    let bytes = res.bytes().await.ok()?;
    if bytes.len() > 64 * 1024 {
        return None;
    }
    let doc: Value = serde_json::from_slice(&bytes).ok()?;
    doc.is_object().then_some(doc)
}

/// Client ID URL : document JSON (redirect_uris exacts) ou règle « même origine ».
pub fn client_from_url_doc(client_id: &str, doc: Option<&Value>) -> Result<ClientInfo, String> {
    let url = reqwest::Url::parse(client_id).map_err(|_| "client_id URL invalide".to_string())?;
    let host = url.host_str().unwrap_or("").to_string();
    if let Some(doc) = doc {
        if let Some(declared) = doc.get("client_id").and_then(|v| v.as_str()) {
            if declared != client_id {
                return Err("client_id du document ≠ URL du client".into());
            }
        }
        let uris: Vec<String> = doc
            .get("redirect_uris")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        if !uris.is_empty() {
            let name = doc
                .get("client_name")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| host.clone());
            return Ok(ClientInfo {
                client_id: client_id.to_string(),
                name,
                redirect_uris: uris,
                origin_rule: None,
            });
        }
    }
    let name = doc
        .and_then(|d| d.get("client_name"))
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| display_name_for_host(&host));
    Ok(ClientInfo {
        client_id: client_id.to_string(),
        name,
        redirect_uris: vec![],
        origin_rule: origin_of(client_id),
    })
}

fn display_name_for_host(host: &str) -> String {
    let h = host.trim_start_matches("www.");
    if h == "grok.com" || h.ends_with(".grok.com") || h == "x.ai" || h.ends_with(".x.ai") {
        return "Grok".into();
    }
    h.to_string()
}

async fn resolve_client(pool: &sqlx::PgPool, client_id: &str) -> Result<ClientInfo, String> {
    let client_id = client_id.trim();
    if client_id.is_empty() {
        return Err("client_id manquant".into());
    }
    if client_id.starts_with("https://") {
        let url = reqwest::Url::parse(client_id).map_err(|_| "client_id URL invalide")?;
        if url.host_str().is_none() || url.fragment().is_some() {
            return Err("client_id URL invalide".into());
        }
        let doc = fetch_client_metadata(&url).await;
        return client_from_url_doc(client_id, doc.as_ref());
    }
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT client_name, redirect_uris FROM mcp_oauth_clients WHERE client_id = $1",
    )
    .bind(client_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    let Some((name, uris)) = row else {
        return Err("Client OAuth inconnu — relance la connexion depuis l’application".into());
    };
    let redirect_uris: Vec<String> = serde_json::from_str(&uris).unwrap_or_default();
    Ok(ClientInfo {
        client_id: client_id.to_string(),
        name: if name.trim().is_empty() {
            "Application".into()
        } else {
            name
        },
        redirect_uris,
        origin_rule: None,
    })
}

async fn register_client(State(state): State<AppState>, body: Bytes) -> Response {
    register_client_core(&state.pool, &body).await
}

pub(crate) async fn register_client_core(pool: &sqlx::PgPool, body: &[u8]) -> Response {
    let Ok(Value::Object(meta)) = serde_json::from_slice::<Value>(body) else {
        return oauth_error(
            StatusCode::BAD_REQUEST,
            "invalid_client_metadata",
            "Corps JSON attendu",
        );
    };
    let redirect_uris: Vec<String> = meta
        .get("redirect_uris")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(|s| s.trim().to_string()))
                .collect()
        })
        .unwrap_or_default();
    if redirect_uris.is_empty() {
        return oauth_error(
            StatusCode::BAD_REQUEST,
            "invalid_redirect_uri",
            "redirect_uris requis",
        );
    }
    if let Some(bad) = redirect_uris.iter().find(|u| !redirect_uri_allowed(u)) {
        return oauth_error(
            StatusCode::BAD_REQUEST,
            "invalid_redirect_uri",
            &format!("redirect_uri refusée : {bad}"),
        );
    }
    let method = meta
        .get("token_endpoint_auth_method")
        .and_then(|v| v.as_str())
        .unwrap_or("none")
        .to_string();
    if !matches!(
        method.as_str(),
        "none" | "client_secret_post" | "client_secret_basic"
    ) {
        return oauth_error(
            StatusCode::BAD_REQUEST,
            "invalid_client_metadata",
            "token_endpoint_auth_method non supportée",
        );
    }
    let str_field = |k: &str| {
        meta.get(k)
            .and_then(|v| v.as_str())
            .map(|s| s.trim().chars().take(200).collect::<String>())
            .unwrap_or_default()
    };
    let client_name = str_field("client_name");
    let client_uri = str_field("client_uri");
    let logo_uri = str_field("logo_uri");
    let client_id = format!("{DCR_CLIENT_PREFIX}{}", uuid::Uuid::new_v4().simple());
    let secret = (method != "none").then(|| random_secret("dfcs_"));
    let now = now_str();
    let issued_at = Utc::now().timestamp();
    let res = sqlx::query(
        r#"INSERT INTO mcp_oauth_clients
           (client_id, client_name, redirect_uris, client_uri, logo_uri, token_endpoint_auth_method, client_secret_hash, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)"#,
    )
    .bind(&client_id)
    .bind(&client_name)
    .bind(serde_json::to_string(&redirect_uris).unwrap_or_else(|_| "[]".into()))
    .bind(&client_uri)
    .bind(&logo_uri)
    .bind(&method)
    .bind(secret.as_deref().map(token_hash).unwrap_or_default())
    .bind(&now)
    .execute(pool)
    .await;
    if let Err(e) = res {
        return oauth_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "server_error",
            &e.to_string(),
        );
    }
    tracing::info!(client_id = %client_id, client_name = %client_name, redirect_uris = ?redirect_uris, "OAuth MCP : client enregistré (DCR)");
    let mut out = json!({
        "client_id": client_id,
        "client_id_issued_at": issued_at,
        "client_name": client_name,
        "redirect_uris": redirect_uris,
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": method,
        "scope": format!("{SCOPE_MCP} {SCOPE_OFFLINE}"),
    });
    if !client_uri.is_empty() {
        out["client_uri"] = json!(client_uri);
    }
    if !logo_uri.is_empty() {
        out["logo_uri"] = json!(logo_uri);
    }
    if let Some(s) = secret {
        out["client_secret"] = json!(s);
        out["client_secret_expires_at"] = json!(0);
    }
    let mut res = (StatusCode::CREATED, Json(out)).into_response();
    no_store(&mut res);
    res
}

// ---------------------------------------------------------------------------
// Autorisation
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Default)]
pub struct AuthorizeQuery {
    response_type: Option<String>,
    client_id: Option<String>,
    redirect_uri: Option<String>,
    code_challenge: Option<String>,
    code_challenge_method: Option<String>,
    state: Option<String>,
    scope: Option<String>,
    resource: Option<String>,
}

/// Scopes accordés : toujours `mcp`, plus `offline_access` si demandé. Les autres sont ignorés.
pub fn granted_scope(requested: Option<&str>) -> String {
    let wants_offline = requested
        .unwrap_or("")
        .split_whitespace()
        .any(|s| s == SCOPE_OFFLINE);
    if wants_offline {
        format!("{SCOPE_MCP} {SCOPE_OFFLINE}")
    } else {
        SCOPE_MCP.to_string()
    }
}

/// `resource` (RFC 8707) doit désigner cette instance.
pub fn resource_ok(base: &str, resource: &str) -> bool {
    let r = resource.trim().trim_end_matches('/');
    let b = base.trim_end_matches('/');
    r == b || r.starts_with(&format!("{b}/"))
}

fn append_query(uri: &str, params: &[(&str, &str)]) -> String {
    let mut out = uri.to_string();
    let mut sep = if uri.contains('?') { '&' } else { '?' };
    for (k, v) in params {
        out.push(sep);
        out.push_str(k);
        out.push('=');
        out.push_str(&urlencoding::encode(v));
        sep = '&';
    }
    out
}

fn redirect_error(
    redirect_uri: &str,
    state: Option<&str>,
    iss: &str,
    error: &str,
    desc: &str,
) -> Response {
    let mut params = vec![("error", error), ("error_description", desc)];
    if let Some(s) = state {
        params.push(("state", s));
    }
    params.push(("iss", iss));
    Redirect::to(&append_query(redirect_uri, &params)).into_response()
}

async fn authorize(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<AuthorizeQuery>,
) -> Response {
    let base = match public_base(&state, &headers).await {
        Ok(b) => b,
        Err(r) => return r,
    };
    let client_id = q.client_id.clone().unwrap_or_default();
    let client = match resolve_client(&state.pool, &client_id).await {
        Ok(c) => c,
        Err(e) => return error_page("Application inconnue", &e),
    };
    let redirect_uri = match q.redirect_uri.clone().filter(|s| !s.trim().is_empty()) {
        Some(r) => r,
        None if client.redirect_uris.len() == 1 => client.redirect_uris[0].clone(),
        None => return error_page("Redirection manquante", "redirect_uri requis."),
    };
    if !redirect_matches(&client, &redirect_uri) {
        tracing::warn!(client_id = %client.client_id, redirect_uri = %redirect_uri, "OAuth MCP : redirect_uri refusée");
        return error_page(
            "Redirection refusée",
            "L’adresse de retour ne correspond pas à celles déclarées par l’application.",
        );
    }
    let st = q.state.as_deref();
    if q.response_type.as_deref() != Some("code") {
        return redirect_error(
            &redirect_uri,
            st,
            &base,
            "unsupported_response_type",
            "response_type=code requis",
        );
    }
    let challenge = q.code_challenge.clone().unwrap_or_default();
    if challenge.len() < 43 || challenge.len() > 128 {
        return redirect_error(
            &redirect_uri,
            st,
            &base,
            "invalid_request",
            "PKCE code_challenge requis",
        );
    }
    if q.code_challenge_method.as_deref() != Some("S256") {
        return redirect_error(
            &redirect_uri,
            st,
            &base,
            "invalid_request",
            "code_challenge_method=S256 requis",
        );
    }
    let resource = q.resource.clone().unwrap_or_default();
    if !resource.trim().is_empty() && !resource_ok(&base, &resource) {
        return redirect_error(
            &redirect_uri,
            st,
            &base,
            "invalid_target",
            "resource inconnue",
        );
    }
    let scope = granted_scope(q.scope.as_deref());

    let now = now_str();
    let _ = sqlx::query("DELETE FROM mcp_oauth_requests WHERE expires_at < $1")
        .bind(&now)
        .execute(&state.pool)
        .await;
    let _ = sqlx::query("DELETE FROM mcp_oauth_codes WHERE expires_at < $1")
        .bind(&now)
        .execute(&state.pool)
        .await;

    let id = random_secret("");
    let res = sqlx::query(
        r#"INSERT INTO mcp_oauth_requests
           (id, client_id, client_name, redirect_uri, code_challenge, state, scope, resource, expires_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"#,
    )
    .bind(&id)
    .bind(&client.client_id)
    .bind(&client.name)
    .bind(&redirect_uri)
    .bind(&challenge)
    .bind(q.state.as_deref().unwrap_or(""))
    .bind(&scope)
    .bind(resource.trim())
    .bind(in_secs(REQUEST_TTL_SECS))
    .bind(&now)
    .execute(&state.pool)
    .await;
    if let Err(e) = res {
        return error_page("Erreur serveur", &e.to_string());
    }
    tracing::info!(client_id = %client.client_id, redirect_uri = %redirect_uri, "OAuth MCP : demande d’autorisation");
    Redirect::to(&format!("/oauth/consent/?request={id}")).into_response()
}

#[derive(sqlx::FromRow)]
struct RequestRow {
    client_id: String,
    client_name: String,
    redirect_uri: String,
    code_challenge: String,
    state: String,
    scope: String,
    resource: String,
    expires_at: String,
}

async fn load_request(state: &AppState, id: &str) -> Result<RequestRow, (StatusCode, Json<Value>)> {
    let row: Option<RequestRow> = sqlx::query_as(
        "SELECT client_id, client_name, redirect_uri, code_challenge, state, scope, resource, expires_at FROM mcp_oauth_requests WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    match row {
        Some(r) if r.expires_at > now_str() => Ok(r),
        _ => Err((
            StatusCode::NOT_FOUND,
            Json(
                json!({"error": "Demande expirée ou introuvable — relance la connexion depuis l’application."}),
            ),
        )),
    }
}

async fn get_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let (user, _) = current_workspace(&state, &headers).await?;
    let r = load_request(&state, &id).await?;
    let redirect_host = reqwest::Url::parse(&r.redirect_uri)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_default();
    Ok(Json(json!({
        "client_id": r.client_id,
        "client_name": r.client_name,
        "redirect_host": redirect_host,
        "scope": r.scope,
        "expires_at": r.expires_at,
        "user": { "email": user.email, "name": user.name },
    })))
}

async fn approve_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let (user, _) = current_workspace(&state, &headers).await?;
    let base = public_base(&state, &headers).await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "URL publique introuvable"})),
        )
    })?;
    let r = load_request(&state, &id).await?;
    let deleted = sqlx::query("DELETE FROM mcp_oauth_requests WHERE id = $1")
        .bind(&id)
        .execute(&state.pool)
        .await
        .map(|d| d.rows_affected())
        .unwrap_or(0);
    if deleted == 0 {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({"error": "Demande déjà traitée"})),
        ));
    }
    let code = insert_code(
        &state.pool,
        &r.client_id,
        &r.client_name,
        &user.uuid,
        &r.redirect_uri,
        &r.code_challenge,
        &r.scope,
        &r.resource,
    )
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    let mut params = vec![("code", code.as_str())];
    if !r.state.is_empty() {
        params.push(("state", r.state.as_str()));
    }
    params.push(("iss", base.as_str()));
    tracing::info!(client_id = %r.client_id, user = %user.email, "OAuth MCP : accès autorisé");
    Ok(Json(json!({
        "ok": true,
        "redirect_to": append_query(&r.redirect_uri, &params),
    })))
}

/// Émet un code d'autorisation à usage unique (5 min) et renvoie sa valeur en clair.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn insert_code(
    pool: &sqlx::PgPool,
    client_id: &str,
    client_name: &str,
    user_uuid: &str,
    redirect_uri: &str,
    code_challenge: &str,
    scope: &str,
    resource: &str,
) -> Result<String, sqlx::Error> {
    let code = random_secret(CODE_PREFIX);
    sqlx::query(
        r#"INSERT INTO mcp_oauth_codes
           (code_hash, client_id, client_name, user_uuid, redirect_uri, code_challenge, scope, resource, expires_at, used_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10)"#,
    )
    .bind(token_hash(&code))
    .bind(client_id)
    .bind(client_name)
    .bind(user_uuid)
    .bind(redirect_uri)
    .bind(code_challenge)
    .bind(scope)
    .bind(resource)
    .bind(in_secs(CODE_TTL_SECS))
    .bind(now_str())
    .execute(pool)
    .await?;
    Ok(code)
}

async fn deny_request(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let _ = current_workspace(&state, &headers).await?;
    let base = public_base(&state, &headers).await.unwrap_or_default();
    let r = load_request(&state, &id).await?;
    let _ = sqlx::query("DELETE FROM mcp_oauth_requests WHERE id = $1")
        .bind(&id)
        .execute(&state.pool)
        .await;
    let mut params = vec![
        ("error", "access_denied"),
        ("error_description", "Accès refusé par l’utilisateur"),
    ];
    if !r.state.is_empty() {
        params.push(("state", r.state.as_str()));
    }
    if !base.is_empty() {
        params.push(("iss", base.as_str()));
    }
    Ok(Json(json!({
        "ok": true,
        "redirect_to": append_query(&r.redirect_uri, &params),
    })))
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

/// Identité client présentée au token endpoint (corps ou HTTP Basic).
fn client_credentials(
    headers: &HeaderMap,
    p: &HashMap<String, String>,
) -> (String, Option<String>) {
    if let Some(basic) = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Basic "))
    {
        if let Ok(raw) = STANDARD.decode(basic.trim()) {
            let s = String::from_utf8_lossy(&raw).to_string();
            if let Some((id, secret)) = s.split_once(':') {
                let dec = |x: &str| {
                    urlencoding::decode(x)
                        .map(|c| c.into_owned())
                        .unwrap_or_else(|_| x.to_string())
                };
                return (dec(id), Some(dec(secret)));
            }
        }
    }
    (
        p.get("client_id").cloned().unwrap_or_default(),
        p.get("client_secret").cloned().filter(|s| !s.is_empty()),
    )
}

async fn authenticate_client(
    pool: &sqlx::PgPool,
    client_id: &str,
    secret: Option<&str>,
) -> Result<(), Response> {
    if client_id.starts_with("https://") {
        return Ok(());
    }
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT token_endpoint_auth_method, client_secret_hash FROM mcp_oauth_clients WHERE client_id = $1",
    )
    .bind(client_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| oauth_error(StatusCode::INTERNAL_SERVER_ERROR, "server_error", &e.to_string()))?;
    let Some((method, hash)) = row else {
        return Err(oauth_error(
            StatusCode::UNAUTHORIZED,
            "invalid_client",
            "Client inconnu",
        ));
    };
    if method == "none" {
        return Ok(());
    }
    match secret {
        Some(s) if constant_eq(&token_hash(s), &hash) => Ok(()),
        _ => Err(oauth_error(
            StatusCode::UNAUTHORIZED,
            "invalid_client",
            "client_secret invalide",
        )),
    }
}

struct Issued {
    access: String,
    refresh: String,
    scope: String,
}

#[allow(clippy::too_many_arguments)]
async fn issue_tokens(
    pool: &sqlx::PgPool,
    client_id: &str,
    client_name: &str,
    user_uuid: &str,
    scope: &str,
    resource: &str,
    family: &str,
) -> Result<Issued, sqlx::Error> {
    let access = random_secret(ACCESS_TOKEN_PREFIX);
    let refresh = random_secret(REFRESH_TOKEN_PREFIX);
    let now = now_str();
    let refresh_exp = (Utc::now() + Duration::days(REFRESH_TTL_DAYS)).to_rfc3339();
    for (kind, tok, exp) in [
        ("access", &access, in_secs(ACCESS_TTL_SECS)),
        ("refresh", &refresh, refresh_exp),
    ] {
        sqlx::query(
            r#"INSERT INTO mcp_oauth_tokens
               (id, kind, token_hash, client_id, client_name, user_uuid, scope, resource, family, expires_at, revoked_at, last_used_at, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, NULL, $11)"#,
        )
        .bind(uuid::Uuid::new_v4().to_string())
        .bind(kind)
        .bind(token_hash(tok))
        .bind(client_id)
        .bind(client_name)
        .bind(user_uuid)
        .bind(scope)
        .bind(resource)
        .bind(family)
        .bind(exp)
        .bind(&now)
        .execute(pool)
        .await?;
    }
    Ok(Issued {
        access,
        refresh,
        scope: scope.to_string(),
    })
}

fn token_response(issued: Issued) -> Response {
    let mut res = Json(json!({
        "access_token": issued.access,
        "token_type": "Bearer",
        "expires_in": ACCESS_TTL_SECS,
        "refresh_token": issued.refresh,
        "scope": issued.scope,
    }))
    .into_response();
    no_store(&mut res);
    res
}

async fn token(State(state): State<AppState>, headers: HeaderMap, body: Bytes) -> Response {
    let p = parse_params(&headers, &body);
    let (client_id, secret) = client_credentials(&headers, &p);
    let grant = p.get("grant_type").map(String::as_str).unwrap_or("");
    match grant {
        "authorization_code" => {
            token_from_code(&state.pool, &p, &client_id, secret.as_deref()).await
        }
        "refresh_token" => token_from_refresh(&state.pool, &p, &client_id, secret.as_deref()).await,
        _ => oauth_error(
            StatusCode::BAD_REQUEST,
            "unsupported_grant_type",
            "grant_type authorization_code ou refresh_token",
        ),
    }
}

#[derive(sqlx::FromRow)]
struct CodeRow {
    client_id: String,
    client_name: String,
    user_uuid: String,
    redirect_uri: String,
    code_challenge: String,
    scope: String,
    resource: String,
    expires_at: String,
    used_at: Option<String>,
}

async fn token_from_code(
    pool: &sqlx::PgPool,
    p: &HashMap<String, String>,
    client_id: &str,
    secret: Option<&str>,
) -> Response {
    let code = p.get("code").cloned().unwrap_or_default();
    let verifier = p.get("code_verifier").cloned().unwrap_or_default();
    if code.is_empty() || verifier.is_empty() {
        return oauth_error(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "code et code_verifier requis",
        );
    }
    let hash = token_hash(&code);
    let row: Option<CodeRow> = match sqlx::query_as(
        "SELECT client_id, client_name, user_uuid, redirect_uri, code_challenge, scope, resource, expires_at, used_at FROM mcp_oauth_codes WHERE code_hash = $1",
    )
    .bind(&hash)
    .fetch_optional(pool)
    .await
    {
        Ok(r) => r,
        Err(e) => return oauth_error(StatusCode::INTERNAL_SERVER_ERROR, "server_error", &e.to_string()),
    };
    let Some(row) = row else {
        return oauth_error(StatusCode::BAD_REQUEST, "invalid_grant", "Code inconnu");
    };
    let client_id = if client_id.is_empty() {
        row.client_id.clone()
    } else {
        client_id.to_string()
    };
    if client_id != row.client_id {
        return oauth_error(
            StatusCode::BAD_REQUEST,
            "invalid_grant",
            "Code émis pour un autre client",
        );
    }
    if let Err(r) = authenticate_client(pool, &client_id, secret).await {
        return r;
    }
    if row.used_at.is_some() {
        // Rejeu : on révoque ce qui a été émis avec ce code.
        let _ = sqlx::query(
            "UPDATE mcp_oauth_tokens SET revoked_at = $1 WHERE family = $2 AND revoked_at IS NULL",
        )
        .bind(now_str())
        .bind(format!("code:{hash}"))
        .execute(pool)
        .await;
        return oauth_error(
            StatusCode::BAD_REQUEST,
            "invalid_grant",
            "Code déjà utilisé",
        );
    }
    if row.expires_at < now_str() {
        return oauth_error(StatusCode::BAD_REQUEST, "invalid_grant", "Code expiré");
    }
    if let Some(r) = p.get("redirect_uri").filter(|s| !s.is_empty()) {
        if r != &row.redirect_uri {
            return oauth_error(
                StatusCode::BAD_REQUEST,
                "invalid_grant",
                "redirect_uri différente",
            );
        }
    }
    if !valid_code_verifier(&verifier) || !constant_eq(&pkce_s256(&verifier), &row.code_challenge) {
        return oauth_error(
            StatusCode::BAD_REQUEST,
            "invalid_grant",
            "PKCE code_verifier invalide",
        );
    }
    let claimed = sqlx::query(
        "UPDATE mcp_oauth_codes SET used_at = $1 WHERE code_hash = $2 AND used_at IS NULL",
    )
    .bind(now_str())
    .bind(&hash)
    .execute(pool)
    .await
    .map(|r| r.rows_affected())
    .unwrap_or(0);
    if claimed != 1 {
        return oauth_error(
            StatusCode::BAD_REQUEST,
            "invalid_grant",
            "Code déjà utilisé",
        );
    }
    let resource = p
        .get("resource")
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or(row.resource.clone());
    match issue_tokens(
        pool,
        &row.client_id,
        &row.client_name,
        &row.user_uuid,
        &row.scope,
        &resource,
        &format!("code:{hash}"),
    )
    .await
    {
        Ok(issued) => token_response(issued),
        Err(e) => oauth_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "server_error",
            &e.to_string(),
        ),
    }
}

#[derive(sqlx::FromRow)]
struct TokenRow {
    id: String,
    client_id: String,
    client_name: String,
    user_uuid: String,
    scope: String,
    resource: String,
    family: String,
    expires_at: String,
    revoked_at: Option<String>,
}

async fn token_from_refresh(
    pool: &sqlx::PgPool,
    p: &HashMap<String, String>,
    client_id: &str,
    secret: Option<&str>,
) -> Response {
    let refresh = p.get("refresh_token").cloned().unwrap_or_default();
    if refresh.is_empty() {
        return oauth_error(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "refresh_token requis",
        );
    }
    let row: Option<TokenRow> = match sqlx::query_as(
        "SELECT id, client_id, client_name, user_uuid, scope, resource, family, expires_at, revoked_at FROM mcp_oauth_tokens WHERE token_hash = $1 AND kind = 'refresh'",
    )
    .bind(token_hash(&refresh))
    .fetch_optional(pool)
    .await
    {
        Ok(r) => r,
        Err(e) => return oauth_error(StatusCode::INTERNAL_SERVER_ERROR, "server_error", &e.to_string()),
    };
    let Some(row) = row else {
        return oauth_error(
            StatusCode::BAD_REQUEST,
            "invalid_grant",
            "refresh_token inconnu",
        );
    };
    let client_id = if client_id.is_empty() {
        row.client_id.clone()
    } else {
        client_id.to_string()
    };
    if client_id != row.client_id {
        return oauth_error(
            StatusCode::BAD_REQUEST,
            "invalid_grant",
            "refresh_token d’un autre client",
        );
    }
    if let Err(r) = authenticate_client(pool, &client_id, secret).await {
        return r;
    }
    if row.revoked_at.is_some() || row.expires_at < now_str() {
        return oauth_error(
            StatusCode::BAD_REQUEST,
            "invalid_grant",
            "refresh_token expiré ou révoqué",
        );
    }
    let rotated = sqlx::query(
        "UPDATE mcp_oauth_tokens SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL",
    )
    .bind(now_str())
    .bind(&row.id)
    .execute(pool)
    .await
    .map(|r| r.rows_affected())
    .unwrap_or(0);
    if rotated != 1 {
        return oauth_error(
            StatusCode::BAD_REQUEST,
            "invalid_grant",
            "refresh_token déjà utilisé",
        );
    }
    match issue_tokens(
        pool,
        &row.client_id,
        &row.client_name,
        &row.user_uuid,
        &row.scope,
        &row.resource,
        &row.family,
    )
    .await
    {
        Ok(issued) => token_response(issued),
        Err(e) => oauth_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "server_error",
            &e.to_string(),
        ),
    }
}

async fn revoke(State(state): State<AppState>, headers: HeaderMap, body: Bytes) -> Response {
    let p = parse_params(&headers, &body);
    let tok = p.get("token").cloned().unwrap_or_default();
    if tok.is_empty() {
        return oauth_error(StatusCode::BAD_REQUEST, "invalid_request", "token requis");
    }
    let row: Option<(String, String)> =
        sqlx::query_as("SELECT kind, family FROM mcp_oauth_tokens WHERE token_hash = $1")
            .bind(token_hash(&tok))
            .fetch_optional(&state.pool)
            .await
            .ok()
            .flatten();
    if let Some((kind, family)) = row {
        let now = now_str();
        if kind == "refresh" {
            let _ = sqlx::query("UPDATE mcp_oauth_tokens SET revoked_at = $1 WHERE family = $2 AND revoked_at IS NULL")
                .bind(&now)
                .bind(&family)
                .execute(&state.pool)
                .await;
        } else {
            let _ =
                sqlx::query("UPDATE mcp_oauth_tokens SET revoked_at = $1 WHERE token_hash = $2")
                    .bind(&now)
                    .bind(token_hash(&tok))
                    .execute(&state.pool)
                    .await;
        }
    }
    let mut res = StatusCode::OK.into_response();
    no_store(&mut res);
    res
}

/// Access token OAuth → utilisateur + abilities (lecture + écriture MCP).
pub async fn resolve_access_token(
    pool: &sqlx::PgPool,
    token: &str,
) -> Result<Option<(UserRow, Vec<String>)>, sqlx::Error> {
    if !token.starts_with(ACCESS_TOKEN_PREFIX) {
        return Ok(None);
    }
    let now = now_str();
    let row: Option<(String, String, String)> = sqlx::query_as(
        r#"SELECT id, user_uuid, scope FROM mcp_oauth_tokens
           WHERE token_hash = $1 AND kind = 'access' AND revoked_at IS NULL AND expires_at > $2"#,
    )
    .bind(token_hash(token))
    .bind(&now)
    .fetch_optional(pool)
    .await?;
    let Some((id, user_uuid, scope)) = row else {
        return Ok(None);
    };
    if !scope.split_whitespace().any(|s| s == SCOPE_MCP) {
        return Ok(None);
    }
    let _ = sqlx::query("UPDATE mcp_oauth_tokens SET last_used_at = $1 WHERE id = $2")
        .bind(&now)
        .bind(&id)
        .execute(pool)
        .await;
    let user = sqlx::query_as::<_, UserRow>(
        "SELECT uuid, email, name, password_hash, role FROM users WHERE uuid = $1",
    )
    .bind(user_uuid)
    .fetch_optional(pool)
    .await?;
    Ok(user.map(|u| (u, vec![ABILITY_READ.to_string(), ABILITY_WRITE.to_string()])))
}

// ---------------------------------------------------------------------------
// Applications connectées
// ---------------------------------------------------------------------------

async fn list_grants(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let (user, _) = current_workspace(&state, &headers).await?;
    let rows: Vec<(String, String, String, String, Option<String>)> = sqlx::query_as(
        r#"SELECT family, MAX(client_id), MAX(client_name), MIN(created_at), MAX(last_used_at)
           FROM mcp_oauth_tokens
           WHERE user_uuid = $1 AND revoked_at IS NULL AND expires_at > $2
           GROUP BY family
           ORDER BY MIN(created_at) DESC"#,
    )
    .bind(&user.uuid)
    .bind(now_str())
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?;
    let data: Vec<Value> = rows
        .into_iter()
        .map(
            |(family, client_id, client_name, created_at, last_used_at)| {
                json!({
                    "id": family,
                    "client_id": client_id,
                    "client_name": client_name,
                    "created_at": created_at,
                    "last_used_at": last_used_at,
                })
            },
        )
        .collect();
    Ok(Json(json!({ "data": data })))
}

async fn revoke_grant(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(family): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let (user, _) = current_workspace(&state, &headers).await?;
    let n = sqlx::query(
        "UPDATE mcp_oauth_tokens SET revoked_at = $1 WHERE family = $2 AND user_uuid = $3 AND revoked_at IS NULL",
    )
    .bind(now_str())
    .bind(&family)
    .bind(&user.uuid)
    .execute(&state.pool)
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": e.to_string()})),
        )
    })?
    .rows_affected();
    if n == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Accès introuvable"})),
        ));
    }
    Ok(Json(json!({"ok": true})))
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

pub async fn migrate(pool: &sqlx::PgPool) -> Result<(), sqlx::Error> {
    for sql in [
        r#"CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
            client_id TEXT PRIMARY KEY,
            client_name TEXT NOT NULL DEFAULT '',
            redirect_uris TEXT NOT NULL DEFAULT '[]',
            client_uri TEXT NOT NULL DEFAULT '',
            logo_uri TEXT NOT NULL DEFAULT '',
            token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
            client_secret_hash TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )"#,
        r#"CREATE TABLE IF NOT EXISTS mcp_oauth_requests (
            id TEXT PRIMARY KEY,
            client_id TEXT NOT NULL,
            client_name TEXT NOT NULL DEFAULT '',
            redirect_uri TEXT NOT NULL,
            code_challenge TEXT NOT NULL,
            state TEXT NOT NULL DEFAULT '',
            scope TEXT NOT NULL DEFAULT 'mcp',
            resource TEXT NOT NULL DEFAULT '',
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        )"#,
        r#"CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
            code_hash TEXT PRIMARY KEY,
            client_id TEXT NOT NULL,
            client_name TEXT NOT NULL DEFAULT '',
            user_uuid TEXT NOT NULL,
            redirect_uri TEXT NOT NULL,
            code_challenge TEXT NOT NULL,
            scope TEXT NOT NULL DEFAULT 'mcp',
            resource TEXT NOT NULL DEFAULT '',
            expires_at TEXT NOT NULL,
            used_at TEXT,
            created_at TEXT NOT NULL
        )"#,
        r#"CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            client_id TEXT NOT NULL,
            client_name TEXT NOT NULL DEFAULT '',
            user_uuid TEXT NOT NULL,
            scope TEXT NOT NULL DEFAULT 'mcp',
            resource TEXT NOT NULL DEFAULT '',
            family TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            revoked_at TEXT,
            last_used_at TEXT,
            created_at TEXT NOT NULL
        )"#,
        "CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_family ON mcp_oauth_tokens (family)",
        "CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_user ON mcp_oauth_tokens (user_uuid)",
    ] {
        sqlx::query(sql).execute(pool).await?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "mcp_oauth_tests.rs"]
mod tests;
