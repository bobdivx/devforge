//! Réveiller un bot Grok depuis DevForge : URL de webhook + clé d'envoi, par espace.
//! L'URL et la clé sont scellées comme les autres secrets (`secret_box`) et jamais renvoyées.
//! Envoi : POST JSON générique `{event, project, run, message}`, en-têtes
//! `Authorization: Bearer <clé>` et `X-Automation-Key: <clé>`, 8 s, un seul essai,
//! client gardé (pas d'adresse interne, pas de redirection, pas de proxy) comme page-watch.

use std::time::Duration;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::PgPool;

use crate::page_watch::{self, FetchPolicy, BLOCKED_MESSAGE};
use crate::routes::ApiError;

pub const WAKE_TIMEOUT: Duration = Duration::from_secs(8);
pub const MIN_INTERVAL_SECS: i64 = 5;
pub const USER_AGENT: &str = "DevForge-GrokBot/1.0 (+https://web.jeser.app)";
const MAX_MESSAGE: usize = 2000;

pub fn router() -> Router<crate::state::AppState> {
    Router::new()
        .route(
            "/api/v1/grok-bot/settings",
            get(get_settings).patch(patch_settings),
        )
        .route("/api/v1/grok-bot/wake", post(wake))
        .route("/api/v1/grok-bot/test", post(test))
}

pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS grok_bot_settings (
            workspace_uuid TEXT PRIMARY KEY,
            url_sealed     TEXT NOT NULL DEFAULT '',
            key_sealed     TEXT NOT NULL DEFAULT '',
            last_ok        BOOLEAN NULL,
            last_status    INT NULL,
            last_message   TEXT NULL,
            last_event     TEXT NULL,
            last_at        TIMESTAMPTZ NULL,
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        )"#,
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, Default)]
pub struct Settings {
    pub url: String,
    pub key: String,
    pub last_ok: Option<bool>,
    pub last_status: Option<i32>,
    pub last_message: Option<String>,
    pub last_event: Option<String>,
    pub last_at: Option<String>,
}

type Row = (
    String,
    String,
    Option<bool>,
    Option<i32>,
    Option<String>,
    Option<String>,
    Option<String>,
);

pub async fn load(pool: &PgPool, workspace: &str) -> Settings {
    let row: Option<Row> = sqlx::query_as(
        r#"SELECT url_sealed, key_sealed, last_ok, last_status, last_message, last_event, last_at::text
           FROM grok_bot_settings WHERE workspace_uuid = $1"#,
    )
    .bind(workspace)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    let Some((u, k, last_ok, last_status, last_message, last_event, last_at)) = row else {
        return Settings::default();
    };
    let open = |s: &str| {
        if s.is_empty() {
            String::new()
        } else {
            crate::secret_box::open_compat(s)
        }
    };
    Settings {
        url: open(&u),
        key: open(&k),
        last_ok,
        last_status,
        last_message,
        last_event,
        last_at,
    }
}

/// Hôte seul (jamais le chemin, qui peut porter l'identifiant de la routine).
pub fn url_hint(url: &str) -> Option<String> {
    let u = reqwest::Url::parse(url).ok()?;
    Some(format!("{}://{}/…", u.scheme(), u.host_str()?))
}

/// Réponse publique : jamais l'URL complète ni la clé.
pub fn settings_json(s: &Settings) -> Value {
    json!({
        "configured": !s.url.is_empty() && !s.key.is_empty(),
        "url_set": !s.url.is_empty(),
        "url_hint": url_hint(&s.url),
        "key_set": !s.key.is_empty(),
        "last": s.last_at.as_ref().map(|at| json!({
            "ok": s.last_ok,
            "status": s.last_status,
            "message": s.last_message,
            "event": s.last_event,
            "at": at,
        })),
    })
}

/// URL de webhook : https publique (http seulement en test loopback), sans identifiants.
pub fn validate_webhook_url(raw: &str, policy: &FetchPolicy) -> Result<reqwest::Url, String> {
    let url = page_watch::validate_url(raw, policy).map_err(|e| {
        if e == BLOCKED_MESSAGE {
            "Adresse interne refusée : le webhook doit être une adresse publique.".to_string()
        } else {
            e.replace("la page", "le webhook")
        }
    })?;
    if url.scheme() != "https" && !policy.allow_loopback {
        return Err("Le webhook doit être en https.".into());
    }
    Ok(url)
}

/// Clé d'envoi : une ligne, sans espace, bornée.
pub fn validate_key(raw: &str) -> Result<String, String> {
    let k = raw.trim();
    if k.len() < 8 || k.len() > 512 || k.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("Clé d'envoi invalide (une seule ligne, sans espace).".into());
    }
    Ok(k.to_string())
}

/// Corps générique documenté (docs/plans/agent-playbooks.md).
pub fn payload(event: &str, project: Value, run: Value, message: &str) -> Value {
    let message: String = message.trim().chars().take(MAX_MESSAGE).collect();
    json!({
        "event": event,
        "project": project,
        "run": run,
        "message": message,
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct WakeResult {
    pub ok: bool,
    pub status: Option<u16>,
    pub message: String,
}

/// Un seul POST, 8 s, client gardé. Le corps de réponse n'est jamais relu ni renvoyé.
pub async fn send(url: &str, key: &str, body: &Value, policy: &FetchPolicy) -> WakeResult {
    let fail = |m: &str| WakeResult {
        ok: false,
        status: None,
        message: m.to_string(),
    };
    let url = match validate_webhook_url(url, policy) {
        Ok(u) => u,
        Err(e) => return fail(&e),
    };
    let client = match page_watch::guarded_client(policy, USER_AGENT) {
        Ok(c) => c,
        Err(e) => return fail(&e),
    };
    let req = client
        .post(url)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {key}"))
        .header("X-Automation-Key", key)
        .body(body.to_string());
    match tokio::time::timeout(policy.timeout, req.send()).await {
        Err(_) => fail("Le bot ne répond pas (délai de 8 s dépassé)."),
        Ok(Err(e)) if page_watch::is_blocked_error(&e) => {
            fail("Adresse interne refusée : le webhook doit être une adresse publique.")
        }
        Ok(Err(e)) if e.is_timeout() => fail("Le bot ne répond pas (délai de 8 s dépassé)."),
        Ok(Err(_)) => fail("Connexion impossible au webhook."),
        Ok(Ok(resp)) => {
            let st = resp.status();
            let code = st.as_u16();
            let message = if st.is_success() {
                format!("Bot réveillé (HTTP {code}) : demande acceptée, il travaille maintenant.")
            } else if st.is_redirection() {
                format!(
                    "Le webhook redirige (HTTP {code}) : redirection non suivie, vérifie l'URL."
                )
            } else if code == 401 || code == 403 {
                format!("Clé d'envoi refusée (HTTP {code}).")
            } else if code == 404 {
                "Webhook introuvable (HTTP 404) : vérifie l'URL.".to_string()
            } else if code == 429 {
                "Trop de réveils (HTTP 429) : réessaie dans un instant.".to_string()
            } else {
                format!("Le bot a refusé la demande (HTTP {code}).")
            };
            WakeResult {
                ok: st.is_success(),
                status: Some(code),
                message,
            }
        }
    }
}

fn policy() -> FetchPolicy {
    FetchPolicy {
        timeout: WAKE_TIMEOUT,
        max_bytes: 0,
        allow_loopback: false,
    }
}

async fn record(pool: &PgPool, workspace: &str, event: &str, r: &WakeResult) {
    let _ = sqlx::query(
        r#"UPDATE grok_bot_settings SET last_ok = $2, last_status = $3, last_message = $4,
                  last_event = $5, last_at = now() WHERE workspace_uuid = $1"#,
    )
    .bind(workspace)
    .bind(r.ok)
    .bind(r.status.map(|s| s as i32))
    .bind(&r.message)
    .bind(event)
    .execute(pool)
    .await;
}

/// Anti-rafale : un réveil au plus toutes les 5 s par espace.
async fn too_soon(pool: &PgPool, workspace: &str) -> bool {
    sqlx::query_scalar::<_, bool>(
        "SELECT COALESCE(last_at > now() - make_interval(secs => $2), FALSE) FROM grok_bot_settings WHERE workspace_uuid = $1",
    )
    .bind(workspace)
    .bind(MIN_INTERVAL_SECS as f64)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or(false)
}

async fn get_settings(
    State(state): State<crate::state::AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let (_u, ws) = crate::routes::require_auth(&state, &headers).await?;
    Ok(Json(
        json!({"data": settings_json(&load(&state.pool, &ws.uuid).await)}),
    ))
}

#[derive(Deserialize)]
struct PatchBody {
    /// Absent = ne pas toucher ; vide = effacer.
    #[serde(default)]
    url: Option<String>,
    /// Absente = ne pas toucher ; vide = effacer. Jamais renvoyée.
    #[serde(default)]
    key: Option<String>,
}

async fn patch_settings(
    State(state): State<crate::state::AppState>,
    headers: HeaderMap,
    Json(body): Json<PatchBody>,
) -> Result<Json<Value>, ApiError> {
    let (_u, ws) = crate::routes::require_auth(&state, &headers).await?;
    if body.url.is_none() && body.key.is_none() {
        return Err(ApiError::message("Rien à modifier."));
    }
    let current = load(&state.pool, &ws.uuid).await;
    let url = match body.url.as_deref().map(str::trim) {
        None => current.url.clone(),
        Some("") => String::new(),
        Some(u) => validate_webhook_url(u, &policy())
            .map_err(ApiError::message)?
            .to_string(),
    };
    let key = match body.key.as_deref().map(str::trim) {
        None => current.key.clone(),
        Some("") => String::new(),
        Some(k) => validate_key(k).map_err(ApiError::message)?,
    };
    let seal = |s: &str| {
        if s.is_empty() {
            String::new()
        } else {
            crate::secret_box::seal_compat(s)
        }
    };
    sqlx::query(
        r#"INSERT INTO grok_bot_settings (workspace_uuid, url_sealed, key_sealed, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (workspace_uuid) DO UPDATE SET url_sealed = $2, key_sealed = $3, updated_at = now()"#,
    )
    .bind(&ws.uuid)
    .bind(seal(&url))
    .bind(seal(&key))
    .execute(&state.pool)
    .await
    .map_err(ApiError::from)?;
    Ok(Json(
        json!({"data": settings_json(&load(&state.pool, &ws.uuid).await)}),
    ))
}

#[derive(Deserialize, Default)]
struct WakeBody {
    project_uuid: String,
    #[serde(default)]
    run_uuid: Option<String>,
    #[serde(default)]
    deployment_uuid: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

fn one_line(s: &str, max: usize) -> String {
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max)
        .collect()
}

async fn dispatch(
    state: &crate::state::AppState,
    workspace: &str,
    event: &str,
    body: Value,
) -> Result<Json<Value>, ApiError> {
    let s = load(&state.pool, workspace).await;
    if s.url.is_empty() || s.key.is_empty() {
        return Err(ApiError::message(
            "Bot Grok non configuré : ajoute l'URL du webhook et la clé d'envoi dans Réglages.",
        ));
    }
    if too_soon(&state.pool, workspace).await {
        return Err(ApiError {
            status: StatusCode::TOO_MANY_REQUESTS,
            message: "Bot déjà réveillé à l'instant : réessaie dans quelques secondes.".into(),
        });
    }
    let r = send(&s.url, &s.key, &body, &policy()).await;
    record(&state.pool, workspace, event, &r).await;
    Ok(Json(json!({"data": {
        "ok": r.ok,
        "status": r.status,
        "message": r.message,
        "event": event,
    }})))
}

async fn wake(
    State(state): State<crate::state::AppState>,
    headers: HeaderMap,
    Json(body): Json<WakeBody>,
) -> Result<Json<Value>, ApiError> {
    let (_u, ws, project) =
        crate::routes::auth_project(&state, &headers, &body.project_uuid).await?;
    let project_json = json!({
        "uuid": project.uuid,
        "name": project.name,
        "url": project.production_url,
    });
    let mut event = "devforge.wake";
    let mut auto = format!("DevForge : un coup de main sur « {} ».", project.name);
    let mut run_json = Value::Null;
    if let Some(run_uuid) = body.run_uuid.as_deref().filter(|s| !s.is_empty()) {
        let row: Option<(String, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT status, title, error, summary FROM agent_runs WHERE uuid = $1 AND project_uuid = $2",
        )
        .bind(run_uuid)
        .bind(&project.uuid)
        .fetch_optional(&state.pool)
        .await
        .map_err(ApiError::from)?;
        let (status, title, error, summary) = row.ok_or_else(|| ApiError::not_found("run"))?;
        if matches!(status.as_str(), "failed" | "cancelled") {
            event = "devforge.run_failed";
            auto = format!(
                "DevForge : « {} » a échoué sur « {} » : {}",
                title.clone().unwrap_or_else(|| "run".into()),
                project.name,
                one_line(error.as_deref().unwrap_or("erreur inconnue"), 400)
            );
        }
        run_json = json!({
            "type": "agent_run",
            "uuid": run_uuid,
            "status": status,
            "title": title,
            "error": error.as_deref().map(|e| one_line(e, 400)),
            "summary": summary.as_deref().map(|e| one_line(e, 400)),
        });
    } else if let Some(dep) = body.deployment_uuid.as_deref().filter(|s| !s.is_empty()) {
        let row: Option<(String, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT status, git_message, error_summary FROM deployments WHERE uuid = $1 AND project_id = $2",
        )
        .bind(dep)
        .bind(project.id)
        .fetch_optional(&state.pool)
        .await
        .unwrap_or(None);
        let (status, commit, err) = row.ok_or_else(|| ApiError::not_found("deployment"))?;
        if status == "failed" {
            event = "devforge.deploy_failed";
            auto = format!(
                "DevForge : la mise en ligne de « {} » a échoué : {}",
                project.name,
                one_line(err.as_deref().unwrap_or("erreur inconnue"), 400)
            );
        }
        run_json = json!({
            "type": "deployment",
            "uuid": dep,
            "status": status,
            "title": commit.as_deref().map(|c| one_line(c, 200)),
            "error": err.as_deref().map(|e| one_line(e, 400)),
        });
    }
    let message = body
        .message
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .map(|m| m.to_string())
        .unwrap_or(auto);
    let payload = payload(event, project_json, run_json, &message);
    dispatch(&state, &ws.uuid, event, payload).await
}

async fn test(
    State(state): State<crate::state::AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let (_u, ws) = crate::routes::require_auth(&state, &headers).await?;
    let payload = payload(
        "devforge.test",
        Value::Null,
        Value::Null,
        "DevForge : test de réveil. Réponds simplement que tu as bien reçu ce message.",
    );
    dispatch(&state, &ws.uuid, "devforge.test", payload).await
}
