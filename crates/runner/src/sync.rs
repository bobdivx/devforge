use crate::docker::{discovery_command, docker_inspect_running_cmd, parse_docker_ps_json_lines};
use crate::events::RunnerEventBus;
use crate::models::{ManagedRunner, OpStatus, RunnerEvent};
use crate::store::RunnerStore;
use chrono::Utc;
use devforge_deploy::RemoteExecutor;
use devforge_github::{GitHubFacade, RepoRunner};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

pub struct RunnerSyncWorker {
    store: Arc<dyn RunnerStore>,
    executor: Arc<dyn RemoteExecutor>,
    github: Arc<GitHubFacade>,
    bus: RunnerEventBus,
    interval: Duration,
}

impl RunnerSyncWorker {
    pub fn new(
        store: Arc<dyn RunnerStore>,
        executor: Arc<dyn RemoteExecutor>,
        github: Arc<GitHubFacade>,
        bus: RunnerEventBus,
    ) -> Self {
        Self {
            store,
            executor,
            github,
            bus,
            interval: Duration::from_secs(20),
        }
    }

    pub fn with_interval(mut self, interval: Duration) -> Self {
        self.interval = interval;
        self
    }

    pub fn bus(&self) -> RunnerEventBus {
        self.bus.clone()
    }

    pub async fn run_loop(self: Arc<Self>) {
        loop {
            if let Err(e) = self.sync_once(true).await {
                tracing::warn!(error = %e, "runner sync failed");
                self.bus.publish(RunnerEvent::Error {
                    message: e.to_string(),
                });
            }
            tokio::time::sleep(self.interval).await;
        }
    }

    /// Refresh Docker + GitHub status into SQLite snapshot.
    /// If `reconcile`, attempt to recreate missing enabled runners.
    pub async fn sync_once(&self, reconcile: bool) -> Result<usize, String> {
        let runners = self.store.list().await.map_err(|e| e.to_string())?;
        let now = Utc::now().to_rfc3339();

        // Group by server_id for discovery.
        let mut by_server: HashMap<String, Vec<ManagedRunner>> = HashMap::new();
        for r in &runners {
            by_server
                .entry(r.server_id.clone())
                .or_default()
                .push(r.clone());
        }

        let mut docker_by_key: HashMap<String, crate::models::DockerContainerSnapshot> =
            HashMap::new();

        for (server_id, _) in &by_server {
            match self
                .executor
                .exec(server_id, "", &discovery_command(), 25)
                .await
            {
                Ok(res) => {
                    for c in parse_docker_ps_json_lines(&res.output) {
                        docker_by_key.insert(format!("{server_id}:{}", c.name), c);
                    }
                }
                Err(e) => {
                    tracing::warn!(server_id = %server_id, error = %e, "runner docker discovery");
                    for r in by_server.get(server_id).into_iter().flatten() {
                        let _ = self
                            .store
                            .update_live(
                                &r.id,
                                &r.live_state,
                                &r.live_status,
                                r.container_id.as_deref(),
                                r.github_status.as_deref(),
                                r.github_busy,
                                r.github_runner_id,
                                &now,
                                Some(&format!("discovery: {e}")),
                            )
                            .await;
                    }
                }
            }
        }

        // Prefetch GitHub runners per repo (parallel).
        let mut repos: Vec<(String, String)> = runners
            .iter()
            .map(|r| (r.owner.clone(), r.repo.clone()))
            .collect();
        repos.sort();
        repos.dedup();

        let gh = self.github.clone();
        let futs = repos.into_iter().map(|(owner, repo)| {
            let gh = gh.clone();
            async move {
                let list = gh
                    .list_repo_runners(&owner, &repo)
                    .await
                    .unwrap_or_default();
                ((owner, repo), list)
            }
        });
        let gh_results: HashMap<(String, String), Vec<RepoRunner>> =
            futures::future::join_all(futs).await.into_iter().collect();

        let mut changed = 0usize;
        for r in runners {
            let key = format!("{}:{}", r.server_id, r.container_name);
            let docker = docker_by_key.get(&key);

            let (live_state, live_status, container_id) = if let Some(c) = docker {
                (
                    c.state.clone(),
                    c.status.clone(),
                    Some(c.container_id.clone()),
                )
            } else if r.enabled {
                (
                    "missing".to_string(),
                    "Absent — relance prévue".to_string(),
                    None,
                )
            } else {
                ("stopped".to_string(), "Désactivé".to_string(), None)
            };

            let gh_list = gh_results
                .get(&(r.owner.clone(), r.repo.clone()))
                .cloned()
                .unwrap_or_default();
            let match_gh = gh_list.iter().find(|g| {
                g.name.eq_ignore_ascii_case(&r.runner_name)
                    || g.name.eq_ignore_ascii_case(&r.container_name)
            });
            let (github_status, github_busy, github_runner_id) = if let Some(g) = match_gh {
                let mut status = g.status.to_lowercase();
                if g.busy {
                    status = "busy".into();
                }
                (Some(status), Some(g.busy), Some(g.id as i64))
            } else {
                (None, None, None)
            };

            let prev_state = r.live_state.clone();
            let prev_gh = r.github_status.clone();
            let _ = self
                .store
                .update_live(
                    &r.id,
                    &live_state,
                    &live_status,
                    container_id.as_deref(),
                    github_status.as_deref(),
                    github_busy,
                    github_runner_id,
                    &now,
                    None,
                )
                .await;

            if reconcile
                && r.enabled
                && live_state == "missing"
                && r.op_status == OpStatus::Idle.as_str()
            {
                // Soft signal only here — recreate is handled by facade to avoid token races
                // during background loop without auth token resolution failure spam.
                tracing::info!(
                    runner_id = %r.id,
                    container = %r.container_name,
                    "runner missing — awaiting recreate/reconcile"
                );
            } else if reconcile && r.enabled && live_state != "running" && live_state != "missing" {
                // Check inspect running flag for unhealthy restarting containers.
                if let Ok(res) = self
                    .executor
                    .exec(
                        &r.server_id,
                        "",
                        &docker_inspect_running_cmd(&r.container_name),
                        8,
                    )
                    .await
                {
                    if res.output.trim() != "true" && live_state == "exited" {
                        tracing::debug!(
                            runner_id = %r.id,
                            state = %live_state,
                            "runner not running"
                        );
                    }
                }
            }

            if let Ok(Some(updated)) = self.store.get(&r.id).await {
                if prev_state != updated.live_state || prev_gh != updated.github_status {
                    changed += 1;
                    self.bus.publish(RunnerEvent::Updated { runner: updated });
                }
            }
        }

        self.bus.publish(RunnerEvent::SyncDone { count: changed });
        Ok(changed)
    }
}
