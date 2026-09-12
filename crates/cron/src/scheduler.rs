use crate::service::CronService;
use devforge_deploy::RemoteExecutor;
use sqlx::SqlitePool;
use std::sync::Arc;
use tokio::time::{sleep, Duration};
use tracing::{error, info, warn};

pub struct CronScheduler {
    service: Arc<CronService>,
    executor: Arc<dyn RemoteExecutor>,
    pool: SqlitePool,
}

impl CronScheduler {
    pub fn new(pool: SqlitePool, executor: Arc<dyn RemoteExecutor>) -> Self {
        let service = Arc::new(CronService::new(pool.clone()));
        Self {
            service,
            executor,
            pool,
        }
    }

    /// Boucle principale : évalue les crons dus toutes les minutes.
    pub async fn run_loop(self: Arc<Self>) {
        info!("Démarrage du scheduler cron projets");

        loop {
            if let Err(e) = self.tick().await {
                error!(error = %e, "Erreur cycle scheduler cron");
            }
            sleep(Duration::from_secs(60)).await;
        }
    }

    /// Évalue et exécute tous les crons dus.
    async fn tick(&self) -> devforge_shared::Result<()> {
        let due = self.service.get_due_crons().await?;

        if due.is_empty() {
            return Ok(());
        }

        info!(count = due.len(), "Crons dus détectés");

        for cron in due {
            if let Err(e) = self.run_cron(&cron).await {
                error!(
                    cron_id = %cron.id,
                    cron_name = %cron.name,
                    error = %e,
                    "Échec exécution cron"
                );
            }
        }

        Ok(())
    }

    /// Exécute un cron par ID (pour run_now manuel).
    pub async fn run_cron_by_id(&self, cron_id: &str) -> devforge_shared::Result<()> {
        let cron = self
            .service
            .get(cron_id)
            .await?
            .ok_or_else(|| devforge_shared::DevForgeError::Message("cron introuvable".into()))?;
        self.run_cron(&cron).await
    }

    /// Exécute un cron : docker exec dans le conteneur du projet.
    async fn run_cron(&self, cron: &crate::models::ProjectCron) -> devforge_shared::Result<()> {
        info!(
            cron_id = %cron.id,
            cron_name = %cron.name,
            project = %cron.project_uuid,
            "Exécution cron"
        );

        let run_id = self.service.record_run_start(cron).await?;

        // Récupère le nom du conteneur du projet.
        let container_name = self.get_project_container_name(&cron.project_uuid).await?;

        if container_name.is_empty() {
            let msg = "Conteneur introuvable ou projet non déployé";
            warn!(project = %cron.project_uuid, msg);
            self.service
                .record_run_finish(&run_id, "failed", Some(msg), None)
                .await?;
            self.service
                .update_cron_status(&cron.id, "failed", self.compute_next_run(cron).as_deref())
                .await?;
            return Ok(());
        }

        // Commande docker exec.
        let cmd = format!(
            "docker exec {} sh -c {}",
            shell_escape(&container_name),
            shell_escape(&cron.command)
        );

        let server_id = self.get_server_id(&cron.project_uuid).await?;
        let result = self.executor.exec(&server_id, "", &cmd, 300).await;

        let (status, output, exit_code) = match result {
            Ok(r) => {
                let status = if r.ok { "success" } else { "failed" };
                (status, r.output, Some(r.exit_code as i64))
            }
            Err(e) => ("failed", e.to_string(), None),
        };

        self.service
            .record_run_finish(&run_id, status, Some(&output), exit_code)
            .await?;

        self.service
            .update_cron_status(&cron.id, status, self.compute_next_run(cron).as_deref())
            .await?;

        info!(
            cron_id = %cron.id,
            status,
            "Exécution cron terminée"
        );

        Ok(())
    }

    async fn get_project_container_name(&self, project_uuid: &str) -> devforge_shared::Result<String> {
        let row: Option<(String,)> = sqlx::query_as(
            "SELECT slug FROM projects WHERE uuid = ?",
        )
        .bind(project_uuid)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        match row {
            Some((slug,)) => Ok(format!("df-{}", slug)),
            None => Ok(String::new()),
        }
    }

    async fn get_server_id(&self, project_uuid: &str) -> devforge_shared::Result<String> {
        let row: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT server_id FROM projects WHERE uuid = ?",
        )
        .bind(project_uuid)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        Ok(row
            .and_then(|(s,)| s)
            .unwrap_or_else(|| "default".into()))
    }

    fn compute_next_run(&self, cron: &crate::models::ProjectCron) -> Option<String> {
        crate::models::next_run_time(&cron.cron_expression, cron.timezone.as_deref())
            .map(|dt| dt.to_rfc3339())
    }
}

fn shell_escape(s: &str) -> String {
    if s.chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | ':' | '='))
    {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}
