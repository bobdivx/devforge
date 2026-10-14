//! GitHub App — P3 : webhook app-level `POST /api/v1/webhooks/github-app`.
//!
//! Sécurité : HMAC-SHA256 du corps brut avec le `webhook_secret` scellé (comparaison
//! temps constant), aucun bypass « insecure », corps ≤ 25 Mo, anti-rejeu par
//! `X-GitHub-Delivery`, installation connue obligatoire. Réponse immédiate ; le
//! traitement tourne dans une tâche détachée.

use std::time::Instant;

use axum::{
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use sqlx::PgPool;

use crate::infra_routes::PushScope;
use crate::state::AppState;

/// Limite GitHub pour un payload webhook.
pub const MAX_BODY: usize = 25 * 1024 * 1024;
pub const RETENTION_DAYS: i32 = 7;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/webhooks/github-app",
            post(webhook).layer(DefaultBodyLimit::max(MAX_BODY)),
        )
        .route("/api/v1/github-app/deliveries", get(deliveries))
}

/// `sha256=<hex>` — comparaison temps constant (`verify_slice`).
pub fn verify_signature(secret: &[u8], body: &[u8], header: &str) -> bool {
    let Some(hex) = header.trim().strip_prefix("sha256=") else {
        return false;
    };
    let Some(sig) = decode_hex(hex) else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret) else {
        return false;
    };
    mac.update(body);
    mac.verify_slice(&sig).is_ok()
}

fn decode_hex(s: &str) -> Option<Vec<u8>> {
    if s.len() != 64 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok())
        .collect()
}

#[cfg(test)]
pub fn sign(secret: &[u8], body: &[u8]) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).unwrap();
    mac.update(body);
    let out = mac.finalize().into_bytes();
    format!(
        "sha256={}",
        out.iter().map(|b| format!("{b:02x}")).collect::<String>()
    )
}

async fn load_webhook_secret(pool: &PgPool) -> Option<zeroize::Zeroizing<Vec<u8>>> {
    let (enc,): (String,) =
        sqlx::query_as("SELECT webhook_secret_enc FROM github_app WHERE id = 1")
            .fetch_optional(pool)
            .await
            .ok()
            .flatten()?;
    match crate::secret_box::open(&enc) {
        Ok(s) => Some(s),
        Err(e) => {
            tracing::error!("webhook GitHub App : secret illisible : {e}");
            None
        }
    }
}

fn header<'a>(h: &'a HeaderMap, name: &str) -> &'a str {
    h.get(name)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .trim()
}

/// Événement accepté, à traiter hors requête.
#[derive(Debug)]
pub struct Accepted {
    pub delivery_id: String,
    pub event: String,
    pub action: String,
    pub installation_id: Option<i64>,
    pub payload: Value,
}

#[derive(Debug)]
pub enum Outcome {
    Reply(StatusCode, Value),
    Process(Box<Accepted>),
}

fn reply(code: StatusCode, v: Value) -> Outcome {
    Outcome::Reply(code, v)
}

async fn set_status(pool: &PgPool, delivery_id: &str, status: &str, duration_ms: Option<i64>) {
    let _ = sqlx::query(
        "UPDATE github_webhook_deliveries SET status = $2, duration_ms = COALESCE($3, duration_ms) WHERE delivery_id = $1",
    )
    .bind(delivery_id)
    .bind(status)
    .bind(duration_ms)
    .execute(pool)
    .await;
}

/// Vérifications synchrones (signature, anti-rejeu, installation). Aucun traitement lourd.
pub async fn receive(pool: &PgPool, headers: &HeaderMap, body: &[u8]) -> Outcome {
    let sig = header(headers, "x-hub-signature-256");
    if sig.is_empty() {
        return reply(
            StatusCode::UNAUTHORIZED,
            json!({"error": "signature absente"}),
        );
    }
    let Some(secret) = load_webhook_secret(pool).await else {
        return reply(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"error": "GitHub App non configurée"}),
        );
    };
    if !verify_signature(&secret, body, sig) {
        return reply(
            StatusCode::UNAUTHORIZED,
            json!({"error": "signature invalide"}),
        );
    }
    let event = header(headers, "x-github-event").to_string();
    let delivery_id = header(headers, "x-github-delivery").to_string();
    if event.is_empty() || delivery_id.is_empty() || delivery_id.len() > 128 {
        return reply(
            StatusCode::BAD_REQUEST,
            json!({"error": "en-têtes GitHub manquants"}),
        );
    }
    let Ok(payload) = serde_json::from_slice::<Value>(body) else {
        return reply(StatusCode::BAD_REQUEST, json!({"error": "JSON invalide"}));
    };
    let action = payload
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let installation_id = payload.pointer("/installation/id").and_then(Value::as_i64);

    let inserted = sqlx::query(
        r#"INSERT INTO github_webhook_deliveries (delivery_id, event, status, installation_id, action)
           VALUES ($1, $2, 'received', $3, $4) ON CONFLICT (delivery_id) DO NOTHING"#,
    )
    .bind(&delivery_id)
    .bind(&event)
    .bind(installation_id)
    .bind(&action)
    .execute(pool)
    .await;
    match inserted {
        Ok(r) if r.rows_affected() == 0 => {
            return reply(StatusCode::OK, json!({"ok": true, "duplicate": true}));
        }
        Ok(_) => {}
        Err(e) => {
            tracing::error!("webhook GitHub App : enregistrement livraison : {e}");
            return reply(
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({"error": "erreur base"}),
            );
        }
    }

    if event == "ping" {
        set_status(pool, &delivery_id, "processed", Some(0)).await;
        return reply(StatusCode::OK, json!({"ok": true, "pong": true}));
    }

    // `installation.created` peut précéder le retour `/installed` : on l'accepte.
    let creates = event == "installation" && action == "created";
    let known = match installation_id {
        Some(id) => sqlx::query_as::<_, (i64,)>(
            "SELECT installation_id FROM github_installations WHERE installation_id = $1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
        .is_some(),
        None => false,
    };
    if !known && !creates {
        tracing::info!(event = %event, ?installation_id, "webhook GitHub App : installation inconnue, ignoré");
        set_status(pool, &delivery_id, "ignored_unknown_installation", Some(0)).await;
        return reply(
            StatusCode::ACCEPTED,
            json!({"ok": true, "ignored": "installation inconnue"}),
        );
    }
    Outcome::Process(Box::new(Accepted {
        delivery_id,
        event,
        action,
        installation_id,
        payload,
    }))
}

async fn webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> (StatusCode, Json<Value>) {
    match receive(&state.pool, &headers, &body).await {
        Outcome::Reply(code, v) => (code, Json(v)),
        Outcome::Process(acc) => {
            let delivery = acc.delivery_id.clone();
            let event = acc.event.clone();
            tokio::spawn(async move { process(&state, *acc).await });
            (
                StatusCode::OK,
                Json(json!({"ok": true, "accepted": event, "delivery": delivery})),
            )
        }
    }
}

/// Traitement détaché ; statut final de la livraison mis à jour.
pub async fn process(state: &AppState, acc: Accepted) {
    let t0 = Instant::now();
    let res = route(state, &acc).await;
    let ms = t0.elapsed().as_millis() as i64;
    let status = match &res {
        Ok(s) => s.to_string(),
        Err(e) => {
            tracing::warn!(delivery = %acc.delivery_id, event = %acc.event, "webhook GitHub App : échec : {e}");
            "failed".into()
        }
    };
    set_status(&state.pool, &acc.delivery_id, &status, Some(ms)).await;
}

async fn route(state: &AppState, acc: &Accepted) -> Result<&'static str, String> {
    match acc.event.as_str() {
        "installation" => apply_installation_event(&state.pool, &acc.action, &acc.payload).await,
        "installation_repositories" => {
            apply_installation_repositories(&state.pool, &acc.action, &acc.payload).await
        }
        "push" => {
            let id = acc.installation_id.ok_or("installation absente")?;
            crate::infra_routes::handle_push(state, &acc.payload, PushScope::Installation(id))
                .await
                .map(|_| "processed")
                .map_err(|(_, j)| j.0.to_string())
        }
        "check_run" | "check_suite" if acc.action == "rerequested" => {
            let id = acc.installation_id.ok_or("installation absente")?;
            let Some(push) = rerequest_as_push(&acc.event, &acc.payload) else {
                return Ok("ignored");
            };
            crate::infra_routes::handle_push(state, &push, PushScope::Installation(id))
                .await
                .map(|_| "processed")
                .map_err(|(_, j)| j.0.to_string())
        }
        // Previews de PR : phase P5.
        "pull_request" => Ok("ignored_until_p5"),
        _ => Ok("ignored"),
    }
}

/// `check_run|check_suite.rerequested` ⇒ redéploiement de la branche du `head_sha`.
pub fn rerequest_as_push(event: &str, payload: &Value) -> Option<Value> {
    let suite = if event == "check_run" {
        payload.pointer("/check_run/check_suite")?
    } else {
        payload.get("check_suite")?
    };
    let branch = suite.get("head_branch").and_then(Value::as_str)?;
    let sha = suite.get("head_sha").and_then(Value::as_str)?;
    Some(json!({
        "ref": format!("refs/heads/{branch}"),
        "repository": payload.get("repository")?,
        "installation": payload.get("installation"),
        "head_commit": { "id": sha, "message": "Relance demandée depuis GitHub" },
    }))
}

async fn upsert_installation(
    pool: &PgPool,
    inst: &Value,
    suspended: Option<bool>,
) -> Result<i64, String> {
    let id = inst
        .get("id")
        .and_then(Value::as_i64)
        .ok_or("installation.id absent")?;
    let login = inst
        .pointer("/account/login")
        .and_then(Value::as_str)
        .unwrap_or("");
    let kind = inst
        .pointer("/account/type")
        .and_then(Value::as_str)
        .unwrap_or("");
    let sel = inst
        .get("repository_selection")
        .and_then(Value::as_str)
        .unwrap_or("selected");
    let perms = inst
        .get("permissions")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let susp = match suspended {
        Some(true) => Some(
            inst.get("suspended_at")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
        ),
        Some(false) => None,
        None => inst
            .get("suspended_at")
            .and_then(Value::as_str)
            .map(str::to_string),
    };
    sqlx::query(
        r#"
        INSERT INTO github_installations (installation_id, account_login, account_type,
            repository_selection, permissions, suspended_at)
        VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
        ON CONFLICT (installation_id) DO UPDATE SET
            account_login = EXCLUDED.account_login, account_type = EXCLUDED.account_type,
            repository_selection = EXCLUDED.repository_selection,
            permissions = EXCLUDED.permissions, suspended_at = EXCLUDED.suspended_at,
            updated_at = now()
        "#,
    )
    .bind(id)
    .bind(login)
    .bind(kind)
    .bind(sel)
    .bind(&perms)
    .bind(susp)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(id)
}

async fn add_repos(pool: &PgPool, id: i64, repos: Option<&Value>) -> Result<(), String> {
    for r in repos.and_then(Value::as_array).into_iter().flatten() {
        let (Some(rid), Some(full)) = (
            r.get("id").and_then(Value::as_i64),
            r.get("full_name").and_then(Value::as_str),
        ) else {
            continue;
        };
        sqlx::query(
            r#"INSERT INTO github_installation_repos (installation_id, repo_id, full_name, private)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (installation_id, repo_id) DO UPDATE SET full_name = EXCLUDED.full_name,
                   private = EXCLUDED.private"#,
        )
        .bind(id)
        .bind(rid)
        .bind(full)
        .bind(r.get("private").and_then(Value::as_bool).unwrap_or(false))
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

async fn remove_repos(pool: &PgPool, id: i64, repos: Option<&Value>) -> Result<(), String> {
    for rid in repos
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|r| r.get("id").and_then(Value::as_i64))
    {
        sqlx::query(
            "DELETE FROM github_installation_repos WHERE installation_id = $1 AND repo_id = $2",
        )
        .bind(id)
        .bind(rid)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// `installation` : created / deleted / suspend / unsuspend / new_permissions_accepted.
/// `deleted` ⇒ installation oubliée ; les projets liés restent (mode « déconnecté »).
pub async fn apply_installation_event(
    pool: &PgPool,
    action: &str,
    p: &Value,
) -> Result<&'static str, String> {
    let inst = p.get("installation").ok_or("installation absente")?;
    match action {
        "created" => {
            let id = upsert_installation(pool, inst, None).await?;
            add_repos(pool, id, p.get("repositories")).await?;
        }
        "new_permissions_accepted" => {
            upsert_installation(pool, inst, None).await?;
        }
        "suspend" => {
            upsert_installation(pool, inst, Some(true)).await?;
        }
        "unsuspend" => {
            upsert_installation(pool, inst, Some(false)).await?;
        }
        "deleted" => {
            let id = inst
                .get("id")
                .and_then(Value::as_i64)
                .ok_or("installation.id absent")?;
            sqlx::query("DELETE FROM github_installations WHERE installation_id = $1")
                .bind(id)
                .execute(pool)
                .await
                .map_err(|e| e.to_string())?;
        }
        _ => return Ok("ignored"),
    }
    Ok("processed")
}

pub async fn apply_installation_repositories(
    pool: &PgPool,
    action: &str,
    p: &Value,
) -> Result<&'static str, String> {
    let id = p
        .pointer("/installation/id")
        .and_then(Value::as_i64)
        .ok_or("installation.id absent")?;
    if let Some(sel) = p.get("repository_selection").and_then(Value::as_str) {
        let _ = sqlx::query(
            "UPDATE github_installations SET repository_selection = $2, updated_at = now() WHERE installation_id = $1",
        )
        .bind(id)
        .bind(sel)
        .execute(pool)
        .await;
    }
    match action {
        "added" => add_repos(pool, id, p.get("repositories_added")).await?,
        "removed" => remove_repos(pool, id, p.get("repositories_removed")).await?,
        _ => return Ok("ignored"),
    }
    Ok("processed")
}

/// Purge des livraisons de plus de 7 jours (appelée par le tick auto-deploy).
pub async fn purge_old_deliveries(pool: &PgPool) {
    let _ = sqlx::query(
        "DELETE FROM github_webhook_deliveries WHERE received_at < now() - make_interval(days => $1)",
    )
    .bind(RETENTION_DAYS)
    .execute(pool)
    .await;
}

pub async fn recent_deliveries(pool: &PgPool) -> Result<Vec<Value>, sqlx::Error> {
    let rows: Vec<(
        String,
        String,
        Option<String>,
        String,
        Option<i64>,
        Option<i64>,
        String,
    )> = sqlx::query_as(
        r#"SELECT delivery_id, event, action, status, duration_ms, installation_id,
                  to_char(received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
           FROM github_webhook_deliveries ORDER BY received_at DESC LIMIT 20"#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(d, e, a, s, ms, i, at)| {
            json!({"delivery_id": d, "event": e, "action": a, "status": s,
                   "duration_ms": ms, "installation_id": i, "received_at": at})
        })
        .collect())
}

/// `GET /api/v1/github-app/deliveries` — 20 dernières, sans payload (admin).
async fn deliveries(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let (user, _) = crate::auth_routes::current_workspace(&state, &headers).await?;
    if user.role != "instance_admin" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Réservé à l’admin instance"})),
        ));
    }
    let items = recent_deliveries(&state.pool).await.map_err(|e| {
        tracing::error!("livraisons webhook : {e}");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "erreur base"})),
        )
    })?;
    Ok(Json(json!({"ok": true, "deliveries": items})))
}

#[cfg(test)]
#[path = "github_app_events_tests.rs"]
mod tests;
