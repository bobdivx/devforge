use async_trait::async_trait;
use chrono::{DateTime, Utc};
use devforge_agent::{build_core_registry, AgentRunner, ProjectStore, ToolRegistry};
use devforge_backup::{BackupFacade, InstanceBackupService, MemoryBackupStore};
use devforge_cluster::{ClusterAwareExecutor, ClusterFacade, ClusterStore};
use devforge_database::DatabaseFacade;
use devforge_deploy::{executor_from_env, DeployFacade};
use devforge_domain::DomainFacade;
use devforge_env::{EnvFacade, EnvStore, EnvVar, MemoryEnvStore};
use devforge_github::{
    client_from_env, client_from_token, GitHubClient, GitHubFacade, HttpGitHubClient,
};
use devforge_mcp::McpFacade;
use devforge_ports::PortsFacade;
use devforge_proxy::ProxyFacade;
use devforge_runner::RunnerFacade;
use devforge_shared::{ProjectTestContext, Result as DfResult};
use devforge_storage::StorageFacade;
use devforge_update::UpdateFacade;
use devforge_wireguard::WireguardFacade;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{postgres::PgPoolOptions, FromRow, PgPool};
use std::path::PathBuf;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    /// Filesystem path of the SQLite DB (for instance backup/restore).
    pub db_path: std::path::PathBuf,
    pub registry: Arc<ToolRegistry>,
    pub agent: Arc<AgentRunner>,
    pub databases: Arc<DatabaseFacade>,
    pub mcp: Arc<McpFacade>,
    pub env: Arc<EnvFacade>,
    pub deploy: Arc<DeployFacade>,
    pub github: Arc<GitHubFacade>,
    pub ports: Arc<PortsFacade>,
    pub domains: Arc<DomainFacade>,
    pub proxy: Arc<ProxyFacade>,
    pub wireguard: Arc<WireguardFacade>,
    pub storage: Arc<StorageFacade>,
    pub backup: Arc<BackupFacade>,
    pub updater: Arc<UpdateFacade>,
    pub runners: Arc<RunnerFacade>,
    pub cluster: Arc<ClusterFacade>,
    pub cron_scheduler: Arc<devforge_cron::CronScheduler>,
    /// Un slot de build par nœud.
    pub deploy_queue: Arc<crate::deploy_queue::DeployQueue>,
    /// Active backends: executor / github / storage / llm.
    pub backends: Arc<BackendModes>,
}

#[derive(Debug)]
pub struct BackendModes {
    pub executor: &'static str,
    pub github: std::sync::RwLock<String>,
    pub storage: std::sync::RwLock<String>,
    pub database: &'static str,
    pub llm: std::sync::RwLock<String>,
}

impl BackendModes {
    pub fn github_mode(&self) -> String {
        self.github
            .read()
            .map(|m| m.clone())
            .unwrap_or_else(|_| "stub".into())
    }

    pub fn set_github_mode(&self, mode: impl Into<String>) {
        if let Ok(mut g) = self.github.write() {
            *g = mode.into();
        }
    }

    pub fn storage_mode(&self) -> String {
        self.storage
            .read()
            .map(|m| m.clone())
            .unwrap_or_else(|_| "memory".into())
    }

    pub fn set_storage_mode(&self, mode: impl Into<String>) {
        if let Ok(mut g) = self.storage.write() {
            *g = mode.into();
        }
    }

    pub fn llm_mode(&self) -> String {
        self.llm
            .read()
            .map(|m| m.clone())
            .unwrap_or_else(|_| "stub".into())
    }

    pub fn set_llm_mode(&self, mode: impl Into<String>) {
        if let Ok(mut g) = self.llm.write() {
            *g = mode.into();
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Project {
    pub id: i64,
    pub uuid: String,
    pub name: String,
    pub slug: String,
    pub status: String,
    pub git_repository: Option<String>,
    pub git_branch: Option<String>,
    pub server_id: Option<String>,
    pub workdir: Option<String>,
    pub test_command: Option<String>,
    pub production_url: Option<String>,
    pub workspace_uuid: String,
    pub build_pack: String,
    pub port: i64,
    pub is_static: i64,
    /// NULL = hérite / non défini ; 0 = off ; 1 = on (barrière Traefik SSO).
    pub is_sso_protected: Option<i64>,
    /// NULL = non défini ; 1 = app gère son propre login (pas de ForwardAuth).
    pub has_own_user_system: Option<i64>,
    pub publish_directory: Option<String>,
    pub base_directory: String,
    pub docker_compose_location: Option<String>,
    /// 1 (default) = auto-deploy on push ; 0 = manual only.
    pub auto_deploy: i64,
    /// 1 = `docker run --gpus all` au prochain déploiement.
    pub gpu_nvidia: i64,
    /// 1 = `docker run --device /dev/dri` au prochain déploiement.
    pub gpu_dri: i64,
    /// Montages `source:cible[:ro]` appliqués au `docker run` (JSON).
    pub volumes_json: String,
    /// Ports extra, sidecars, limites, healthcheck (JSON).
    pub runtime_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Deployment {
    pub id: i64,
    pub uuid: String,
    pub project_id: i64,
    pub status: String,
    pub git_sha: Option<String>,
    pub git_message: Option<String>,
    pub logs: Option<String>,
    pub error_summary: Option<String>,
    pub error_hint: Option<String>,
    pub live_revision_sha: Option<String>,
    pub finished_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub(crate) struct SqliteProjectStore {
    pub(crate) pool: PgPool,
    pub(crate) deploy: Arc<DeployFacade>,
    pub(crate) deploy_queue: Arc<crate::deploy_queue::DeployQueue>,
}

#[async_trait]
impl ProjectStore for SqliteProjectStore {
    async fn list_projects(&self) -> DfResult<Vec<Value>> {
        let rows = sqlx::query_as::<_, Project>("SELECT * FROM projects ORDER BY name ASC")
            .fetch_all(&self.pool)
            .await
            .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;
        Ok(rows
            .into_iter()
            .map(|p| {
                json!({
                    "uuid": p.uuid,
                    "name": p.name,
                    "status": p.status,
                    "git_repository": p.git_repository,
                    "git_branch": p.git_branch,
                    "production_url": p.production_url,
                    "auto_deploy": p.auto_deploy != 0,
                })
            })
            .collect())
    }

    async fn get_project(&self, uuid: &str) -> DfResult<Option<Value>> {
        let row = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE uuid = $1")
            .bind(uuid)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;
        let Some(p) = row else {
            return Ok(None);
        };
        let deps: Vec<(String, String, Option<String>, Option<String>, String)> = sqlx::query_as(
            r#"SELECT d.uuid, d.status, d.git_sha, d.git_message, d.created_at
               FROM deployments d
               WHERE d.project_id = $1
               ORDER BY d.id DESC LIMIT 5"#,
        )
        .bind(p.id)
        .fetch_all(&self.pool)
        .await
        .unwrap_or_default();
        let deployments: Vec<Value> = deps
            .into_iter()
            .map(|(uuid, status, sha, msg, created)| {
                json!({
                    "uuid": uuid,
                    "status": status,
                    "git_sha": sha,
                    "git_message": msg,
                    "created_at": created,
                })
            })
            .collect();
        Ok(Some(json!({
            "uuid": p.uuid,
            "name": p.name,
            "slug": p.slug,
            "status": p.status,
            "git_repository": p.git_repository,
            "git_branch": p.git_branch,
            "production_url": p.production_url,
            "build_pack": p.build_pack,
            "port": p.port,
            "workdir": p.workdir,
            "test_command": p.test_command,
            "auto_deploy": p.auto_deploy != 0,
            "recent_deployments": deployments,
        })))
    }

    async fn resolve_project(&self, uuid: &str) -> DfResult<Option<ProjectTestContext>> {
        let row = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE uuid = $1")
            .bind(uuid)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;
        Ok(row.map(|p| ProjectTestContext {
            project_uuid: p.uuid,
            server_id: p.server_id.unwrap_or_default(),
            workdir: p.workdir.unwrap_or_default(),
            test_command: p.test_command.unwrap_or_default(),
            timeout: None,
        }))
    }

    async fn deployment_logs(&self, uuid: &str) -> DfResult<Value> {
        let row = sqlx::query_as::<_, Deployment>("SELECT * FROM deployments WHERE uuid = $1")
            .bind(uuid)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;
        match row {
            Some(d) => Ok(json!({
                "ok": true,
                "deployment_uuid": d.uuid,
                "status": d.status,
                "logs": d.logs.unwrap_or_default()
            })),
            None => Ok(json!({"ok": false, "error": format!("Déploiement introuvable: {uuid}")})),
        }
    }

    async fn trigger_deploy(
        &self,
        project_uuid: &str,
        _git_sha: Option<String>,
        message: &str,
    ) -> DfResult<Value> {
        use devforge_deploy::DeployRequest;

        // Récupérer le projet
        let project = sqlx::query_as::<_, Project>("SELECT * FROM projects WHERE uuid = $1")
            .bind(project_uuid)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        let Some(project) = project else {
            return Ok(json!({
                "ok": false,
                "error": format!("Projet introuvable : {project_uuid}")
            }));
        };

        // Vérifier les pré-requis
        let git_repo = project.git_repository.as_deref().unwrap_or("").trim();
        if git_repo.is_empty() {
            return Ok(json!({
                "ok": false,
                "error": "git_repository manquant — configure le projet ou crée un dépôt avec create_github_repo",
                "hint": "Le déploiement nécessite un dépôt Git configuré."
            }));
        }

        let workdir = project.workdir.as_deref().unwrap_or("").trim();
        if workdir.is_empty() {
            return Ok(json!({
                "ok": false,
                "error": "workdir manquant — le projet doit avoir un répertoire de travail défini",
                "hint": "Configure le workdir du projet avant de déployer."
            }));
        }

        // Créer le déploiement
        let dep_uuid = new_uuid();
        let now = now_str();

        sqlx::query(
            r#"INSERT INTO deployments (
                uuid, project_id, status, git_sha, git_message, logs, finished_at, created_at, updated_at
            ) VALUES ($1, $2, 'queued', $3, $4, $5, NULL, $6, $7)"#,
        )
        .bind(&dep_uuid)
        .bind(project.id)
        .bind("pending")
        .bind(message)
        .bind("[devforge] démarrage du déploiement…\n")
        .bind(&now)
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        // Mettre à jour le statut du projet
        sqlx::query("UPDATE projects SET status = 'deploying', updated_at = $1 WHERE id = $2")
            .bind(&now)
            .bind(project.id)
            .execute(&self.pool)
            .await
            .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        // Récupérer le token GitHub depuis instance_settings (même pattern que run_real_deploy)
        let token: Option<String> = sqlx::query_as::<_, (String,)>(
            "SELECT github_token FROM instance_settings WHERE id = 1",
        )
        .fetch_optional(&self.pool)
        .await
        .ok()
        .flatten()
        .map(|(t,)| t)
        .filter(|t| !t.trim().is_empty());

        // Charger le fichier .env (même pattern que run_real_deploy)
        let env_file = crate::routes::load_env_file_content(&self.pool, &project.uuid).await;
        let (env_file, group_network, group_alias) =
            crate::group_routes::prepare_deploy_link(&self.pool, &project.uuid, env_file).await;

        // Construire la DeployRequest (même pattern que run_real_deploy)
        let req = DeployRequest {
            project_uuid: project.uuid.clone(),
            server_id: project
                .server_id
                .clone()
                .unwrap_or_else(|| "default".into()),
            workdir: project.workdir.clone().unwrap_or_default(),
            git_repository: project.git_repository.clone().unwrap_or_default(),
            git_branch: project.git_branch.clone().unwrap_or_else(|| "main".into()),
            build_pack: if project.build_pack.is_empty() {
                "nixpacks".into()
            } else {
                project.build_pack.clone()
            },
            port: project.port.clamp(1, 65535) as u16,
            base_directory: if project.base_directory.is_empty() {
                "/".into()
            } else {
                project.base_directory.clone()
            },
            docker_compose_location: project.docker_compose_location.clone(),
            publish_directory: project.publish_directory.clone(),
            is_static: project.is_static != 0,
            github_token: token,
            env_file,
            // proxy_labels sera configuré ultérieurement si nécessaire
            // Pour le déploiement initial via agent, on peut utiliser None
            proxy_labels: None,
            gpu_nvidia: project.gpu_nvidia != 0,
            gpu_dri: project.gpu_dri != 0,
            group_network,
            group_alias,
            volumes: devforge_deploy::docker::decode_volume_mounts(&project.volumes_json),
            runtime: devforge_deploy::RuntimeSpec::from_json(&project.runtime_json)
                .unwrap_or_default(),
        };

        let server_id = req.server_id.clone();
        let deploy = self.deploy.clone();
        let result = crate::deploy_queue::run_in_node_slot(
            &self.deploy_queue,
            &self.pool,
            &server_id,
            &dep_uuid,
            move || {
                let deploy = deploy.clone();
                async move { deploy.deploy(&req).await }
            },
        )
        .await;
        crate::deploy_queue::record_event(
            &self.pool,
            &project.uuid,
            "deploy",
            if result.ok { "success" } else { "failed" },
            &dep_uuid,
            result.git_sha.as_deref().unwrap_or(""),
        )
        .await;
        let finished = now_str();
        let status = if result.ok { "success" } else { "failed" };
        let final_sha = result.git_sha.unwrap_or_else(|| "unknown".into());

        // Mettre à jour le déploiement avec le résultat
        sqlx::query(
            r#"UPDATE deployments SET status = $1, git_sha = $2, logs = $3, finished_at = $4, updated_at = $5
               WHERE uuid = $6"#,
        )
        .bind(status)
        .bind(&final_sha)
        .bind(&result.logs)
        .bind(&finished)
        .bind(&finished)
        .bind(&dep_uuid)
        .execute(&self.pool)
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        // Mettre à jour le statut du projet
        let project_status = if result.ok { "live" } else { "failed" };
        sqlx::query("UPDATE projects SET status = $1, updated_at = $2 WHERE id = $3")
            .bind(project_status)
            .bind(&finished)
            .bind(project.id)
            .execute(&self.pool)
            .await
            .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        Ok(json!({
            "ok": result.ok,
            "deployment_uuid": dep_uuid,
            "status": status,
            "git_sha": final_sha,
            "logs": result.logs,
            "message": if result.ok {
                format!("✓ Déploiement {} réussi ({})", dep_uuid, final_sha)
            } else {
                format!("✗ Déploiement {} échoué", dep_uuid)
            }
        }))
    }
}

/// SQLite-backed env store for project variables.
pub struct SqliteEnvStore {
    pool: PgPool,
}

#[async_trait]
impl EnvStore for SqliteEnvStore {
    async fn list(&self, project_uuid: &str) -> DfResult<Vec<EnvVar>> {
        let rows: Vec<(String, String, i64)> = sqlx::query_as(
            "SELECT key, value, secret FROM project_env_vars WHERE project_uuid = $1 ORDER BY key",
        )
        .bind(project_uuid)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;
        Ok(rows
            .into_iter()
            .map(|(key, value, secret)| EnvVar {
                key,
                value,
                secret: secret != 0,
            })
            .collect())
    }

    async fn get(&self, project_uuid: &str, key: &str) -> DfResult<Option<EnvVar>> {
        let row: Option<(String, String, i64)> = sqlx::query_as(
            "SELECT key, value, secret FROM project_env_vars WHERE project_uuid = $1 AND key = $2",
        )
        .bind(project_uuid)
        .bind(key)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;
        Ok(row.map(|(key, value, secret)| EnvVar {
            key,
            value,
            secret: secret != 0,
        }))
    }

    async fn upsert(&self, project_uuid: &str, var: EnvVar) -> DfResult<EnvVar> {
        let key = var.key.trim().to_string();
        if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            return Err(devforge_shared::DevForgeError::Message(
                "clé env invalide (A-Z, 0-9, _)".into(),
            ));
        }
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            r#"INSERT INTO project_env_vars (project_uuid, key, value, secret, updated_at)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT(project_uuid, key) DO UPDATE SET
                 value = excluded.value,
                 secret = excluded.secret,
                 updated_at = excluded.updated_at"#,
        )
        .bind(project_uuid)
        .bind(&key)
        .bind(&var.value)
        .bind(if var.secret { 1 } else { 0 })
        .bind(&now)
        .execute(&self.pool)
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;
        Ok(EnvVar {
            key,
            value: var.value,
            secret: var.secret,
        })
    }

    async fn delete(&self, project_uuid: &str, key: &str) -> DfResult<bool> {
        let res = sqlx::query("DELETE FROM project_env_vars WHERE project_uuid = $1 AND key = $2")
            .bind(project_uuid)
            .bind(key)
            .execute(&self.pool)
            .await
            .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;
        Ok(res.rows_affected() > 0)
    }
}

impl AppState {
    pub async fn new(database_url: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let db_path = devforge_backup::sqlite_path_from_url(database_url);
        if let Err(e) = crate::control_pg::adopt_staged_clone_if_armed().await {
            tracing::error!(error = %e, "copie de reprise du control plane inutilisable");
        }
        let promote =
            std::fs::read_to_string(devforge_cluster::promote_flag_path()).unwrap_or_default();
        if promote.trim() == "standby" {
            crate::control_pg::takeover_from_standby().await?;
        }
        let pending = PathBuf::from(format!("{}.pending-restore", db_path.display()));
        let pending_pg = std::fs::read(&pending)
            .ok()
            .is_some_and(|b| crate::control_pg::snapshot_is_postgres(&b));
        let restored_sqlite = if pending_pg {
            false
        } else {
            InstanceBackupService::apply_pending_restore(&db_path).unwrap_or(false)
        };

        let pg_url = crate::control_pg::ensure(database_url).await?;
        let restored_pg = if pending_pg {
            let bytes = std::fs::read(&pending)?;
            crate::control_pg::restore_snapshot(&bytes).await?;
            let _ = std::fs::remove_file(&pending);
            true
        } else {
            false
        };
        let pool = PgPoolOptions::new()
            .max_connections(10)
            .connect(&pg_url)
            .await?;

        if restored_sqlite {
            crate::control_pg::replace_from_sqlite(&pool, &db_path).await?;
        } else if !restored_pg {
            crate::control_pg::import_legacy_sqlite(&pool, &db_path).await?;
        }

        crate::db::migrate(&pool).await?;

        let cluster_store: Arc<dyn ClusterStore> =
            Arc::new(crate::cluster_store::SqliteClusterStore { pool: pool.clone() });
        let cluster = Arc::new(ClusterFacade::new(cluster_store.clone()));
        {
            let instance_url: String = sqlx::query_as::<_, (String,)>(
                "SELECT instance_url FROM instance_settings WHERE id = 1",
            )
            .fetch_optional(&pool)
            .await?
            .map(|r| r.0)
            .unwrap_or_default();
            let instance_name: String = sqlx::query_as::<_, (String,)>(
                "SELECT instance_name FROM instance_settings WHERE id = 1",
            )
            .fetch_optional(&pool)
            .await?
            .map(|r| r.0)
            .unwrap_or_default();
            if let Err(e) = cluster.ensure_leader(&instance_name, &instance_url).await {
                tracing::warn!(error = %e, "cluster seed leader");
            }
        }

        let (inner_executor, executor_mode) = executor_from_env();
        let executor: Arc<dyn devforge_deploy::RemoteExecutor> =
            Arc::new(ClusterAwareExecutor::new(inner_executor, cluster_store));
        let (gh_client, github_mode, github_token) = resolve_github_client(&pool).await;
        let storage = Arc::new(StorageFacade::memory());
        let s3_cfg = crate::backup_routes::load_s3_config(&pool).await;
        storage.apply_config_unchecked(s3_cfg).await;
        let storage_mode = storage.mode().await;
        let backup = Arc::new(BackupFacade::new(
            Arc::new(MemoryBackupStore::new()),
            storage.clone(),
        ));
        let (_, llm_mode) = devforge_llm::provider_from_env();
        let llm_mode = llm_mode.to_string();

        let backends = Arc::new(BackendModes {
            executor: executor_mode,
            github: std::sync::RwLock::new(github_mode.to_string()),
            storage: std::sync::RwLock::new(storage_mode.clone()),
            database: "postgres",
            llm: std::sync::RwLock::new(llm_mode.clone()),
        });
        tracing::info!(
            executor = executor_mode,
            github = %github_mode,
            storage = %storage_mode,
            llm = %llm_mode,
            "backends runtime"
        );

        let deploy = Arc::new(DeployFacade::new(executor.clone()));
        let github = Arc::new(GitHubFacade::new(gh_client, github_mode));
        if let Some(t) = github_token {
            github.set_token(Some(t));
        }
        let mcp = Arc::new(McpFacade::with_http_client());
        let _mem = MemoryEnvStore::new();
        let env = Arc::new(EnvFacade::new(Arc::new(SqliteEnvStore {
            pool: pool.clone(),
        })));
        let ports = Arc::new(PortsFacade::new(Arc::new(
            crate::infra_sqlite::SqlitePortStore { pool: pool.clone() },
        )));
        let apply_server =
            std::env::var("DEVFORGE_DEFAULT_SERVER_ID").unwrap_or_else(|_| "default".into());

        let mut domains = DomainFacade::new(Arc::new(crate::infra_sqlite::SqliteDomainStore {
            pool: pool.clone(),
        }));
        let mut proxy = ProxyFacade::new(Arc::new(crate::infra_sqlite::SqliteProxyStore {
            pool: pool.clone(),
        }));
        let mut wireguard =
            WireguardFacade::new(Arc::new(crate::infra_sqlite::SqliteWireguardStore {
                pool: pool.clone(),
            }));
        if executor_mode != "stub" {
            domains = domains.with_executor(executor.clone(), apply_server.clone());
            proxy = proxy.with_executor(executor.clone(), apply_server.clone());
            wireguard = wireguard.with_executor(executor.clone(), apply_server);
        }
        let domains = Arc::new(domains);
        let proxy = Arc::new(proxy);
        let wireguard = Arc::new(wireguard);
        let deploy_queue = Arc::new(crate::deploy_queue::DeployQueue::new());
        let store: Arc<dyn ProjectStore> = Arc::new(SqliteProjectStore {
            pool: pool.clone(),
            deploy: deploy.clone(),
            deploy_queue: deploy_queue.clone(),
        });
        let registry = Arc::new(build_core_registry(
            deploy.clone(),
            github.clone(),
            store,
            mcp.clone(),
            env.clone(),
            Arc::new(pool.clone()),
        ));
        let agent = Arc::new(AgentRunner::new(registry.clone()));
        let updater = Arc::new(UpdateFacade::from_env(github.clone(), deploy.executor()));

        let runners = Arc::new(RunnerFacade::new(
            Arc::new(crate::runner_store::SqliteRunnerStore { pool: pool.clone() }),
            deploy.executor(),
            github.clone(),
        ));

        let cron_scheduler = Arc::new(devforge_cron::CronScheduler::new(
            pool.clone(),
            executor.clone(),
        ));

        let state = Self {
            pool,
            db_path,
            registry,
            agent,
            databases: Arc::new(DatabaseFacade::new()),
            mcp,
            env,
            deploy,
            github,
            ports,
            domains,
            proxy,
            wireguard,
            storage,
            backup,
            updater,
            runners,
            cluster,
            cron_scheduler,
            deploy_queue,
            backends,
        };

        if let Err(e) = crate::mcp_routes::load_mcp_from_db(&state).await {
            tracing::warn!(error = %e, "chargement MCP depuis SQLite");
        }

        Ok(state)
    }

    /// Client GitHub isolé, sans toucher au token d’instance.
    pub fn github_from_token(token: &str) -> Arc<GitHubFacade> {
        let (client, mode) = client_from_token(token);
        let gh = Arc::new(GitHubFacade::new(client, mode));
        let t = token.trim();
        if !t.is_empty() {
            gh.set_token(Some(t.to_string()));
        }
        gh
    }

    /// Persist + hot-reload GitHub HTTP client (PAT). Empty token → off.
    pub async fn configure_github(
        &self,
        token: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let t = token.trim().to_string();
        let now = now_str();
        sqlx::query("UPDATE instance_settings SET github_token = $1, updated_at = $2 WHERE id = 1")
            .bind(&t)
            .bind(&now)
            .execute(&self.pool)
            .await?;

        if t.is_empty() {
            let (client, mode) = client_from_token("");
            self.github.set_client(client, mode);
            self.github.set_token(None);
            self.backends.set_github_mode(mode);
            return Ok(());
        }

        let probe = HttpGitHubClient::new(&t);
        let user = probe.current_user().await?;
        if user.login.is_empty() {
            return Err("token GitHub invalide (login vide)".into());
        }
        let (client, mode) = client_from_token(&t);
        self.github.set_client(client, mode);
        self.github.set_token(Some(t.clone()));
        self.backends.set_github_mode(mode);
        if std::env::var("DEVFORGE_GITHUB_TOKEN").is_err() {
            std::env::set_var("DEVFORGE_GITHUB_TOKEN", &t);
        }
        Ok(())
    }

    /// Persist + hot-reload LLM provider. Empty key → stub (unless ollama).
    pub async fn configure_llm(
        &self,
        provider: &str,
        api_key: &str,
        model: &str,
        base_url: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let provider = provider.trim().to_lowercase();
        let provider = if provider.is_empty() {
            "auto".to_string()
        } else {
            provider
        };
        let api_key = api_key.trim().to_string();
        let model = {
            let m = model.trim();
            if m.is_empty() {
                "gpt-4o-mini".to_string()
            } else {
                m.to_string()
            }
        };
        let base_url = base_url.trim().to_string();
        let now = now_str();
        sqlx::query(
            "UPDATE instance_settings SET llm_provider = $1, llm_api_key = $2, llm_model = $3, llm_base_url = $4, updated_at = $5 WHERE id = 1",
        )
        .bind(&provider)
        .bind(&api_key)
        .bind(&model)
        .bind(&base_url)
        .bind(&now)
        .execute(&self.pool)
        .await?;

        if provider == "stub" {
            let (llm, mode) = devforge_llm::provider_from_config("stub", "", "gpt-4o-mini", None);
            self.agent.set_llm(llm, mode.clone()).await;
            self.backends.set_llm_mode(mode);
            return Ok(());
        }

        // Recharge toute la chaîne (priorité) plutôt qu’un seul provider.
        self.reload_llm_chain().await
    }

    /// La chaîne LLM est résolue par compte au moment du chat. Plus de client global partagé.
    pub async fn reload_llm_chain(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        Ok(())
    }

    pub async fn llm_for_user(
        &self,
        user_uuid: &str,
    ) -> (Arc<dyn devforge_llm::LlmProvider>, String) {
        resolve_llm_provider(&self.pool, user_uuid).await
    }
}

fn normalize_chat_base(provider: &str, base_url: &str) -> String {
    let clean = base_url.trim().trim_end_matches('/').to_string();
    if provider == "ollama" {
        if clean.is_empty() {
            return "http://127.0.0.1:11434/v1".into();
        }
        if clean.ends_with("/v1") {
            return clean;
        }
        return format!("{clean}/v1");
    }
    if clean.is_empty() {
        return devforge_llm::OpenAiCompatibleProvider::default_base_url(provider)
            .unwrap_or("")
            .to_string();
    }
    clean
}

/// Une sonde récente reste valable : le chat ne re-ping pas Gemini puis Demeter puis Ollama
/// avant d'ouvrir la réponse (Cloudflare coupe à 100 s sans octet).
const LLM_PROBE_FRESH_SECS: i64 = 600;

fn llm_probe_is_fresh(last_probe_at: &str, now: chrono::DateTime<chrono::Utc>) -> bool {
    let Ok(ts) = chrono::DateTime::parse_from_rfc3339(last_probe_at.trim()) else {
        return false;
    };
    let age = now.signed_duration_since(ts.with_timezone(&chrono::Utc));
    age.num_seconds() >= 0 && age.num_seconds() < LLM_PROBE_FRESH_SECS
}

struct LlmProviderRow {
    id: String,
    name: String,
    provider: String,
    key: String,
    base: String,
    model: String,
    healthy: i64,
    last_probe_at: String,
    resolved_model: String,
}

fn chain_entry_for(row: &LlmProviderRow, model: &str) -> Option<devforge_llm::ChainEntry> {
    let chat_base = normalize_chat_base(&row.provider, &row.base);
    let (provider, mode) = devforge_llm::provider_from_config(
        &row.provider,
        &row.key,
        model,
        if chat_base.is_empty() {
            None
        } else {
            Some(chat_base.as_str())
        },
    );
    if mode == "stub" {
        return None;
    }
    Some(devforge_llm::ChainEntry {
        label: row.name.clone(),
        provider,
    })
}

async fn resolve_llm_provider(
    pool: &PgPool,
    user_uuid: &str,
) -> (Arc<dyn devforge_llm::LlmProvider>, String) {
    let rows: Vec<(
        String,
        String,
        String,
        String,
        String,
        String,
        i64,
        String,
        String,
    )> = sqlx::query_as(
        r#"SELECT id, name, provider, api_key, base_url, model,
                  COALESCE(healthy, 0), COALESCE(last_probe_at, ''), COALESCE(resolved_model, '')
           FROM llm_providers
           WHERE enabled = 1 AND user_uuid = $1
           ORDER BY priority ASC, name ASC"#,
    )
    .bind(user_uuid)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    if rows.is_empty() {
        return devforge_llm::provider_from_config("stub", "", "gpt-4o-mini", None);
    }

    let now = chrono::Utc::now();
    let now_str = now.to_rfc3339();
    let rows: Vec<LlmProviderRow> = rows
        .into_iter()
        .map(
            |(id, name, provider, key, base, model, healthy, last_probe_at, resolved_model)| {
                LlmProviderRow {
                    id,
                    name,
                    provider,
                    key,
                    base,
                    model,
                    healthy,
                    last_probe_at,
                    resolved_model,
                }
            },
        )
        .collect();

    let mut slots: Vec<Option<devforge_llm::ChainEntry>> = Vec::with_capacity(rows.len());
    let mut pending: Vec<(usize, LlmProviderRow)> = Vec::new();
    for (i, row) in rows.into_iter().enumerate() {
        let cached = row.healthy != 0 && llm_probe_is_fresh(&row.last_probe_at, now);
        let model = if row.resolved_model.trim().is_empty() {
            row.model.trim()
        } else {
            row.resolved_model.trim()
        };
        if cached && !model.is_empty() && model != "auto" {
            if let Some(entry) = chain_entry_for(&row, model) {
                tracing::info!(provider = %row.name, model, "LLM sonde récente — réutilisée");
                slots.push(Some(entry));
                continue;
            }
        }
        slots.push(None);
        pending.push((i, row));
    }

    if !pending.is_empty() {
        let pool = pool.clone();
        let probed = futures_util::future::join_all(pending.into_iter().map(|(i, row)| {
            let pool = pool.clone();
            let now_str = now_str.clone();
            async move {
                let probe = devforge_llm::probe(&devforge_llm::ProbeRequest {
                    provider: row.provider.clone(),
                    base_url: row.base.clone(),
                    api_key: row.key.clone(),
                    model: row.model.clone(),
                })
                .await;
                let _ = sqlx::query(
                    r#"UPDATE llm_providers
                       SET healthy = $1, last_probe_at = $2, last_probe_error = $3, resolved_model = $4
                       WHERE id = $5"#,
                )
                .bind(if probe.ok { 1i64 } else { 0i64 })
                .bind(&now_str)
                .bind(probe.error.as_deref().unwrap_or(""))
                .bind(&probe.resolved_model)
                .bind(&row.id)
                .execute(&pool)
                .await;
                (i, row, probe)
            }
        }))
        .await;

        for (i, row, probe) in probed {
            if !probe.ok {
                tracing::warn!(
                    provider = %row.name,
                    error = %probe.error.as_deref().unwrap_or("?"),
                    "LLM health KO — exclu de la chaîne"
                );
                continue;
            }
            let Some(entry) = chain_entry_for(&row, &probe.resolved_model) else {
                continue;
            };
            tracing::info!(
                provider = %row.name,
                model = %probe.resolved_model,
                latency_ms = probe.latency_ms,
                "LLM health OK — dans la chaîne"
            );
            slots[i] = Some(entry);
        }
    }

    let mut chain = Vec::new();
    let mut labels = Vec::new();
    for entry in slots.into_iter().flatten() {
        labels.push(entry.label.clone());
        chain.push(entry);
    }
    if chain.len() == 1 {
        let label = labels[0].clone();
        return (chain.remove(0).provider, label);
    }
    if chain.len() > 1 {
        let mode = format!("chain:{}", labels.join(">"));
        let resilient = Arc::new(devforge_llm::ResilientLlmProvider::new(chain));
        return (resilient, mode);
    }
    tracing::warn!(user = %user_uuid, "aucun LLM healthy pour ce compte — stub");
    devforge_llm::provider_from_config("stub", "", "gpt-4o-mini", None)
}

async fn resolve_github_client(
    pool: &PgPool,
) -> (
    Arc<dyn devforge_github::GitHubClient>,
    &'static str,
    Option<String>,
) {
    if let Ok(token) =
        std::env::var("DEVFORGE_GITHUB_TOKEN").or_else(|_| std::env::var("GITHUB_TOKEN"))
    {
        if !token.trim().is_empty() {
            let (c, m) = client_from_token(&token);
            return (c, m, Some(token));
        }
    }
    let row: Option<(String,)> =
        sqlx::query_as("SELECT github_token FROM instance_settings WHERE id = 1")
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    if let Some((token,)) = row {
        if !token.trim().is_empty() {
            let (c, m) = client_from_token(&token);
            return (c, m, Some(token));
        }
    }
    let (c, m) = client_from_env();
    (c, m, None)
}

pub fn now_str() -> String {
    let n: DateTime<Utc> = Utc::now();
    n.to_rfc3339()
}

pub fn new_uuid() -> String {
    Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_probe_skips_repin_within_ten_minutes() {
        let now = Utc::now();
        let recent = (now - chrono::Duration::seconds(30)).to_rfc3339();
        assert!(llm_probe_is_fresh(&recent, now));
        let stale = (now - chrono::Duration::seconds(LLM_PROBE_FRESH_SECS + 5)).to_rfc3339();
        assert!(!llm_probe_is_fresh(&stale, now));
        assert!(!llm_probe_is_fresh("", now));
    }
}
