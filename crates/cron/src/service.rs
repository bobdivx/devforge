use crate::models::*;
use devforge_shared::Result;
use sqlx::PgPool;

pub struct CronService {
    pool: PgPool,
}

impl CronService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list(&self, project_uuid: &str) -> Result<Vec<ProjectCron>> {
        let rows = sqlx::query_as::<_, ProjectCron>(
            "SELECT * FROM project_crons WHERE project_uuid = $1 ORDER BY name",
        )
        .bind(project_uuid)
        .fetch_all(&self.pool)
        .await
            .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;
        Ok(rows)
    }

    pub async fn get(&self, id: &str) -> Result<Option<ProjectCron>> {
        let row = sqlx::query_as::<_, ProjectCron>("SELECT * FROM project_crons WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;
        Ok(row)
    }

    pub async fn create(
        &self,
        project_uuid: &str,
        req: CreateCronRequest,
    ) -> Result<ProjectCron> {
        validate_cron_expression(&req.cron_expression)
            .map_err(|e| devforge_shared::DevForgeError::Message(e))?;

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let enabled = if req.enabled.unwrap_or(true) { 1 } else { 0 };
        let next = next_run_time(&req.cron_expression, req.timezone.as_deref())
            .map(|dt| dt.to_rfc3339());

        sqlx::query(
            r#"INSERT INTO project_crons (
                id, project_uuid, name, cron_expression, command, enabled, timezone,
                last_status, last_run_at, next_run_at, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, $8, $9, $10)"#,
        )
        .bind(&id)
        .bind(project_uuid)
        .bind(&req.name)
        .bind(&req.cron_expression)
        .bind(&req.command)
        .bind(enabled)
        .bind(&req.timezone)
        .bind(&next)
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
            .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        let cron = self
            .get(&id)
            .await?
            .ok_or_else(|| devforge_shared::DevForgeError::Message("cron non trouvé après création".into()))?;
        Ok(cron)
    }

    pub async fn update(&self, id: &str, req: UpdateCronRequest) -> Result<ProjectCron> {
        let existing = self
            .get(id)
            .await?
            .ok_or_else(|| devforge_shared::DevForgeError::Message("cron introuvable".into()))?;

        let name = req.name.unwrap_or(existing.name);
        let cron_expression = req.cron_expression.unwrap_or(existing.cron_expression);
        let command = req.command.unwrap_or(existing.command);
        let timezone = req.timezone.or(existing.timezone);

        validate_cron_expression(&cron_expression)
            .map_err(|e| devforge_shared::DevForgeError::Message(e))?;

        let enabled = match req.enabled {
            Some(true) => 1,
            Some(false) => 0,
            None => existing.enabled,
        };

        let next = next_run_time(&cron_expression, timezone.as_deref()).map(|dt| dt.to_rfc3339());
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            r#"UPDATE project_crons SET
                name = $1, cron_expression = $2, command = $3, enabled = $4, timezone = $5,
                next_run_at = $6, updated_at = $7
            WHERE id = $8"#,
        )
        .bind(&name)
        .bind(&cron_expression)
        .bind(&command)
        .bind(enabled)
        .bind(&timezone)
        .bind(&next)
        .bind(&now)
        .bind(id)
        .execute(&self.pool)
        .await
            .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        let cron = self
            .get(id)
            .await?
            .ok_or_else(|| devforge_shared::DevForgeError::Message("cron introuvable après mise à jour".into()))?;
        Ok(cron)
    }

    pub async fn delete(&self, id: &str) -> Result<bool> {
        sqlx::query("DELETE FROM project_cron_runs WHERE cron_id = $1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        let res = sqlx::query("DELETE FROM project_crons WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        Ok(res.rows_affected() > 0)
    }

    pub async fn set_enabled(&self, id: &str, enabled: bool) -> Result<ProjectCron> {
        let now = chrono::Utc::now().to_rfc3339();
        let val = if enabled { 1 } else { 0 };

        sqlx::query("UPDATE project_crons SET enabled = $1, updated_at = $2 WHERE id = $3")
            .bind(val)
            .bind(&now)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        let cron = self
            .get(id)
            .await?
            .ok_or_else(|| devforge_shared::DevForgeError::Message("cron introuvable".into()))?;
        Ok(cron)
    }

    pub async fn list_runs(&self, cron_id: &str, limit: i64) -> Result<Vec<CronRun>> {
        let rows = sqlx::query_as::<_, CronRun>(
            "SELECT * FROM project_cron_runs WHERE cron_id = $1 ORDER BY started_at DESC LIMIT $2",
        )
        .bind(cron_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
            .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;
        Ok(rows)
    }

    pub async fn record_run_start(&self, cron: &ProjectCron) -> Result<String> {
        let run_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            r#"INSERT INTO project_cron_runs (
                id, cron_id, project_uuid, status, output, exit_code, started_at, finished_at
            ) VALUES ($1, $2, $3, 'running', NULL, NULL, $4, NULL)"#,
        )
        .bind(&run_id)
        .bind(&cron.id)
        .bind(&cron.project_uuid)
        .bind(&now)
        .execute(&self.pool)
        .await
            .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        Ok(run_id)
    }

    pub async fn record_run_finish(
        &self,
        run_id: &str,
        status: &str,
        output: Option<&str>,
        exit_code: Option<i64>,
    ) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            r#"UPDATE project_cron_runs SET
                status = $1, output = $2, exit_code = $3, finished_at = $4
            WHERE id = $5"#,
        )
        .bind(status)
        .bind(output)
        .bind(exit_code)
        .bind(&now)
        .bind(run_id)
        .execute(&self.pool)
        .await
            .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        Ok(())
    }

    pub async fn update_cron_status(
        &self,
        cron_id: &str,
        status: &str,
        next_run: Option<&str>,
    ) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();

        sqlx::query(
            r#"UPDATE project_crons SET
                last_status = $1, last_run_at = $2, next_run_at = $3, updated_at = $4
            WHERE id = $5"#,
        )
        .bind(status)
        .bind(&now)
        .bind(next_run)
        .bind(&now)
        .bind(cron_id)
        .execute(&self.pool)
        .await
            .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        Ok(())
    }

    pub async fn get_due_crons(&self) -> Result<Vec<ProjectCron>> {
        let now = chrono::Utc::now().to_rfc3339();

        let rows = sqlx::query_as::<_, ProjectCron>(
            r#"SELECT * FROM project_crons 
               WHERE enabled = 1 
               AND (next_run_at IS NULL OR next_run_at <= $1)
               ORDER BY next_run_at"#,
        )
        .bind(&now)
        .fetch_all(&self.pool)
        .await
            .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        Ok(rows)
    }
}
