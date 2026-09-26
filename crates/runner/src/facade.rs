use crate::compat::parse_version;
use crate::docker::{
    assert_safe_volume_mount, assert_valid_container_name, build_docker_run_command,
    build_docker_run_from_inspect, docker_inspect_json_cmd, docker_logs_cmd, docker_pull_cmd,
    docker_restart_cmd, docker_rm_cmd, docker_rm_state_volume_cmd, docker_start_cmd,
    docker_stop_cmd, parse_inspect_env,
    slugify_runner_name, stale_network_cleanup,
};
use crate::events::RunnerEventBus;
use crate::models::{
    AuthMode, CreateRunnerRequest, LogLine, ManagedRunner, OpStatus, RunnerEvent, RunnerJob,
    RunnerLogs, DEFAULT_IMAGE, DEFAULT_LABELS, DEFAULT_SERVER_ID,
};
use crate::store::RunnerStore;
use crate::sync::RunnerSyncWorker;
use chrono::Utc;
use devforge_deploy::RemoteExecutor;
use devforge_github::GitHubFacade;
use devforge_shared::{DevForgeError, Result};
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

pub struct RunnerFacade {
    store: Arc<dyn RunnerStore>,
    executor: Arc<dyn RemoteExecutor>,
    github: Arc<GitHubFacade>,
    bus: RunnerEventBus,
    sync: Arc<RunnerSyncWorker>,
}

impl RunnerFacade {
    pub fn new(
        store: Arc<dyn RunnerStore>,
        executor: Arc<dyn RemoteExecutor>,
        github: Arc<GitHubFacade>,
    ) -> Self {
        let bus = RunnerEventBus::new(256);
        let sync = Arc::new(RunnerSyncWorker::new(
            store.clone(),
            executor.clone(),
            github.clone(),
            bus.clone(),
        ));
        Self {
            store,
            executor,
            github,
            bus,
            sync,
        }
    }

    pub fn bus(&self) -> RunnerEventBus {
        self.bus.clone()
    }

    pub fn sync_worker(&self) -> Arc<RunnerSyncWorker> {
        self.sync.clone()
    }

    pub async fn list(&self) -> Result<Value> {
        let runners = self.store.list().await?;
        Ok(json!({"ok": true, "runners": runners}))
    }

    pub async fn get(&self, id: &str) -> Result<Value> {
        let runner = self
            .store
            .get(id)
            .await?
            .ok_or_else(|| DevForgeError::NotFound(format!("runner {id}")))?;

        let mut environment = Vec::new();
        if runner.live_state != "missing" {
            if let Ok(res) = self
                .executor
                .exec(
                    &runner.server_id,
                    "",
                    &docker_inspect_json_cmd(&runner.container_name),
                    12,
                )
                .await
            {
                if let Ok(inspect) = serde_json::from_str::<Value>(res.output.trim()) {
                    environment = parse_inspect_env(&inspect);
                }
            }
        }

        Ok(json!({
            "ok": true,
            "runner": runner,
            "environment": environment,
        }))
    }

    /// Persist desired state and spawn async create (returns immediately).
    pub async fn create_async(&self, req: CreateRunnerRequest) -> Result<Value> {
        let owner = req.owner.trim().to_string();
        let repo = req.repo.trim().to_string();
        let runner_name = req.runner_name.trim().to_string();
        if owner.is_empty() || repo.is_empty() || runner_name.is_empty() {
            return Err(DevForgeError::Message(
                "owner, repo et runner_name sont requis".into(),
            ));
        }

        let container_name = req
            .container_name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("github-runner-{}", slugify_runner_name(&runner_name)));
        assert_valid_container_name(&container_name)?;

        let volumes = req.volumes.clone().unwrap_or_default();
        for v in &volumes {
            assert_safe_volume_mount(v)?;
        }

        let now = Utc::now().to_rfc3339();
        let id = format!("rn_{}", &Uuid::new_v4().to_string()[..12]);
        let server_id = req
            .server_id
            .clone()
            .unwrap_or_else(|| DEFAULT_SERVER_ID.into());
        let repo_url = format!("https://github.com/{owner}/{repo}");
        let image = req
            .image
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_IMAGE)
            .to_string();
        let labels = req
            .labels
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_LABELS)
            .to_string();
        let network_mode = req
            .network_mode
            .as_deref()
            .unwrap_or("bridge")
            .to_string();
        let timezone = req.timezone.as_deref().unwrap_or("UTC").to_string();
        let auth_mode = AuthMode::parse(req.auth_mode.as_deref().unwrap_or("registration"));

        let runner = ManagedRunner {
            id: id.clone(),
            server_id: server_id.clone(),
            container_name: container_name.clone(),
            runner_name: runner_name.clone(),
            owner: owner.clone(),
            repo: repo.clone(),
            repo_url: repo_url.clone(),
            image: image.clone(),
            labels,
            network_mode,
            timezone,
            replace_existing: req.replace_existing.unwrap_or(true),
            pull_image: req.pull_image.unwrap_or(true),
            volumes,
            extra_env: req.extra_env.unwrap_or_default(),
            auth_mode: auth_mode.as_str().to_string(),
            enabled: true,
            project_uuid: req.project_uuid.clone(),
            live_state: "pending".into(),
            live_status: "Création en cours…".into(),
            container_id: None,
            github_status: None,
            github_busy: None,
            github_runner_id: None,
            last_synced_at: None,
            last_error: None,
            op_status: OpStatus::Creating.as_str().to_string(),
            created_at: now.clone(),
            updated_at: now,
        };

        self.store.upsert(&runner).await?;
        self.bus.publish(RunnerEvent::Updated {
            runner: runner.clone(),
        });

        let this = self.clone_handles();
        let runner_id = id.clone();
        tokio::spawn(async move {
            if let Err(e) = this.perform_create(&runner_id).await {
                tracing::error!(runner_id = %runner_id, error = %e, "runner create failed");
                let _ = this
                    .store
                    .set_op_status(&runner_id, OpStatus::Failed.as_str(), Some(&e.to_string()))
                    .await;
                if let Ok(Some(r)) = this.store.get(&runner_id).await {
                    this.bus.publish(RunnerEvent::Updated { runner: r });
                }
            }
        });

        Ok(json!({
            "ok": true,
            "accepted": true,
            "message": "Création du runner démarrée",
            "runner": runner,
        }))
    }

    async fn perform_create(&self, id: &str) -> Result<()> {
        let runner = self
            .store
            .get(id)
            .await?
            .ok_or_else(|| DevForgeError::NotFound(format!("runner {id}")))?;

        let auth_mode = AuthMode::parse(&runner.auth_mode);
        let token = self.resolve_auth_token_fixed(&runner, auth_mode).await?;

        if runner.pull_image {
            self.store
                .set_op_status(id, OpStatus::Pulling.as_str(), None)
                .await?;
            self.publish_id(id).await;
            let pull = self
                .executor
                .exec(
                    &runner.server_id,
                    "",
                    &docker_pull_cmd(&runner.image),
                    300,
                )
                .await?;
            if !pull.ok {
                return Err(DevForgeError::Message(format!(
                    "pull image échoué: {}",
                    truncate(&pull.output, 400)
                )));
            }
        }

        self.store
            .set_op_status(id, OpStatus::Starting.as_str(), None)
            .await?;
        self.publish_id(id).await;

        // Remove existing if present
        let _ = self
            .executor
            .exec(
                &runner.server_id,
                "",
                &docker_rm_cmd(&runner.container_name),
                30,
            )
            .await;
        // Recréation = nouvel enregistrement propre (jeton frais) : on jette l'ancienne config.
        let _ = self
            .executor
            .exec(
                &runner.server_id,
                "",
                &docker_rm_state_volume_cmd(&runner.container_name),
                30,
            )
            .await;
        let cleanup = stale_network_cleanup(&runner.container_name, &runner.network_mode);
        let _ = self
            .executor
            .exec(&runner.server_id, "", &cleanup, 15)
            .await;

        let cmd = build_docker_run_command(
            &runner.container_name,
            &runner.image,
            &runner.repo_url,
            &runner.runner_name,
            &token,
            auth_mode,
            &runner.labels,
            &runner.network_mode,
            &runner.timezone,
            runner.replace_existing,
            &runner.volumes,
            &runner.extra_env,
        )?;

        let run = self
            .executor
            .exec(&runner.server_id, "", &cmd, 60)
            .await?;
        if !run.ok {
            let _ = self
                .executor
                .exec(
                    &runner.server_id,
                    "",
                    &docker_rm_cmd(&runner.container_name),
                    20,
                )
                .await;
            return Err(DevForgeError::Message(format!(
                "docker run échoué: {}",
                truncate(&run.output, 500)
            )));
        }

        self.store
            .set_op_status(id, OpStatus::Idle.as_str(), None)
            .await?;
        let now = Utc::now().to_rfc3339();
        let _ = self
            .store
            .update_live(
                id,
                "running",
                "Créé",
                None,
                None,
                None,
                None,
                &now,
                None,
            )
            .await;
        self.publish_id(id).await;
        let _ = self.sync.sync_once(false).await;
        Ok(())
    }

    async fn resolve_auth_token_fixed(
        &self,
        runner: &ManagedRunner,
        mode: AuthMode,
    ) -> Result<String> {
        match mode {
            AuthMode::Registration => {
                let tok = self
                    .github
                    .create_registration_token(&runner.owner, &runner.repo)
                    .await?;
                Ok(tok.token)
            }
            AuthMode::Pat => {
                let tok = self.github.instance_token().unwrap_or_default();
                if tok.is_empty() {
                    return Err(DevForgeError::Message(
                        "PAT instance manquant — connecte GitHub dans Settings".into(),
                    ));
                }
                Ok(tok)
            }
        }
    }

    pub async fn action(&self, id: &str, action: &str) -> Result<Value> {
        let action = action.to_lowercase();
        if !matches!(
            action.as_str(),
            "start" | "stop" | "restart" | "recreate"
        ) {
            return Err(DevForgeError::Message(
                "action invalide (start|stop|restart|recreate)".into(),
            ));
        }

        let runner = self
            .store
            .get(id)
            .await?
            .ok_or_else(|| DevForgeError::NotFound(format!("runner {id}")))?;

        if action == "recreate" {
            self.store
                .set_op_status(id, OpStatus::Recreating.as_str(), None)
                .await?;
            self.publish_id(id).await;
            let this = self.clone_handles();
            let rid = id.to_string();
            tokio::spawn(async move {
                if let Err(e) = this.perform_recreate(&rid).await {
                    tracing::error!(runner_id = %rid, error = %e, "runner recreate failed");
                    let _ = this
                        .store
                        .set_op_status(&rid, OpStatus::Failed.as_str(), Some(&e.to_string()))
                        .await;
                    if let Ok(Some(r)) = this.store.get(&rid).await {
                        this.bus.publish(RunnerEvent::Updated { runner: r });
                    }
                }
            });
            let runner = self.store.get(id).await?.unwrap_or(runner);
            return Ok(json!({
                "ok": true,
                "accepted": true,
                "action": "recreate",
                "message": "Recréation démarrée",
                "runner": runner,
            }));
        }

        let (op, cmd, msg) = match action.as_str() {
            "start" => (
                OpStatus::StartingAction,
                docker_start_cmd(&runner.container_name),
                "Runner démarré",
            ),
            "stop" => (
                OpStatus::Stopping,
                docker_stop_cmd(&runner.container_name),
                "Runner arrêté",
            ),
            "restart" => (
                OpStatus::Restarting,
                docker_restart_cmd(&runner.container_name),
                "Runner redémarré",
            ),
            _ => unreachable!(),
        };

        self.store
            .set_op_status(id, op.as_str(), None)
            .await?;
        self.publish_id(id).await;

        let res = self
            .executor
            .exec(&runner.server_id, "", &cmd, 60)
            .await?;
        if !res.ok {
            self.store
                .set_op_status(id, OpStatus::Failed.as_str(), Some(&res.output))
                .await?;
            self.publish_id(id).await;
            return Err(DevForgeError::Message(format!(
                "action {action} échouée: {}",
                truncate(&res.output, 400)
            )));
        }

        self.store
            .set_op_status(id, OpStatus::Idle.as_str(), None)
            .await?;
        let _ = self.sync.sync_once(false).await;
        let runner = self
            .store
            .get(id)
            .await?
            .ok_or_else(|| DevForgeError::NotFound(format!("runner {id}")))?;
        Ok(json!({
            "ok": true,
            "action": action,
            "message": msg,
            "runner": runner,
        }))
    }

    async fn perform_recreate(&self, id: &str) -> Result<()> {
        let mut runner = self
            .store
            .get(id)
            .await?
            .ok_or_else(|| DevForgeError::NotFound(format!("runner {id}")))?;
        runner.pull_image = true;
        self.store.upsert(&runner).await?;

        // Prefer managed recreate path
        let auth_mode = AuthMode::parse(&runner.auth_mode);
        let token = match self.resolve_auth_token_fixed(&runner, auth_mode).await {
            Ok(t) => t,
            Err(_) if auth_mode == AuthMode::Pat => {
                self.resolve_auth_token_fixed(&runner, AuthMode::Registration)
                    .await?
            }
            Err(_) => {
                self.resolve_auth_token_fixed(&runner, AuthMode::Pat)
                    .await?
            }
        };

        self.store
            .set_op_status(id, OpStatus::Pulling.as_str(), None)
            .await?;
        self.publish_id(id).await;

        let pull = self
            .executor
            .exec(
                &runner.server_id,
                "",
                &docker_pull_cmd(&runner.image),
                300,
            )
            .await?;
        if !pull.ok {
            return Err(DevForgeError::Message(format!(
                "pull échoué: {}",
                truncate(&pull.output, 400)
            )));
        }

        let _ = self
            .executor
            .exec(
                &runner.server_id,
                "",
                &docker_rm_cmd(&runner.container_name),
                30,
            )
            .await;
        // Recréation = nouvel enregistrement propre (jeton frais) : on jette l'ancienne config.
        let _ = self
            .executor
            .exec(
                &runner.server_id,
                "",
                &docker_rm_state_volume_cmd(&runner.container_name),
                30,
            )
            .await;
        let cleanup = stale_network_cleanup(&runner.container_name, &runner.network_mode);
        let _ = self
            .executor
            .exec(&runner.server_id, "", &cleanup, 15)
            .await;

        self.store
            .set_op_status(id, OpStatus::Starting.as_str(), None)
            .await?;
        self.publish_id(id).await;

        let cmd = build_docker_run_command(
            &runner.container_name,
            &runner.image,
            &runner.repo_url,
            &runner.runner_name,
            &token,
            AuthMode::parse(&runner.auth_mode),
            &runner.labels,
            &runner.network_mode,
            &runner.timezone,
            runner.replace_existing,
            &runner.volumes,
            &runner.extra_env,
        )?;

        let run = self
            .executor
            .exec(&runner.server_id, "", &cmd, 60)
            .await?;
        if !run.ok {
            // Try inspect-based recreate as last resort
            if let Ok(ins) = self
                .executor
                .exec(
                    &runner.server_id,
                    "",
                    &docker_inspect_json_cmd(&runner.container_name),
                    12,
                )
                .await
            {
                if let Ok(inspect) = serde_json::from_str::<Value>(ins.output.trim()) {
                    if let Ok(alt) =
                        build_docker_run_from_inspect(&inspect, &runner.container_name)
                    {
                        let _ = self
                            .executor
                            .exec(&runner.server_id, "", &alt, 60)
                            .await?;
                    } else {
                        return Err(DevForgeError::Message(format!(
                            "recreate échoué: {}",
                            truncate(&run.output, 500)
                        )));
                    }
                } else {
                    return Err(DevForgeError::Message(format!(
                        "recreate échoué: {}",
                        truncate(&run.output, 500)
                    )));
                }
            } else {
                return Err(DevForgeError::Message(format!(
                    "recreate échoué: {}",
                    truncate(&run.output, 500)
                )));
            }
        }

        self.store
            .set_op_status(id, OpStatus::Idle.as_str(), None)
            .await?;
        self.publish_id(id).await;
        let _ = self.sync.sync_once(false).await;
        Ok(())
    }

    pub async fn destroy(&self, id: &str) -> Result<Value> {
        let runner = self
            .store
            .get(id)
            .await?
            .ok_or_else(|| DevForgeError::NotFound(format!("runner {id}")))?;

        self.store
            .set_op_status(id, OpStatus::Deleting.as_str(), None)
            .await?;
        self.publish_id(id).await;

        let _ = self
            .executor
            .exec(
                &runner.server_id,
                "",
                &docker_rm_cmd(&runner.container_name),
                30,
            )
            .await;
        let _ = self
            .executor
            .exec(
                &runner.server_id,
                "",
                &docker_rm_state_volume_cmd(&runner.container_name),
                30,
            )
            .await;

        self.store.delete(id).await?;
        self.bus.publish(RunnerEvent::Removed { id: id.into() });

        Ok(json!({
            "ok": true,
            "message": "Runner supprimé",
            "id": id,
        }))
    }

    pub async fn logs(&self, id: &str, lines: usize) -> Result<Value> {
        let runner = self
            .store
            .get(id)
            .await?
            .ok_or_else(|| DevForgeError::NotFound(format!("runner {id}")))?;

        if runner.live_state == "missing" {
            let logs = RunnerLogs {
                available: false,
                reason: Some("missing".into()),
                message: Some("Conteneur absent".into()),
                container: runner.container_name,
                container_status: Some(runner.live_status),
                line_count: 0,
                items: vec![],
                runner_version: None,
            };
            return Ok(json!({"ok": true, "logs": logs}));
        }

        let res = self
            .executor
            .exec(
                &runner.server_id,
                "",
                &docker_logs_cmd(&runner.container_name, lines),
                20,
            )
            .await?;

        let items: Vec<LogLine> = res
            .output
            .lines()
            .enumerate()
            .map(|(i, line)| LogLine {
                cursor: i + 1,
                message: line.to_string(),
            })
            .collect();
        let version = parse_version(&res.output);

        Ok(json!({
            "ok": true,
            "logs": RunnerLogs {
                available: true,
                reason: None,
                message: None,
                container: runner.container_name,
                container_status: Some(runner.live_status),
                line_count: items.len(),
                items,
                runner_version: version,
            }
        }))
    }

    pub async fn jobs(&self, id: &str) -> Result<Value> {
        let runner = self
            .store
            .get(id)
            .await?
            .ok_or_else(|| DevForgeError::NotFound(format!("runner {id}")))?;

        let runs = self
            .github
            .list_workflow_runs(&runner.owner, &runner.repo, None)
            .await
            .unwrap_or_default();

        let gh = self.github.clone();
        let owner = runner.owner.clone();
        let repo = runner.repo.clone();
        let runner_name = runner.runner_name.clone();

        let futs = runs.into_iter().take(12).map(|run| {
            let gh = gh.clone();
            let owner = owner.clone();
            let repo = repo.clone();
            let runner_name = runner_name.clone();
            async move {
                let jobs = gh
                    .list_workflow_jobs(&owner, &repo, run.id)
                    .await
                    .unwrap_or_default();
                let matched: Vec<_> = jobs
                    .into_iter()
                    .filter(|j| {
                        j.runner_name
                            .as_deref()
                            .map(|n| n.eq_ignore_ascii_case(&runner_name))
                            .unwrap_or(false)
                    })
                    .collect();
                if matched.is_empty() {
                    vec![RunnerJob {
                        run_id: run.id,
                        run_name: run.name.clone(),
                        run_status: run.status.clone(),
                        run_conclusion: run.conclusion.clone(),
                        run_url: run.html_url.clone(),
                        job_id: None,
                        job_name: None,
                        job_status: None,
                        job_conclusion: None,
                        runner_name: None,
                    }]
                } else {
                    matched
                        .into_iter()
                        .map(|j| RunnerJob {
                            run_id: run.id,
                            run_name: run.name.clone(),
                            run_status: run.status.clone(),
                            run_conclusion: run.conclusion.clone(),
                            run_url: run.html_url.clone(),
                            job_id: Some(j.id),
                            job_name: Some(j.name),
                            job_status: Some(j.status),
                            job_conclusion: j.conclusion,
                            runner_name: j.runner_name,
                        })
                        .collect()
                }
            }
        });

        let nested: Vec<Vec<RunnerJob>> = futures::future::join_all(futs).await;
        let mut jobs: Vec<RunnerJob> = nested.into_iter().flatten().collect();
        // Prefer jobs that actually ran on this runner
        jobs.sort_by_key(|j| j.job_id.is_none());
        jobs.truncate(40);

        Ok(json!({"ok": true, "jobs": jobs}))
    }

    pub async fn sync_now(&self) -> Result<Value> {
        let n = self
            .sync
            .sync_once(true)
            .await
            .map_err(DevForgeError::Message)?;
        Ok(json!({"ok": true, "changed": n}))
    }

    async fn publish_id(&self, id: &str) {
        if let Ok(Some(r)) = self.store.get(id).await {
            self.bus.publish(RunnerEvent::Updated { runner: r });
        }
    }

    fn clone_handles(&self) -> Self {
        Self {
            store: self.store.clone(),
            executor: self.executor.clone(),
            github: self.github.clone(),
            bus: self.bus.clone(),
            sync: self.sync.clone(),
        }
    }
}

fn truncate(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}
