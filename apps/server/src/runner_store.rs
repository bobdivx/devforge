//! SQLite persistence for managed GitHub runners.

use async_trait::async_trait;
use devforge_runner::{
    decode_extra_env, decode_volumes, encode_extra_env, encode_volumes, ManagedRunner, RunnerStore,
};
use devforge_shared::{DevForgeError, Result as DfResult};
use sqlx::{FromRow, SqlitePool};

pub struct SqliteRunnerStore {
    pub pool: SqlitePool,
}

#[derive(FromRow)]
struct RunnerRow {
    id: String,
    server_id: String,
    container_name: String,
    runner_name: String,
    owner: String,
    repo: String,
    repo_url: String,
    image: String,
    labels: String,
    network_mode: String,
    timezone: String,
    replace_existing: i64,
    pull_image: i64,
    volumes_json: String,
    extra_env_json: String,
    auth_mode: String,
    enabled: i64,
    project_uuid: Option<String>,
    live_state: String,
    live_status: String,
    container_id: Option<String>,
    github_status: Option<String>,
    github_busy: Option<i64>,
    github_runner_id: Option<i64>,
    last_synced_at: Option<String>,
    last_error: Option<String>,
    op_status: String,
    created_at: String,
    updated_at: String,
}

impl From<RunnerRow> for ManagedRunner {
    fn from(r: RunnerRow) -> Self {
        ManagedRunner {
            id: r.id,
            server_id: r.server_id,
            container_name: r.container_name,
            runner_name: r.runner_name,
            owner: r.owner,
            repo: r.repo,
            repo_url: r.repo_url,
            image: r.image,
            labels: r.labels,
            network_mode: r.network_mode,
            timezone: r.timezone,
            replace_existing: r.replace_existing != 0,
            pull_image: r.pull_image != 0,
            volumes: decode_volumes(&r.volumes_json),
            extra_env: decode_extra_env(&r.extra_env_json),
            auth_mode: r.auth_mode,
            enabled: r.enabled != 0,
            project_uuid: r.project_uuid,
            live_state: r.live_state,
            live_status: r.live_status,
            container_id: r.container_id,
            github_status: r.github_status,
            github_busy: r.github_busy.map(|b| b != 0),
            github_runner_id: r.github_runner_id,
            last_synced_at: r.last_synced_at,
            last_error: r.last_error,
            op_status: r.op_status,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

const SELECT_COLS: &str = r#"id, server_id, container_name, runner_name, owner, repo, repo_url,
            image, labels, network_mode, timezone, replace_existing, pull_image,
            volumes_json, extra_env_json, auth_mode, enabled, project_uuid,
            live_state, live_status, container_id, github_status, github_busy,
            github_runner_id, last_synced_at, last_error, op_status, created_at, updated_at"#;

#[async_trait]
impl RunnerStore for SqliteRunnerStore {
    async fn list(&self) -> DfResult<Vec<ManagedRunner>> {
        let rows: Vec<RunnerRow> = sqlx::query_as(&format!(
            "SELECT {SELECT_COLS} FROM managed_runners ORDER BY runner_name"
        ))
        .fetch_all(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(rows.into_iter().map(ManagedRunner::from).collect())
    }

    async fn get(&self, id: &str) -> DfResult<Option<ManagedRunner>> {
        let row: Option<RunnerRow> = sqlx::query_as(&format!(
            "SELECT {SELECT_COLS} FROM managed_runners WHERE id = ?"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(row.map(ManagedRunner::from))
    }

    async fn get_by_container(
        &self,
        server_id: &str,
        container_name: &str,
    ) -> DfResult<Option<ManagedRunner>> {
        let row: Option<RunnerRow> = sqlx::query_as(&format!(
            "SELECT {SELECT_COLS} FROM managed_runners WHERE server_id = ? AND container_name = ?"
        ))
        .bind(server_id)
        .bind(container_name)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(row.map(ManagedRunner::from))
    }

    async fn upsert(&self, runner: &ManagedRunner) -> DfResult<()> {
        sqlx::query(
            r#"INSERT INTO managed_runners (
                id, server_id, container_name, runner_name, owner, repo, repo_url,
                image, labels, network_mode, timezone, replace_existing, pull_image,
                volumes_json, extra_env_json, auth_mode, enabled, project_uuid,
                live_state, live_status, container_id, github_status, github_busy,
                github_runner_id, last_synced_at, last_error, op_status, created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
                server_id=excluded.server_id,
                container_name=excluded.container_name,
                runner_name=excluded.runner_name,
                owner=excluded.owner,
                repo=excluded.repo,
                repo_url=excluded.repo_url,
                image=excluded.image,
                labels=excluded.labels,
                network_mode=excluded.network_mode,
                timezone=excluded.timezone,
                replace_existing=excluded.replace_existing,
                pull_image=excluded.pull_image,
                volumes_json=excluded.volumes_json,
                extra_env_json=excluded.extra_env_json,
                auth_mode=excluded.auth_mode,
                enabled=excluded.enabled,
                project_uuid=excluded.project_uuid,
                live_state=excluded.live_state,
                live_status=excluded.live_status,
                container_id=excluded.container_id,
                github_status=excluded.github_status,
                github_busy=excluded.github_busy,
                github_runner_id=excluded.github_runner_id,
                last_synced_at=excluded.last_synced_at,
                last_error=excluded.last_error,
                op_status=excluded.op_status,
                updated_at=excluded.updated_at
            "#,
        )
        .bind(&runner.id)
        .bind(&runner.server_id)
        .bind(&runner.container_name)
        .bind(&runner.runner_name)
        .bind(&runner.owner)
        .bind(&runner.repo)
        .bind(&runner.repo_url)
        .bind(&runner.image)
        .bind(&runner.labels)
        .bind(&runner.network_mode)
        .bind(&runner.timezone)
        .bind(if runner.replace_existing { 1i64 } else { 0 })
        .bind(if runner.pull_image { 1i64 } else { 0 })
        .bind(encode_volumes(&runner.volumes))
        .bind(encode_extra_env(&runner.extra_env))
        .bind(&runner.auth_mode)
        .bind(if runner.enabled { 1i64 } else { 0 })
        .bind(&runner.project_uuid)
        .bind(&runner.live_state)
        .bind(&runner.live_status)
        .bind(&runner.container_id)
        .bind(&runner.github_status)
        .bind(runner.github_busy.map(|b| if b { 1i64 } else { 0 }))
        .bind(runner.github_runner_id)
        .bind(&runner.last_synced_at)
        .bind(&runner.last_error)
        .bind(&runner.op_status)
        .bind(&runner.created_at)
        .bind(&runner.updated_at)
        .execute(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(())
    }

    async fn delete(&self, id: &str) -> DfResult<bool> {
        let res = sqlx::query("DELETE FROM managed_runners WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(res.rows_affected() > 0)
    }

    async fn update_live(
        &self,
        id: &str,
        live_state: &str,
        live_status: &str,
        container_id: Option<&str>,
        github_status: Option<&str>,
        github_busy: Option<bool>,
        github_runner_id: Option<i64>,
        last_synced_at: &str,
        last_error: Option<&str>,
    ) -> DfResult<()> {
        sqlx::query(
            r#"UPDATE managed_runners SET
                live_state = ?, live_status = ?, container_id = ?,
                github_status = ?, github_busy = ?, github_runner_id = ?,
                last_synced_at = ?, last_error = ?, updated_at = ?
               WHERE id = ?"#,
        )
        .bind(live_state)
        .bind(live_status)
        .bind(container_id)
        .bind(github_status)
        .bind(github_busy.map(|b| if b { 1i64 } else { 0 }))
        .bind(github_runner_id)
        .bind(last_synced_at)
        .bind(last_error)
        .bind(last_synced_at)
        .bind(id)
        .execute(&self.pool)
        .await
        .map_err(|e| DevForgeError::Message(e.to_string()))?;
        Ok(())
    }

    async fn set_op_status(
        &self,
        id: &str,
        op_status: &str,
        last_error: Option<&str>,
    ) -> DfResult<()> {
        let now = chrono::Utc::now().to_rfc3339();
        if let Some(err) = last_error {
            sqlx::query(
                "UPDATE managed_runners SET op_status = ?, last_error = ?, updated_at = ? WHERE id = ?",
            )
            .bind(op_status)
            .bind(err)
            .bind(&now)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| DevForgeError::Message(e.to_string()))?;
        } else if op_status == "idle" {
            sqlx::query(
                "UPDATE managed_runners SET op_status = ?, last_error = NULL, updated_at = ? WHERE id = ?",
            )
            .bind(op_status)
            .bind(&now)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| DevForgeError::Message(e.to_string()))?;
        } else {
            sqlx::query(
                "UPDATE managed_runners SET op_status = ?, updated_at = ? WHERE id = ?",
            )
            .bind(op_status)
            .bind(&now)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| DevForgeError::Message(e.to_string()))?;
        }
        Ok(())
    }
}
