//! User API tokens (Sanctum-style) + ability enforcement middleware.

use axum::{
    extract::{Path, Request, State},
    http::{Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    routing::{delete, get},
    Json, Router,
};
use chrono::Utc;
use devforge_auth::{
    abilities_csv, api_token_prefix, has_ability, hash_api_token, new_api_token, new_uuid,
    normalize_abilities, parse_abilities_csv, ABILITY_READ, ABILITY_WRITE,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::FromRow;

use crate::auth_routes::{bearer_from, current_workspace, resolve_auth};
use crate::state::{now_str, AppState};

#[derive(Debug, Clone, FromRow)]
struct ApiTokenRow {
    id: String,
    name: String,
    token_prefix: String,
    abilities: String,
    last_used_at: Option<String>,
    expires_at: Option<String>,
    created_at: String,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/tokens", get(list_tokens).post(create_token))
        .route("/api/v1/tokens/{id}", delete(revoke_token))
}

/// Middleware: API tokens (`dfat_`) without `write` cannot mutate REST (sauf MCP JSON-RPC).
pub async fn enforce_api_token_write(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Response {
    let method = req.method().clone();
    if matches!(
        method,
        Method::GET | Method::HEAD | Method::OPTIONS | Method::TRACE
    ) {
        return next.run(req).await;
    }
    let path = req.uri().path().to_string();
    // JSON-RPC MCP gère ses propres abilities.
    if path == "/api/v1/mcp" || path == "/mcp" {
        return next.run(req).await;
    }
    let Some(token) = bearer_from(req.headers()) else {
        return next.run(req).await;
    };
    if !token.starts_with("dfat_") {
        return next.run(req).await;
    }
    match resolve_auth(&state, &token).await {
        Ok(Some((_, abilities))) if has_ability(&abilities, ABILITY_WRITE) => next.run(req).await,
        Ok(Some(_)) => (
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Token API en lecture seule — ability `write` requise",
                "hint": "Crée un token avec read+write dans Compte → Tokens"
            })),
        )
            .into_response(),
        Ok(None) => next.run(req).await,
        Err((status, Json(v))) => (status, Json(v)).into_response(),
    }
}

fn internal(e: sqlx::Error) -> (StatusCode, Json<Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"error": e.to_string()})),
    )
}

#[derive(Deserialize)]
pub struct CreateTokenBody {
    pub name: String,
    pub abilities: Option<Vec<String>>,
    pub expires_in_days: Option<u32>,
}

async fn list_tokens(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let (user, _) = current_workspace(&state, &headers).await?;
    let rows: Vec<ApiTokenRow> = sqlx::query_as(
        r#"SELECT id, name, token_prefix, abilities, last_used_at, expires_at, created_at
           FROM api_tokens WHERE user_uuid = $1 ORDER BY created_at DESC"#,
    )
    .bind(&user.uuid)
    .fetch_all(&state.pool)
    .await
    .map_err(internal)?;
    let data: Vec<Value> = rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.id,
                "name": r.name,
                "token_prefix": r.token_prefix,
                "abilities": parse_abilities_csv(&r.abilities),
                "last_used_at": r.last_used_at,
                "expires_at": r.expires_at,
                "created_at": r.created_at,
            })
        })
        .collect();
    Ok(Json(json!({"data": data})))
}

async fn create_token(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<CreateTokenBody>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let (user, _) = current_workspace(&state, &headers).await?;
    let name = body.name.trim();
    if name.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Nom requis"})),
        ));
    }
    let abilities = normalize_abilities(
        &body
            .abilities
            .unwrap_or_else(|| vec![ABILITY_READ.to_string(), ABILITY_WRITE.to_string()]),
    );
    let plaintext = new_api_token();
    let id = format!("tok_{}", &new_uuid()[..10]);
    let now = now_str();
    let expires_at = body
        .expires_in_days
        .map(|d| (Utc::now() + chrono::Duration::days(i64::from(d))).to_rfc3339());
    sqlx::query(
        r#"INSERT INTO api_tokens
           (id, user_uuid, name, token_hash, token_prefix, abilities, last_used_at, expires_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8)"#,
    )
    .bind(&id)
    .bind(&user.uuid)
    .bind(name)
    .bind(hash_api_token(&plaintext))
    .bind(api_token_prefix(&plaintext))
    .bind(abilities_csv(&abilities))
    .bind(&expires_at)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(internal)?;

    Ok(Json(json!({
        "data": {
            "id": id,
            "name": name,
            "token": plaintext,
            "token_prefix": api_token_prefix(&plaintext),
            "abilities": abilities,
            "expires_at": expires_at,
            "created_at": now,
            "hint": "Copie ce token maintenant — il ne sera plus réaffiché."
        }
    })))
}

async fn revoke_token(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let (user, _) = current_workspace(&state, &headers).await?;
    let res = sqlx::query("DELETE FROM api_tokens WHERE id = $1 AND user_uuid = $2")
        .bind(&id)
        .bind(&user.uuid)
        .execute(&state.pool)
        .await
        .map_err(internal)?;
    if res.rows_affected() == 0 {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Token introuvable"})),
        ));
    }
    Ok(Json(json!({"ok": true})))
}
