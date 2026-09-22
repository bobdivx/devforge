//! Instance S3 backup config + platform DB backup/restore (UX-driven).

use axum::{
    extract::State,
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use devforge_backup::InstanceBackupService;
use devforge_storage::S3Config;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::FromRow;

use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/api/v1/settings/backup-s3",
            get(get_backup_s3).put(put_backup_s3),
        )
        .route("/api/v1/settings/backup-s3/test", post(test_backup_s3))
        .route(
            "/api/v1/settings/backup-auto",
            get(get_backup_auto).put(put_backup_auto),
        )
        .route("/api/v1/settings/postgres", get(get_postgres_status))
        .route(
            "/api/v1/instance/backups",
            get(list_instance_backups).post(create_instance_backup),
        )
        .route("/api/v1/instance/backups/local", get(list_local_backups))
        .route("/api/v1/instance/backups/remote", post(list_remote_backups))
        .route(
            "/api/v1/instance/backups/restore",
            post(restore_instance_backup),
        )
}

async fn require_admin(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<(), (axum::http::StatusCode, Json<Value>)> {
    let (user, _) = crate::auth_routes::current_workspace(state, headers).await?;
    if user.role != "instance_admin" {
        return Err((
            axum::http::StatusCode::FORBIDDEN,
            Json(json!({"error": "admin requis"})),
        ));
    }
    Ok(())
}

fn err_map(e: impl ToString) -> (axum::http::StatusCode, Json<Value>) {
    (
        axum::http::StatusCode::BAD_REQUEST,
        Json(json!({"error": e.to_string()})),
    )
}

#[derive(FromRow)]
struct S3Row {
    backup_s3_enabled: i64,
    backup_s3_name: String,
    backup_s3_key: String,
    backup_s3_secret: String,
    backup_s3_bucket: String,
    backup_s3_region: String,
    backup_s3_endpoint: String,
}

impl S3Row {
    fn to_config(&self) -> S3Config {
        S3Config {
            enabled: self.backup_s3_enabled != 0,
            name: self.backup_s3_name.clone(),
            key: self.backup_s3_key.clone(),
            secret: self.backup_s3_secret.clone(),
            bucket: self.backup_s3_bucket.clone(),
            region: self.backup_s3_region.clone(),
            endpoint: self.backup_s3_endpoint.clone(),
        }
    }
}

pub async fn load_s3_config(pool: &sqlx::PgPool) -> S3Config {
    let row: Option<S3Row> = sqlx::query_as(
        r#"SELECT backup_s3_enabled, backup_s3_name, backup_s3_key, backup_s3_secret,
                  backup_s3_bucket, backup_s3_region, backup_s3_endpoint
           FROM instance_settings WHERE id = 1"#,
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    row.map(|r| r.to_config()).unwrap_or_default()
}

async fn get_backup_s3(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let cfg = load_s3_config(&state.pool).await;
    Ok(Json(json!({
        "ok": true,
        "config": {
            "enabled": cfg.enabled,
            "name": cfg.name,
            "key_set": !cfg.key.trim().is_empty(),
            "key_masked": if cfg.key.trim().is_empty() { Value::Null } else { json!(cfg.masked_key()) },
            "secret_set": !cfg.secret.trim().is_empty(),
            "bucket": cfg.bucket,
            "region": cfg.region,
            "endpoint": cfg.endpoint,
            "ready": cfg.is_ready(),
        },
        "mode": state.storage.mode().await,
    })))
}

#[derive(Deserialize)]
pub struct PutBackupS3Body {
    pub enabled: Option<bool>,
    pub name: Option<String>,
    pub key: Option<String>,
    pub secret: Option<String>,
    pub bucket: Option<String>,
    pub region: Option<String>,
    pub endpoint: Option<String>,
    /// If true, test connection before saving.
    pub test: Option<bool>,
}

async fn put_backup_s3(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PutBackupS3Body>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let current = load_s3_config(&state.pool).await;

    let mut cfg = current.clone();
    if let Some(v) = body.enabled {
        cfg.enabled = v;
    }
    if let Some(v) = body.name {
        cfg.name = v;
    }
    if let Some(v) = body.key {
        if !v.trim().is_empty() {
            cfg.key = v.trim().to_string();
        }
    }
    if let Some(v) = body.secret {
        if !v.trim().is_empty() {
            cfg.secret = v.trim().to_string();
        }
    }
    if let Some(v) = body.bucket {
        cfg.bucket = v.trim().to_string();
    }
    if let Some(v) = body.region {
        cfg.region = v.trim().to_string();
    }
    if let Some(v) = body.endpoint {
        cfg.endpoint = v.trim().to_string();
    }

    let do_test = body.test.unwrap_or(true);
    if cfg.enabled && do_test {
        state
            .storage
            .configure(cfg.clone())
            .await
            .map_err(err_map)?;
    } else if cfg.enabled {
        state.storage.apply_config_unchecked(cfg.clone()).await;
    } else {
        state
            .storage
            .configure(cfg.clone())
            .await
            .map_err(err_map)?;
    }

    let now = Utc::now().to_rfc3339();
    sqlx::query(
        r#"UPDATE instance_settings SET
            backup_s3_enabled = $1,
            backup_s3_name = $2,
            backup_s3_key = $3,
            backup_s3_secret = $4,
            backup_s3_bucket = $5,
            backup_s3_region = $6,
            backup_s3_endpoint = $7,
            updated_at = $8
         WHERE id = 1"#,
    )
    .bind(if cfg.enabled { 1 } else { 0 })
    .bind(&cfg.name)
    .bind(&cfg.key)
    .bind(&cfg.secret)
    .bind(&cfg.bucket)
    .bind(&cfg.region)
    .bind(&cfg.endpoint)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(|e| err_map(e))?;

    state.backends.set_storage_mode(state.storage.mode().await);

    Ok(Json(json!({
        "ok": true,
        "config": {
            "enabled": cfg.enabled,
            "name": cfg.name,
            "key_set": !cfg.key.trim().is_empty(),
            "key_masked": if cfg.key.trim().is_empty() { Value::Null } else { json!(cfg.masked_key()) },
            "secret_set": !cfg.secret.trim().is_empty(),
            "bucket": cfg.bucket,
            "region": cfg.region,
            "endpoint": cfg.endpoint,
            "ready": cfg.is_ready(),
        },
        "mode": state.storage.mode().await,
    })))
}

#[derive(Deserialize)]
pub struct TestBackupS3Body {
    pub enabled: Option<bool>,
    pub name: Option<String>,
    pub key: Option<String>,
    pub secret: Option<String>,
    pub bucket: Option<String>,
    pub region: Option<String>,
    pub endpoint: Option<String>,
}

async fn test_backup_s3(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<TestBackupS3Body>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let current = load_s3_config(&state.pool).await;
    let mut cfg = current;
    if let Some(v) = body.key {
        if !v.trim().is_empty() {
            cfg.key = v.trim().to_string();
        }
    }
    if let Some(v) = body.secret {
        if !v.trim().is_empty() {
            cfg.secret = v.trim().to_string();
        }
    }
    if let Some(v) = body.bucket {
        cfg.bucket = v.trim().to_string();
    }
    if let Some(v) = body.region {
        cfg.region = v.trim().to_string();
    }
    if let Some(v) = body.endpoint {
        cfg.endpoint = v.trim().to_string();
    }
    cfg.enabled = true;
    let _ = body.enabled;
    let _ = body.name;
    state.storage.test(Some(cfg)).await.map_err(err_map)?;
    Ok(Json(json!({ "ok": true, "message": "Connexion S3 OK" })))
}

#[derive(FromRow)]
struct BackupRow {
    id: String,
    storage_key: String,
    size_bytes: i64,
    status: String,
    message: String,
    created_at: String,
}

async fn list_instance_backups(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let rows: Vec<BackupRow> = sqlx::query_as(
        "SELECT id, storage_key, size_bytes, status, message, created_at FROM instance_backups ORDER BY created_at DESC LIMIT 50",
    )
    .fetch_all(&state.pool)
    .await
    .map_err(err_map)?;
    Ok(Json(json!({
        "ok": true,
        "backups": rows.iter().map(|r| json!({
            "id": r.id,
            "storage_key": r.storage_key,
            "size_bytes": r.size_bytes,
            "status": r.status,
            "message": r.message,
            "created_at": r.created_at,
        })).collect::<Vec<_>>(),
        "mode": state.storage.mode().await,
        "ready": load_s3_config(&state.pool).await.is_ready(),
    })))
}

async fn create_instance_backup(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let bytes = crate::control_pg::dump_snapshot().await.map_err(err_map)?;
    let svc = InstanceBackupService::new(state.storage.clone(), state.db_path.clone());
    let result = svc.create_from_bytes(bytes).await.map_err(err_map)?;
    if let Some(backup) = result.get("backup") {
        let id = backup
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        let key = backup
            .get("storage_key")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let size = backup
            .get("size_bytes")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as i64;
        let message = backup.get("message").and_then(|v| v.as_str()).unwrap_or("");
        let created = backup
            .get("created_at")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let _ = sqlx::query(
            "INSERT INTO instance_backups (id, storage_key, size_bytes, status, message, created_at) VALUES ($1, $2, $3, 'completed', $4, $5)",
        )
        .bind(id)
        .bind(key)
        .bind(size)
        .bind(message)
        .bind(created)
        .execute(&state.pool)
        .await;
    }
    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct RemoteListBody {
    pub key: Option<String>,
    pub secret: Option<String>,
    pub bucket: Option<String>,
    pub region: Option<String>,
    pub endpoint: Option<String>,
    /// Use one-shot credentials (disaster recovery) instead of saved config.
    pub use_inline: Option<bool>,
}

async fn list_remote_backups(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RemoteListBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let svc = InstanceBackupService::new(state.storage.clone(), state.db_path.clone());
    let override_cfg = if body.use_inline.unwrap_or(false) {
        Some(S3Config {
            enabled: true,
            name: "recovery".into(),
            key: body.key.unwrap_or_default(),
            secret: body.secret.unwrap_or_default(),
            bucket: body.bucket.unwrap_or_default(),
            region: body.region.unwrap_or_else(|| "fr-par".into()),
            endpoint: body.endpoint.unwrap_or_default(),
        })
    } else {
        None
    };
    Ok(Json(svc.list_remote(override_cfg).await.map_err(err_map)?))
}

#[derive(Deserialize)]
pub struct RestoreBody {
    pub storage_key: String,
    pub key: Option<String>,
    pub secret: Option<String>,
    pub bucket: Option<String>,
    pub region: Option<String>,
    pub endpoint: Option<String>,
    pub use_inline: Option<bool>,
}

async fn restore_instance_backup(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<RestoreBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    if body.storage_key.trim().is_empty() {
        return Err(err_map("storage_key requis"));
    }
    let svc = InstanceBackupService::new(state.storage.clone(), state.db_path.clone());
    let override_cfg = if body.use_inline.unwrap_or(false) {
        Some(S3Config {
            enabled: true,
            name: "recovery".into(),
            key: body.key.unwrap_or_default(),
            secret: body.secret.unwrap_or_default(),
            bucket: body.bucket.unwrap_or_default(),
            region: body.region.unwrap_or_else(|| "fr-par".into()),
            endpoint: body.endpoint.unwrap_or_default(),
        })
    } else {
        None
    };
    Ok(Json(
        svc.restore(body.storage_key.trim(), override_cfg)
            .await
            .map_err(err_map)?,
    ))
}

async fn list_local_backups(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let svc = InstanceBackupService::new(state.storage.clone(), state.db_path.clone());
    let backups = svc.list_local().await.map_err(err_map)?;
    Ok(Json(json!({
        "ok": true,
        "backups": backups,
    })))
}

async fn get_postgres_status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    Ok(Json(json!({
        "ok": true,
        "postgres": crate::control_pg::admin_status().await,
    })))
}

async fn get_backup_auto(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;
    let row: Option<(i64, i64, i64)> = sqlx::query_as(
        r#"SELECT backup_auto_enabled, backup_auto_interval_hours, backup_auto_retention_count
           FROM instance_settings WHERE id = 1"#,
    )
    .fetch_optional(&state.pool)
    .await
    .map_err(err_map)?;

    let (enabled, interval, retention) = row.unwrap_or((1, 24, 7));
    Ok(Json(json!({
        "ok": true,
        "config": {
            "enabled": enabled != 0,
            "interval_hours": interval,
            "retention_count": retention,
        }
    })))
}

#[derive(Deserialize)]
pub struct PutBackupAutoBody {
    pub enabled: Option<bool>,
    pub interval_hours: Option<i64>,
    pub retention_count: Option<i64>,
}

async fn put_backup_auto(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PutBackupAutoBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    require_admin(&state, &headers).await?;

    let row: Option<(i64, i64, i64)> = sqlx::query_as(
        r#"SELECT backup_auto_enabled, backup_auto_interval_hours, backup_auto_retention_count
           FROM instance_settings WHERE id = 1"#,
    )
    .fetch_optional(&state.pool)
    .await
    .map_err(err_map)?;

    let (mut enabled, mut interval, mut retention) = row.unwrap_or((1, 24, 7));

    if let Some(v) = body.enabled {
        enabled = if v { 1 } else { 0 };
    }
    if let Some(v) = body.interval_hours {
        interval = v.max(1);
    }
    if let Some(v) = body.retention_count {
        retention = v.max(1);
    }

    let now = Utc::now().to_rfc3339();
    sqlx::query(
        r#"UPDATE instance_settings SET
            backup_auto_enabled = $1,
            backup_auto_interval_hours = $2,
            backup_auto_retention_count = $3,
            updated_at = $4
         WHERE id = 1"#,
    )
    .bind(enabled)
    .bind(interval)
    .bind(retention)
    .bind(&now)
    .execute(&state.pool)
    .await
    .map_err(err_map)?;

    Ok(Json(json!({
        "ok": true,
        "config": {
            "enabled": enabled != 0,
            "interval_hours": interval,
            "retention_count": retention,
        }
    })))
}
