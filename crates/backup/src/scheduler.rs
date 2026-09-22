use crate::InstanceBackupService;
use devforge_shared::Result;
use devforge_storage::StorageFacade;
use serde_json::Value;
use sqlx::PgPool;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::time::{sleep, Duration};

#[derive(Debug, Clone)]
pub struct BackupSchedulerConfig {
    pub enabled: bool,
    pub interval_hours: u32,
    pub retention_count: usize,
}

pub struct BackupScheduler {
    pool: PgPool,
    storage: Arc<StorageFacade>,
    db_path: PathBuf,
}

impl BackupScheduler {
    pub fn new(pool: PgPool, storage: Arc<StorageFacade>, db_path: PathBuf) -> Self {
        Self {
            pool,
            storage,
            db_path,
        }
    }

    async fn load_config(&self) -> BackupSchedulerConfig {
        let row: Option<(i64, i64, i64)> = sqlx::query_as(
            r#"SELECT backup_auto_enabled, backup_auto_interval_hours, backup_auto_retention_count
               FROM instance_settings WHERE id = 1"#,
        )
        .fetch_optional(&self.pool)
        .await
        .ok()
        .flatten();

        match row {
            Some((enabled, interval, retention)) => BackupSchedulerConfig {
                enabled: enabled != 0,
                interval_hours: interval.max(1) as u32,
                retention_count: retention.max(1) as usize,
            },
            None => BackupSchedulerConfig {
                enabled: true,
                interval_hours: 24,
                retention_count: 7,
            },
        }
    }

    async fn record_backup(&self, backup: &Value) -> Result<()> {
        if let Some(backup_obj) = backup.get("backup") {
            let id = backup_obj
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let key = backup_obj
                .get("storage_key")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let size = backup_obj
                .get("size_bytes")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as i64;
            let message = backup_obj
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let created = backup_obj
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
            .execute(&self.pool)
            .await;
        }
        Ok(())
    }

    pub async fn run_once<F, Fut>(&self, dump: F) -> Result<()>
    where
        F: Fn() -> Fut,
        Fut: std::future::Future<Output = std::result::Result<Vec<u8>, String>>,
    {
        let config = self.load_config().await;
        if !config.enabled {
            tracing::debug!("backups automatiques désactivés");
            return Ok(());
        }

        tracing::info!(
            interval_hours = config.interval_hours,
            retention = config.retention_count,
            "lancement backup automatique"
        );

        let svc = InstanceBackupService::new(self.storage.clone(), self.db_path.clone());
        let bytes = match dump().await {
            Ok(bytes) => bytes,
            Err(e) => {
                tracing::error!(error = %e, "échec dump Postgres");
                return Ok(());
            }
        };

        match svc.create_from_bytes(bytes).await {
            Ok(result) => {
                tracing::info!("backup automatique créé avec succès");
                let _ = self.record_backup(&result).await;
            }
            Err(e) => {
                tracing::error!(error = %e, "échec backup automatique");
            }
        }

        match svc.prune(config.retention_count).await {
            Ok(result) => {
                tracing::info!(
                    result = %serde_json::to_string(&result).unwrap_or_default(),
                    "nettoyage backups terminé"
                );
            }
            Err(e) => {
                tracing::warn!(error = %e, "échec nettoyage backups");
            }
        }

        Ok(())
    }

    pub async fn run_loop<F, Fut>(self: Arc<Self>, dump: F)
    where
        F: Fn() -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = std::result::Result<Vec<u8>, String>> + Send,
    {
        tracing::info!("démarrage scheduler backups instance");

        loop {
            let config = self.load_config().await;
            if !config.enabled {
                tracing::debug!("backups automatiques désactivés, attente 1h");
                sleep(Duration::from_secs(3600)).await;
                continue;
            }

            if let Err(e) = self.run_once(&dump).await {
                tracing::error!(error = %e, "erreur cycle backup automatique");
            }

            let interval = Duration::from_secs((config.interval_hours as u64) * 3600);
            tracing::info!(next_run_hours = config.interval_hours, "prochain backup automatique dans {interval:?}");
            sleep(interval).await;
        }
    }
}
