//! Catalogue des zones publiques de l'instance.
//! Une zone est principale (`jeser.app`) ; les autres servent aux apps
//! qui n'habitent pas ce domaine. `wildcard_domain` reste synchronisé
//! sur la zone principale pour les lecteurs existants.

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{delete, get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::routes::ApiError;
use crate::state::{now_str, AppState, Project};

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/instance/domains",
            get(list_domains).post(add_domain),
        )
        .route(
            "/api/v1/instance/domains/{apex}/primary",
            post(make_primary),
        )
        .route("/api/v1/instance/domains/{apex}", delete(remove_domain))
}

#[derive(Debug, Clone)]
pub struct DomainRow {
    pub apex: String,
    pub primary: bool,
}

pub fn normalize_apex(raw: &str) -> Result<String, String> {
    let apex = raw
        .trim()
        .trim_start_matches("*.")
        .trim_start_matches('.')
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if apex.is_empty()
        || !apex.contains('.')
        || apex.contains('/')
        || apex.contains(' ')
        || apex.contains(':')
        || apex.contains('*')
    {
        return Err("domaine invalide".into());
    }
    Ok(apex)
}

pub fn host_of(url: &str) -> Option<String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return None;
    }
    let without_scheme = trimmed
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(trimmed);
    let host = without_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .split('@')
        .next_back()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .trim()
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if host.is_empty() {
        None
    } else {
        Some(host)
    }
}

pub fn host_under_apex(url: &str, apex: &str) -> bool {
    let Some(host) = host_of(url) else {
        return false;
    };
    let apex = apex.trim().trim_start_matches('.').to_ascii_lowercase();
    host == apex || host.ends_with(&format!(".{apex}"))
}

/// Garde l'URL si elle est déjà sous la zone. Sinon construit `https://{slug}.{zone}`.
pub fn url_for_zone(current: &str, slug: &str, zone: &str) -> String {
    let zone = zone.trim().trim_start_matches('.').to_ascii_lowercase();
    if zone.is_empty() {
        return current.trim().to_string();
    }
    if host_under_apex(current, &zone) {
        return current.trim().to_string();
    }
    let slug = slug.trim();
    if slug.is_empty() {
        return current.trim().to_string();
    }
    format!("https://{slug}.{zone}")
}

pub async fn list(pool: &sqlx::PgPool) -> Result<Vec<DomainRow>, sqlx::Error> {
    let rows = sqlx::query_as::<_, (String, i64)>(
        "SELECT apex, is_primary FROM instance_domains ORDER BY is_primary DESC, apex",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(apex, primary)| DomainRow {
            apex,
            primary: primary != 0,
        })
        .collect())
}

pub async fn contains(pool: &sqlx::PgPool, apex: &str) -> bool {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM instance_domains WHERE apex = $1")
        .bind(apex)
        .fetch_one(pool)
        .await
        .unwrap_or(0)
        > 0
}

pub async fn primary_apex(pool: &sqlx::PgPool) -> String {
    sqlx::query_scalar::<_, String>(
        "SELECT apex FROM instance_domains WHERE is_primary <> 0 ORDER BY apex LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .filter(|s| !s.is_empty())
    .unwrap_or_else(|| String::new())
}

/// Zone effective d'une app : choix de l'app, sinon du groupe, sinon repli utilisateur / principal.
pub async fn apex_for_project(pool: &sqlx::PgPool, project: &Project) -> String {
    let own = project.domain_apex.trim();
    if !own.is_empty() {
        return own.to_string();
    }
    let group = sqlx::query_scalar::<_, String>(
        r#"SELECT g.domain_apex FROM app_group_members m
           JOIN app_groups g ON g.uuid = m.group_uuid
           WHERE m.project_uuid = $1 AND trim(g.domain_apex) <> ''
           LIMIT 1"#,
    )
    .bind(&project.uuid)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten()
    .unwrap_or_default();
    if !group.trim().is_empty() {
        return group;
    }
    crate::user_prefs::effective_wildcard_for_workspace(pool, &project.workspace_uuid).await
}

pub async fn upsert_primary(pool: &sqlx::PgPool, raw: &str) -> Result<String, String> {
    let apex = normalize_apex(raw)?;
    let now = now_str();
    sqlx::query("UPDATE instance_domains SET is_primary = 0")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query(
        r#"INSERT INTO instance_domains (apex, is_primary, created_at)
           VALUES ($1, 1, $2)
           ON CONFLICT (apex) DO UPDATE SET is_primary = 1"#,
    )
    .bind(&apex)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    sqlx::query("UPDATE instance_settings SET wildcard_domain = $1, updated_at = $2 WHERE id = 1")
        .bind(&apex)
        .bind(&now)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(apex)
}

pub async fn add(pool: &sqlx::PgPool, raw: &str) -> Result<String, String> {
    let apex = normalize_apex(raw)?;
    let now = now_str();
    let rows = list(pool).await.map_err(|e| e.to_string())?;
    if rows.iter().any(|row| row.apex == apex) {
        return Ok(apex);
    }
    if rows.is_empty() {
        let current = crate::user_prefs::instance_wildcard(pool).await;
        if current.is_empty() || current == apex {
            return upsert_primary(pool, &apex).await;
        }
        upsert_primary(pool, &current).await?;
    }
    sqlx::query(
        r#"INSERT INTO instance_domains (apex, is_primary, created_at)
           VALUES ($1, 0, $2)
           ON CONFLICT (apex) DO NOTHING"#,
    )
    .bind(&apex)
    .bind(&now)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(apex)
}

pub async fn remove(pool: &sqlx::PgPool, raw: &str) -> Result<(), String> {
    let apex = normalize_apex(raw)?;
    let primary = primary_apex(pool).await;
    if apex == primary {
        return Err("choisis d'abord un autre domaine principal".into());
    }
    sqlx::query("DELETE FROM instance_domains WHERE apex = $1")
        .bind(&apex)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn rows_json(rows: &[DomainRow]) -> Value {
    json!({
        "data": rows.iter().map(|row| json!({
            "apex": row.apex,
            "primary": row.primary,
        })).collect::<Vec<_>>()
    })
}

async fn require_user(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<crate::auth_routes::UserRow, ApiError> {
    let (user, _) = crate::auth_routes::current_workspace(state, headers)
        .await
        .map_err(ApiError::from_auth)?;
    Ok(user)
}

async fn list_domains(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let _user = require_user(&state, &headers).await?;
    let rows = list(&state.pool).await.map_err(ApiError::from)?;
    Ok(Json(rows_json(&rows)))
}

#[derive(Deserialize)]
struct AddBody {
    apex: String,
}

async fn add_domain(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<AddBody>,
) -> Result<Json<Value>, ApiError> {
    let user = require_user(&state, &headers).await?;
    if user.role != "instance_admin" {
        return Err(ApiError::forbidden("Réservé à l’administrateur d’instance"));
    }
    add(&state.pool, &body.apex)
        .await
        .map_err(ApiError::message)?;
    let rows = list(&state.pool).await.map_err(ApiError::from)?;
    Ok(Json(rows_json(&rows)))
}

async fn make_primary(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(apex): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let user = require_user(&state, &headers).await?;
    if user.role != "instance_admin" {
        return Err(ApiError::forbidden("Réservé à l’administrateur d’instance"));
    }
    let decoded = urlencoding_decode(&apex);
    upsert_primary(&state.pool, &decoded)
        .await
        .map_err(ApiError::message)?;
    let rows = list(&state.pool).await.map_err(ApiError::from)?;
    Ok(Json(rows_json(&rows)))
}

async fn remove_domain(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(apex): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let user = require_user(&state, &headers).await?;
    if user.role != "instance_admin" {
        return Err(ApiError::forbidden("Réservé à l’administrateur d’instance"));
    }
    let decoded = urlencoding_decode(&apex);
    remove(&state.pool, &decoded)
        .await
        .map_err(ApiError::message)?;
    let rows = list(&state.pool).await.map_err(ApiError::from)?;
    Ok(Json(rows_json(&rows)))
}

fn urlencoding_decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) =
                u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""), 16)
            {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| raw.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_strips_wildcard() {
        assert_eq!(normalize_apex(" *.Jeser.app ").unwrap(), "jeser.app");
        assert!(normalize_apex("localhost").is_err());
    }

    #[test]
    fn keeps_host_already_on_the_zone() {
        assert_eq!(
            url_for_zone(
                "https://popcornn-server.jeser.app",
                "popcorn-server",
                "jeser.app"
            ),
            "https://popcornn-server.jeser.app"
        );
        assert_eq!(
            url_for_zone(
                "https://popcornn-server.jeser.app",
                "popcorn-server",
                "popcornn.app"
            ),
            "https://popcorn-server.popcornn.app"
        );
        assert_eq!(
            url_for_zone("", "client", "popcornn.app"),
            "https://client.popcornn.app"
        );
    }
}
