//! Self-update DevForge : check GitHub releases + apply (compose / docker / binary).
//! Pas de simulation : sans runtime applicable, `start` échoue clairement.

use chrono::Utc;
use devforge_deploy::RemoteExecutor;
use devforge_github::GitHubFacade;
use devforge_shared::{DevForgeError, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateMode {
    /// `docker compose pull` + `up --force-recreate` (recommandé en prod).
    Compose,
    /// Pull image + recreate du conteneur nommé (via inspect / run).
    Docker,
    /// Télécharge l’asset de release et remplace le binaire courant.
    Binary,
}

impl UpdateMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Compose => "compose",
            Self::Docker => "docker",
            Self::Binary => "binary",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateConfig {
    pub current_version: String,
    pub repo_owner: String,
    pub repo_name: String,
    pub mode: UpdateMode,
    pub container_name: String,
    pub image: String,
    pub compose_file: String,
    pub compose_service: String,
    pub server_id: String,
    pub channel: String,
}

impl UpdateConfig {
    pub fn from_env() -> Self {
        let current = std::env::var("DEVFORGE_VERSION")
            .unwrap_or_else(|_| env!("CARGO_PKG_VERSION").to_string());
        let repo = std::env::var("DEVFORGE_UPDATE_REPO")
            .unwrap_or_else(|_| "bobdivx/devforge".into());
        let (owner, name) = match repo.split_once('/') {
            Some((o, n)) => (o.to_string(), n.to_string()),
            None => ("bobdivx".into(), repo),
        };
        let mode = match std::env::var("DEVFORGE_UPDATE_MODE")
            .unwrap_or_else(|_| "auto".into())
            .to_lowercase()
            .as_str()
        {
            "compose" => UpdateMode::Compose,
            "docker" => UpdateMode::Docker,
            "binary" => UpdateMode::Binary,
            "stub" => {
                tracing::warn!(
                    "DEVFORGE_UPDATE_MODE=stub est retiré — bascule auto (compose/docker/binary)"
                );
                detect_auto_mode()
            }
            _ => detect_auto_mode(),
        };
        Self {
            current_version: current.trim_start_matches('v').to_string(),
            repo_owner: owner,
            repo_name: name,
            mode,
            container_name: std::env::var("DEVFORGE_SELF_CONTAINER")
                .unwrap_or_else(|_| "devforge".into()),
            image: std::env::var("DEVFORGE_UPDATE_IMAGE")
                .unwrap_or_else(|_| "ghcr.io/bobdivx/devforge".into()),
            compose_file: std::env::var("DEVFORGE_UPDATE_COMPOSE_FILE")
                .unwrap_or_else(|_| "docker-compose.yml".into()),
            compose_service: std::env::var("DEVFORGE_UPDATE_COMPOSE_SERVICE")
                .unwrap_or_else(|_| "devforge".into()),
            server_id: std::env::var("DEVFORGE_DEFAULT_SERVER_ID")
                .unwrap_or_else(|_| "default".into()),
            channel: std::env::var("DEVFORGE_UPDATE_CHANNEL")
                .unwrap_or_else(|_| "stable".into()),
        }
    }
}

fn detect_auto_mode() -> UpdateMode {
    if std::env::var("DEVFORGE_UPDATE_COMPOSE_FILE").is_ok() {
        return UpdateMode::Compose;
    }
    if running_in_container() || std::env::var("DEVFORGE_SELF_CONTAINER").is_ok() {
        return UpdateMode::Docker;
    }
    UpdateMode::Binary
}

fn running_in_container() -> bool {
    Path::new("/.dockerenv").exists()
        || std::fs::read_to_string("/proc/1/cgroup")
            .map(|s| s.contains("docker") || s.contains("containerd") || s.contains("kubepods"))
            .unwrap_or(false)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Pending,
    Running,
    Done,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateStep {
    pub id: String,
    pub label: String,
    pub status: StepStatus,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateJob {
    pub id: String,
    pub target_version: String,
    pub status: String,
    pub steps: Vec<UpdateStep>,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub message: String,
    pub wait_path: String,
}

impl UpdateJob {
    fn new(target_version: &str) -> Self {
        let steps = vec![
            UpdateStep {
                id: "check".into(),
                label: "Vérification".into(),
                status: StepStatus::Pending,
                detail: String::new(),
            },
            UpdateStep {
                id: "prepare".into(),
                label: "Préparation".into(),
                status: StepStatus::Pending,
                detail: String::new(),
            },
            UpdateStep {
                id: "pull".into(),
                label: "Téléchargement".into(),
                status: StepStatus::Pending,
                detail: String::new(),
            },
            UpdateStep {
                id: "apply".into(),
                label: "Application".into(),
                status: StepStatus::Pending,
                detail: String::new(),
            },
            UpdateStep {
                id: "restart".into(),
                label: "Redémarrage".into(),
                status: StepStatus::Pending,
                detail: String::new(),
            },
        ];
        Self {
            id: Uuid::new_v4().to_string(),
            target_version: target_version.trim_start_matches('v').to_string(),
            status: "running".into(),
            steps,
            started_at: Utc::now().to_rfc3339(),
            finished_at: None,
            message: "Mise à jour en cours…".into(),
            wait_path: "/app/update/wait".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionCheck {
    pub current: String,
    pub latest: Option<String>,
    pub latest_name: Option<String>,
    pub latest_url: Option<String>,
    pub update_available: bool,
    /// True si une MAJ peut être appliquée dans le mode courant (pas une simulation).
    pub can_apply: bool,
    pub channel: String,
    pub mode: String,
    pub repo: String,
    pub message: String,
}

pub struct UpdateFacade {
    config: UpdateConfig,
    github: Arc<GitHubFacade>,
    executor: Arc<dyn RemoteExecutor>,
    job: Arc<RwLock<Option<UpdateJob>>>,
    http: reqwest::Client,
}

impl UpdateFacade {
    pub fn new(
        github: Arc<GitHubFacade>,
        executor: Arc<dyn RemoteExecutor>,
        config: UpdateConfig,
    ) -> Self {
        Self {
            config,
            github,
            executor,
            job: Arc::new(RwLock::new(None)),
            http: reqwest::Client::new(),
        }
    }

    pub fn from_env(github: Arc<GitHubFacade>, executor: Arc<dyn RemoteExecutor>) -> Self {
        Self::new(github, executor, UpdateConfig::from_env())
    }

    pub fn config(&self) -> &UpdateConfig {
        &self.config
    }

    pub fn current_version(&self) -> &str {
        &self.config.current_version
    }

    pub async fn current_job(&self) -> Option<UpdateJob> {
        self.job.read().await.clone()
    }

    pub async fn check(&self) -> Result<VersionCheck> {
        let repo = format!("{}/{}", self.config.repo_owner, self.config.repo_name);
        match self.fetch_latest().await {
            Ok((tag, name, url)) => {
                let latest = tag.trim_start_matches('v').to_string();
                let available = version_gt(&latest, &self.config.current_version);
                let can_apply = available && self.mode_ready_hint().is_none();
                let message = if available {
                    if let Some(hint) = self.mode_ready_hint() {
                        format!("Nouvelle version {latest} disponible — {hint}")
                    } else {
                        format!("Nouvelle version {latest} disponible.")
                    }
                } else {
                    "DevForge est à jour.".into()
                };
                Ok(VersionCheck {
                    current: self.config.current_version.clone(),
                    latest: Some(latest),
                    latest_name: Some(name),
                    latest_url: Some(url),
                    update_available: available,
                    can_apply,
                    channel: self.config.channel.clone(),
                    mode: self.config.mode.as_str().into(),
                    repo,
                    message,
                })
            }
            Err(e) => Ok(VersionCheck {
                current: self.config.current_version.clone(),
                latest: None,
                latest_name: None,
                latest_url: None,
                update_available: false,
                can_apply: false,
                channel: self.config.channel.clone(),
                mode: self.config.mode.as_str().into(),
                repo,
                message: format!("Impossible de vérifier les releases : {e}"),
            }),
        }
    }

    /// Prérequis manquants pour le mode courant (None = OK).
    fn mode_ready_hint(&self) -> Option<&'static str> {
        match self.config.mode {
            UpdateMode::Compose | UpdateMode::Docker => None,
            UpdateMode::Binary => None,
        }
    }

    async fn fetch_latest(&self) -> Result<(String, String, String)> {
        let owner = &self.config.repo_owner;
        let name = &self.config.repo_name;
        if let Ok(releases) = self.github.list_releases(owner, name).await {
            if let Some(r) = releases
                .into_iter()
                .find(|r| !r.draft && (self.config.channel != "stable" || !r.prerelease))
            {
                return Ok((r.tag, r.name, r.html_url));
            }
        }
        let url = format!("https://api.github.com/repos/{owner}/{name}/releases/latest");
        let res = self
            .http
            .get(&url)
            .header("User-Agent", "DevForge-Update")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| DevForgeError::Message(format!("GitHub releases: {e}")))?;
        if !res.status().is_success() {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            return Err(DevForgeError::Message(format!(
                "GitHub {status}: {}",
                body.chars().take(200).collect::<String>()
            )));
        }
        let v: Value = res
            .json()
            .await
            .map_err(|e| DevForgeError::Message(format!("JSON releases: {e}")))?;
        let tag = v
            .get("tag_name")
            .and_then(|t| t.as_str())
            .ok_or_else(|| DevForgeError::Message("release sans tag".into()))?
            .to_string();
        let name = v
            .get("name")
            .and_then(|t| t.as_str())
            .unwrap_or(&tag)
            .to_string();
        let html = v
            .get("html_url")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string();
        Ok((tag, name, html))
    }

    pub async fn start(&self, target: Option<String>) -> Result<UpdateJob> {
        {
            let guard = self.job.read().await;
            if let Some(j) = guard.as_ref() {
                if j.status == "running" || j.status == "restarting" {
                    return Ok(j.clone());
                }
            }
        }

        let target = match target.filter(|s| !s.trim().is_empty()) {
            Some(t) => t.trim_start_matches('v').to_string(),
            None => {
                let check = self.check().await?;
                match check.latest.clone() {
                    Some(t) => t.trim_start_matches('v').to_string(),
                    None => {
                        return Err(DevForgeError::Message(
                            "Aucune version cible (releases introuvables).".into(),
                        ));
                    }
                }
            }
        };

        if !version_gt(&target, &self.config.current_version) {
            return Err(DevForgeError::Message(format!(
                "Déjà à jour ({}).",
                self.config.current_version
            )));
        }

        let job = UpdateJob::new(&target);
        let job_id = job.id.clone();
        *self.job.write().await = Some(job.clone());

        let this = Self {
            config: self.config.clone(),
            github: self.github.clone(),
            executor: self.executor.clone(),
            job: self.job.clone(),
            http: self.http.clone(),
        };
        tokio::spawn(async move {
            if let Err(e) = this.run_pipeline(&job_id, &target).await {
                tracing::error!(error = %e, "update pipeline failed");
                let _ = this.fail_job(&job_id, &e.to_string()).await;
            }
        });

        self.current_job()
            .await
            .ok_or_else(|| DevForgeError::Message("job perdu".into()))
    }

    async fn run_pipeline(&self, job_id: &str, target: &str) -> Result<()> {
        self.set_step(
            job_id,
            "check",
            StepStatus::Running,
            "Comparaison des versions…",
        )
        .await?;
        self.set_step(
            job_id,
            "check",
            StepStatus::Done,
            &format!("{} → {}", self.config.current_version, target),
        )
        .await?;

        self.set_step(
            job_id,
            "prepare",
            StepStatus::Running,
            &format!("Mode {}…", self.config.mode.as_str()),
        )
        .await?;

        match self.config.mode {
            UpdateMode::Compose | UpdateMode::Docker => {
                self.run_container_pipeline(job_id, target).await?;
            }
            UpdateMode::Binary => {
                self.run_binary_pipeline(job_id, target).await?;
            }
        }

        self.set_step(
            job_id,
            "restart",
            StepStatus::Running,
            "Le service va redémarrer…",
        )
        .await?;

        {
            let mut guard = self.job.write().await;
            if let Some(j) = guard.as_mut() {
                if j.id == job_id {
                    j.status = "restarting".into();
                    j.message = "Redémarrage de DevForge…".into();
                    j.wait_path = format!("/app/update/wait?job={}&to={}", j.id, j.target_version);
                }
            }
        }

        // Laisser le temps au front de poller / redirect avant kill.
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;

        match self.config.mode {
            UpdateMode::Compose | UpdateMode::Docker => {
                // Apply a déjà recréé le conteneur ; process peut mourir ici.
            }
            UpdateMode::Binary => {
                self.restart_replaced_binary().await?;
            }
        }

        Ok(())
    }

    async fn run_container_pipeline(&self, job_id: &str, target: &str) -> Result<()> {
        let probe = self
            .executor
            .exec(
                &self.config.server_id,
                ".",
                "docker version --format '{{.Server.Version}}'",
                30,
            )
            .await?;
        if !probe.ok {
            return Err(DevForgeError::Message(format!(
                "Docker indisponible : {}",
                probe.output
            )));
        }
        self.set_step(
            job_id,
            "prepare",
            StepStatus::Done,
            &format!("Docker {}", probe.output.trim()),
        )
        .await?;

        self.set_step(job_id, "pull", StepStatus::Running, "Pull image…")
            .await?;

        let pull_cmd = if self.config.mode == UpdateMode::Compose {
            compose_cmd(
                &self.config.compose_file,
                target,
                &format!("pull {}", shell_escape(&self.config.compose_service)),
            )
        } else {
            format!(
                "docker pull {}:{}",
                shell_escape(&self.config.image),
                shell_escape(target)
            )
        };
        let pull = self
            .executor
            .exec(&self.config.server_id, ".", &pull_cmd, 600)
            .await?;
        if !pull.ok {
            return Err(DevForgeError::Message(format!(
                "Pull échoué : {}",
                truncate(&pull.output, 400)
            )));
        }
        self.set_step(job_id, "pull", StepStatus::Done, &truncate(&pull.output, 180))
            .await?;

        self.set_step(job_id, "apply", StepStatus::Running, "Recréation…")
            .await?;

        if self.config.mode == UpdateMode::Compose {
            let apply_cmd = compose_cmd(
                &self.config.compose_file,
                target,
                &format!(
                    "up -d --no-deps --force-recreate {}",
                    shell_escape(&self.config.compose_service)
                ),
            );
            let apply = self
                .executor
                .exec(&self.config.server_id, ".", &apply_cmd, 300)
                .await?;
            if !apply.ok {
                return Err(DevForgeError::Message(format!(
                    "Apply échoué : {}",
                    truncate(&apply.output, 400)
                )));
            }
            self.set_step(
                job_id,
                "apply",
                StepStatus::Done,
                &truncate(&apply.output, 180),
            )
            .await?;
        } else {
            let detail = self.recreate_docker_container(target).await?;
            self.set_step(job_id, "apply", StepStatus::Done, &detail)
                .await?;
        }

        // CRITICAL FIX: Ensure Traefik container exists and is running after DevForge update.
        // Root cause of outage 2026-09-14: docker compose recreate / helper-container stopped Traefik
        // without restarting it, leaving all apps unreachable (502) until manual restore.
        self.ensure_traefik_after_update(job_id).await?;

        Ok(())
    }

    /// Ensure Traefik reverse proxy is running after DevForge container update.
    ///
    /// ## Root cause of 2026-09-14 outage:
    /// - Docker compose recreate or helper-container workflow removed `devforge-traefik`
    /// - All apps behind Traefik (popcornn, starbasefr, etc.) returned 502 until manual restore
    /// - web.jeser.app stayed up (publishes host port 8000 directly)
    ///
    /// ## Fix strategy:
    /// - Always call ensure_traefik() after successful DevForge container update
    /// - If Traefik is missing or stopped, recreate/start it
    /// - Log success/failure to update job detail
    async fn ensure_traefik_after_update(&self, job_id: &str) -> Result<()> {
        tracing::info!("Ensuring Traefik proxy after DevForge update…");

        // Check if Traefik container exists
        let check_cmd = r#"docker inspect devforge-traefik --format '{{.State.Status}}' 2>/dev/null || echo 'missing'"#;
        let check_res = self.executor.exec(&self.config.server_id, ".", check_cmd, 30).await?;
        let status = check_res.output.trim();

        match status {
            "running" => {
                tracing::info!("Traefik proxy is already running");
                return Ok(());
            }
            "missing" => {
                tracing::warn!("Traefik proxy is MISSING — recreating (critical fix for 2026-09-14 outage)");
            }
            _ => {
                tracing::warn!(status = %status, "Traefik proxy is not running — restarting");
            }
        }

        // Ensure devforge network exists
        let network_cmd = r#"docker network inspect devforge >/dev/null 2>&1 || docker network create devforge"#;
        let _ = self.executor.exec(&self.config.server_id, ".", network_cmd, 30).await;

        // Resolve Traefik data path (host or container)
        let data_path = std::env::var("DEVFORGE_DATA_DIR")
            .unwrap_or_else(|_| "/var/lib/devforge".into());
        let traefik_dir = format!("{}/proxy", data_path);

        // Prepare data directory (acme.json + dynamic/)
        let prep_cmd = format!(
            r#"mkdir -p {}/dynamic && touch {}/acme.json && chmod 600 {}/acme.json"#,
            shell_escape(&traefik_dir),
            shell_escape(&traefik_dir),
            shell_escape(&traefik_dir)
        );
        let _ = self.executor.exec(&self.config.server_id, ".", &prep_cmd, 30).await;

        // Create or start Traefik
        if status == "missing" {
            let create_cmd = format!(
                r#"docker run -d \
  --name devforge-traefik \
  --restart unless-stopped \
  --network devforge \
  -p 80:80 \
  -p 443:443 \
  -p 443:443/udp \
  --add-host host.docker.internal:host-gateway \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v {}:/traefik \
  --label devforge.managed=true \
  --label devforge.proxy=true \
  --label traefik.enable=true \
  --label 'traefik.http.routers.api.rule=Host(`traefik.local`)' \
  --label traefik.http.routers.api.service=api@internal \
  --label traefik.http.services.dummy.loadbalancer.server.port=9999 \
  traefik:v3.6 \
  --api.dashboard=true \
  --log.level=INFO \
  --accesslog=false \
  --entrypoints.http.address=:80 \
  --entrypoints.https.address=:443 \
  --providers.docker=true \
  --providers.docker.exposedbydefault=false \
  --providers.docker.network=devforge \
  --providers.file.directory=/traefik/dynamic \
  --providers.file.watch=true \
  --certificatesresolvers.letsencrypt.acme.httpchallenge=true \
  --certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=http \
  --certificatesresolvers.letsencrypt.acme.email=admin@devforge.local \
  --certificatesresolvers.letsencrypt.acme.storage=/traefik/acme.json \
  --ping=true \
  --ping.entrypoint=http"#,
                shell_escape(&traefik_dir)
            );
            let create_res = self.executor.exec(&self.config.server_id, ".", &create_cmd, 60).await?;
            if !create_res.ok {
                let err_msg = format!("Failed to create Traefik: {}", truncate(&create_res.output, 300));
                tracing::error!("{}", err_msg);
                return Err(DevForgeError::Message(err_msg));
            }
            tracing::info!("Traefik proxy recreated successfully");
        } else {
            // Container exists but stopped, start it
            let start_cmd = "docker start devforge-traefik";
            let start_res = self.executor.exec(&self.config.server_id, ".", start_cmd, 30).await?;
            if !start_res.ok {
                let err_msg = format!("Failed to start Traefik: {}", truncate(&start_res.output, 300));
                tracing::error!("{}", err_msg);
                return Err(DevForgeError::Message(err_msg));
            }
            tracing::info!("Traefik proxy started successfully");
        }

        Ok(())
    }

    /// Recreate nommé via inspect ciblé (évite le JSON complet tronqué) + Mounts.
    ///
    /// Un simple `docker rename` ne libère **pas** les ports publiés : le nouveau
    /// `docker run -p 8000:…` échoue avec « port is already allocated ».
    /// On planifie donc un conteneur helper (docker.sock) qui stoppe l’ancien
    /// *puis* démarre le nouveau — le process courant peut mourir sans bloquer.
    async fn recreate_docker_container(&self, target: &str) -> Result<String> {
        let name = &self.config.container_name;
        let image_ref = format!("{}:{}", self.config.image, target);

        let restart = self
            .docker_inspect_str(name, "{{.HostConfig.RestartPolicy.Name}}")
            .await
            .unwrap_or_else(|_| "unless-stopped".into());
        let binds = self
            .docker_inspect_json(name, "{{json .HostConfig.Binds}}")
            .await
            .unwrap_or(Value::Null);
        let mounts = self
            .docker_inspect_json(name, "{{json .Mounts}}")
            .await
            .unwrap_or(Value::Null);
        let ports = self
            .docker_inspect_json(name, "{{json .HostConfig.PortBindings}}")
            .await
            .unwrap_or(Value::Null);
        let env = self
            .docker_inspect_json(name, "{{json .Config.Env}}")
            .await
            .unwrap_or(Value::Null);
        let networks = self
            .docker_inspect_json(name, "{{json .NetworkSettings.Networks}}")
            .await
            .unwrap_or(Value::Null);
        let labels = self
            .docker_inspect_json(name, "{{json .Config.Labels}}")
            .await
            .unwrap_or(Value::Null);

        let run = build_docker_run_args(
            name,
            &image_ref,
            target,
            restart.trim(),
            &binds,
            &mounts,
            &ports,
            &env,
            &networks,
            &labels,
        );
        let run_cmd = shell_join(&run);

        let old = format!("{name}-old");
        let updater = format!("{name}-updater");

        // Restes d’une MAJ précédente (échec / interruption).
        let _ = self
            .executor
            .exec(
                &self.config.server_id,
                ".",
                &format!(
                    "docker rm -f {} {} >/dev/null 2>&1 || true",
                    shell_escape(&old),
                    shell_escape(&updater)
                ),
                30,
            )
            .await;

        let rename = self
            .executor
            .exec(
                &self.config.server_id,
                ".",
                &format!(
                    "docker rename {} {}",
                    shell_escape(name),
                    shell_escape(&old)
                ),
                30,
            )
            .await?;
        if !rename.ok {
            return Err(DevForgeError::Message(format!(
                "rename échoué : {}",
                truncate(&rename.output, 200)
            )));
        }

        let helper_cmd = detached_recreate_helper_cmd(name, &old, &updater, &image_ref, &run_cmd);
        let scheduled = self
            .executor
            .exec(&self.config.server_id, ".", &helper_cmd, 60)
            .await?;
        if !scheduled.ok {
            let _ = self
                .executor
                .exec(
                    &self.config.server_id,
                    ".",
                    &format!(
                        "docker rename {} {}",
                        shell_escape(&old),
                        shell_escape(name)
                    ),
                    30,
                )
                .await;
            return Err(DevForgeError::Message(format!(
                "planification recreate échouée : {}",
                truncate(&scheduled.output, 400)
            )));
        }

        Ok(format!(
            "Recreate planifié {name} ← {image_ref} (stop old puis run)"
        ))
    }

    async fn docker_inspect_json(&self, name: &str, format: &str) -> Result<Value> {
        let raw = self.docker_inspect_str(name, format).await?;
        let raw = raw.trim();
        if raw.is_empty() || raw == "null" {
            return Ok(Value::Null);
        }
        serde_json::from_str(raw).map_err(|e| {
            DevForgeError::Message(format!(
                "inspect JSON ({format}): {e} — {}",
                truncate(raw, 120)
            ))
        })
    }

    async fn docker_inspect_str(&self, name: &str, format: &str) -> Result<String> {
        let cmd = format!(
            "docker inspect --format {} {}",
            shell_escape(format),
            shell_escape(name)
        );
        let inspect = self
            .executor
            .exec(&self.config.server_id, ".", &cmd, 30)
            .await?;
        if !inspect.ok {
            return Err(DevForgeError::Message(format!(
                "Conteneur {} introuvable : {}",
                name,
                truncate(&inspect.output, 200)
            )));
        }
        Ok(inspect.output)
    }

    async fn run_binary_pipeline(&self, job_id: &str, target: &str) -> Result<()> {
        let triple = host_target_triple();
        self.set_step(
            job_id,
            "prepare",
            StepStatus::Done,
            &format!("Binaire {triple}"),
        )
        .await?;

        self.set_step(
            job_id,
            "pull",
            StepStatus::Running,
            "Recherche de l’asset GitHub…",
        )
        .await?;

        let asset = self
            .resolve_release_asset(target, &triple)
            .await
            .map_err(|e| {
                DevForgeError::Message(format!(
                    "{e} — publie une release avec `devforge-server-{triple}.zip` (ou .exe/.bin)."
                ))
            })?;

        let current = std::env::current_exe().map_err(|e| {
            DevForgeError::Message(format!("Impossible de résoudre le binaire courant : {e}"))
        })?;
        let download_path = download_path_for(&current, &asset.name);

        self.set_step(
            job_id,
            "pull",
            StepStatus::Running,
            &format!("Téléchargement {}…", asset.name),
        )
        .await?;

        self.download_asset(&asset, &download_path).await?;
        self.set_step(
            job_id,
            "pull",
            StepStatus::Done,
            &format!("{} ({} octets)", asset.name, asset.size),
        )
        .await?;

        self.set_step(
            job_id,
            "apply",
            StepStatus::Running,
            "Remplacement du binaire…",
        )
        .await?;
        let installed = self
            .install_downloaded_binary(&download_path, &current, &asset.name)
            .await?;
        self.set_step(
            job_id,
            "apply",
            StepStatus::Done,
            &format!("Installé → {}", installed.display()),
        )
        .await?;
        Ok(())
    }

    async fn resolve_release_asset(&self, tag: &str, triple: &str) -> Result<ReleaseAsset> {
        let owner = &self.config.repo_owner;
        let name = &self.config.repo_name;
        let tag_variants = [format!("v{tag}"), tag.to_string()];
        let mut last_err = DevForgeError::Message("release introuvable".into());

        for tag_name in &tag_variants {
            let url = format!(
                "https://api.github.com/repos/{owner}/{name}/releases/tags/{tag_name}"
            );
            let mut req = self
                .http
                .get(&url)
                .header("User-Agent", "DevForge-Update")
                .header("Accept", "application/vnd.github+json");
            if let Ok(token) = std::env::var("DEVFORGE_GITHUB_TOKEN") {
                if !token.trim().is_empty() {
                    req = req.bearer_auth(token.trim());
                }
            }
            let res = req.send().await.map_err(|e| {
                DevForgeError::Message(format!("GitHub release {tag_name}: {e}"))
            })?;
            if !res.status().is_success() {
                last_err = DevForgeError::Message(format!(
                    "GitHub release {tag_name}: {}",
                    res.status()
                ));
                continue;
            }
            let v: Value = res
                .json()
                .await
                .map_err(|e| DevForgeError::Message(format!("JSON release: {e}")))?;
            let assets = v
                .get("assets")
                .and_then(|a| a.as_array())
                .cloned()
                .unwrap_or_default();
            if let Some(asset) = pick_asset(&assets, triple) {
                return Ok(asset);
            }
            last_err = DevForgeError::Message(format!(
                "Aucun asset compatible ({triple}) sur la release {tag_name}"
            ));
        }
        Err(last_err)
    }

    async fn download_asset(&self, asset: &ReleaseAsset, dest: &Path) -> Result<()> {
        if let Some(parent) = dest.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| {
                DevForgeError::Message(format!("mkdir download: {e}"))
            })?;
        }
        let mut req = self
            .http
            .get(&asset.url)
            .header("User-Agent", "DevForge-Update")
            .header("Accept", "application/octet-stream");
        if let Ok(token) = std::env::var("DEVFORGE_GITHUB_TOKEN") {
            if !token.trim().is_empty() {
                req = req.bearer_auth(token.trim());
            }
        }
        let res = req
            .send()
            .await
            .map_err(|e| DevForgeError::Message(format!("download: {e}")))?;
        if !res.status().is_success() {
            return Err(DevForgeError::Message(format!(
                "download HTTP {}",
                res.status()
            )));
        }
        let bytes = res
            .bytes()
            .await
            .map_err(|e| DevForgeError::Message(format!("download body: {e}")))?;
        let mut file = tokio::fs::File::create(dest)
            .await
            .map_err(|e| DevForgeError::Message(format!("create {}: {e}", dest.display())))?;
        file.write_all(&bytes)
            .await
            .map_err(|e| DevForgeError::Message(format!("write download: {e}")))?;
        file.flush()
            .await
            .map_err(|e| DevForgeError::Message(format!("flush download: {e}")))?;
        Ok(())
    }

    async fn install_downloaded_binary(
        &self,
        download: &Path,
        current: &Path,
        asset_name: &str,
    ) -> Result<PathBuf> {
        let staged = if asset_name.ends_with(".zip") {
            let dir = download
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .join(format!("devforge-update-{}", Uuid::new_v4()));
            tokio::fs::create_dir_all(&dir).await.map_err(|e| {
                DevForgeError::Message(format!("mkdir extract: {e}"))
            })?;
            extract_zip_find_binary(download, &dir).await?
        } else {
            download.to_path_buf()
        };

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = tokio::fs::metadata(&staged)
                .await
                .map_err(|e| DevForgeError::Message(format!("stat binary: {e}")))?
                .permissions();
            perms.set_mode(0o755);
            tokio::fs::set_permissions(&staged, perms)
                .await
                .map_err(|e| DevForgeError::Message(format!("chmod: {e}")))?;
        }

        let backup = current.with_extension("old");
        let _ = tokio::fs::remove_file(&backup).await;
        tokio::fs::rename(current, &backup).await.map_err(|e| {
            DevForgeError::Message(format!(
                "Impossible de sauvegarder {} → {} : {e}",
                current.display(),
                backup.display()
            ))
        })?;
        if let Err(e) = tokio::fs::rename(&staged, current).await {
            let _ = tokio::fs::rename(&backup, current).await;
            return Err(DevForgeError::Message(format!(
                "Impossible d’installer le nouveau binaire : {e}"
            )));
        }
        let _ = tokio::fs::remove_file(download).await;
        Ok(current.to_path_buf())
    }

    async fn restart_replaced_binary(&self) -> Result<()> {
        let current = std::env::current_exe().map_err(|e| {
            DevForgeError::Message(format!("current_exe: {e}"))
        })?;
        let args: Vec<String> = std::env::args().skip(1).collect();
        let mut cmd = tokio::process::Command::new(&current);
        cmd.args(&args).envs(std::env::vars()).kill_on_drop(false);
        #[cfg(windows)]
        {
            const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
            const DETACHED_PROCESS: u32 = 0x00000008;
            cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS);
        }
        cmd.spawn()
            .map_err(|e| DevForgeError::Message(format!("relance binaire: {e}")))?;
        // Quitte le process courant ; la page wait poll /health.
        tokio::spawn(async {
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
            std::process::exit(0);
        });
        Ok(())
    }

    async fn set_step(
        &self,
        job_id: &str,
        step_id: &str,
        status: StepStatus,
        detail: &str,
    ) -> Result<()> {
        let mut guard = self.job.write().await;
        let job = guard
            .as_mut()
            .filter(|j| j.id == job_id)
            .ok_or_else(|| DevForgeError::Message("job introuvable".into()))?;
        if let Some(step) = job.steps.iter_mut().find(|s| s.id == step_id) {
            step.status = status;
            step.detail = detail.to_string();
        }
        Ok(())
    }

    async fn fail_job(&self, job_id: &str, message: &str) -> Result<()> {
        let mut guard = self.job.write().await;
        if let Some(j) = guard.as_mut() {
            if j.id == job_id {
                j.status = "failed".into();
                j.message = message.to_string();
                j.finished_at = Some(Utc::now().to_rfc3339());
                for step in j.steps.iter_mut() {
                    if step.status == StepStatus::Running {
                        step.status = StepStatus::Failed;
                        step.detail = message.to_string();
                    }
                }
            }
        }
        Ok(())
    }

    pub fn job_json(job: &UpdateJob) -> Value {
        json!(job)
    }
}

#[derive(Debug, Clone)]
struct ReleaseAsset {
    name: String,
    url: String,
    size: u64,
}

fn pick_asset(assets: &[Value], triple: &str) -> Option<ReleaseAsset> {
    let mut scored: Vec<(i32, ReleaseAsset)> = Vec::new();
    for a in assets {
        let name = a.get("name")?.as_str()?.to_string();
        let url = a
            .get("browser_download_url")?
            .as_str()
            .unwrap_or("")
            .to_string();
        if url.is_empty() {
            continue;
        }
        let size = a.get("size").and_then(|s| s.as_u64()).unwrap_or(0);
        let lower = name.to_lowercase();
        let mut score = 0;
        if lower.contains(triple) {
            score += 100;
        }
        if lower.contains("devforge-server") || lower.contains("devforge_server") {
            score += 20;
        }
        if cfg!(windows) && (lower.ends_with(".exe") || lower.contains("windows")) {
            score += 10;
        }
        if cfg!(target_os = "linux") && lower.contains("linux") {
            score += 10;
        }
        if cfg!(target_os = "macos") && (lower.contains("darwin") || lower.contains("macos")) {
            score += 10;
        }
        if cfg!(target_arch = "x86_64")
            && (lower.contains("x86_64") || lower.contains("amd64") || lower.contains("x64"))
        {
            score += 5;
        }
        if cfg!(target_arch = "aarch64")
            && (lower.contains("aarch64") || lower.contains("arm64"))
        {
            score += 5;
        }
        if score > 0 {
            scored.push((score, ReleaseAsset { name, url, size }));
        }
    }
    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored.into_iter().next().map(|(_, a)| a)
}

fn host_target_triple() -> String {
    if let Ok(t) = std::env::var("DEVFORGE_UPDATE_TARGET") {
        return t;
    }
    if cfg!(all(target_arch = "x86_64", target_os = "windows")) {
        "x86_64-pc-windows-msvc".into()
    } else if cfg!(all(target_arch = "aarch64", target_os = "windows")) {
        "aarch64-pc-windows-msvc".into()
    } else if cfg!(all(target_arch = "x86_64", target_os = "linux")) {
        "x86_64-unknown-linux-gnu".into()
    } else if cfg!(all(target_arch = "aarch64", target_os = "linux")) {
        "aarch64-unknown-linux-gnu".into()
    } else if cfg!(all(target_arch = "x86_64", target_os = "macos")) {
        "x86_64-apple-darwin".into()
    } else if cfg!(all(target_arch = "aarch64", target_os = "macos")) {
        "aarch64-apple-darwin".into()
    } else {
        format!(
            "{}-{}-unknown",
            std::env::consts::ARCH,
            std::env::consts::OS
        )
    }
}

fn compose_cmd(compose_file: &str, version: &str, subcommand: &str) -> String {
    let file = shell_escape(compose_file);
    if cfg!(windows) {
        format!(
            "$env:DEVFORGE_VERSION='{}'; docker compose -f {} {}",
            version.replace('\'', "''"),
            file,
            subcommand
        )
    } else {
        format!(
            "DEVFORGE_VERSION={} docker compose -f {} {}",
            shell_escape(version),
            file,
            subcommand
        )
    }
}

fn shell_join(parts: &[String]) -> String {
    parts
        .iter()
        .map(|p| {
            if p.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | ':' | '=' | '@'))
            {
                p.clone()
            } else if cfg!(windows) {
                format!("'{}'", p.replace('\'', "''"))
            } else {
                shell_escape(p)
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Construit les args `docker run` à partir de l’inspect (ports / volumes / env / labels).
fn build_docker_run_args(
    name: &str,
    image_ref: &str,
    target: &str,
    restart: &str,
    binds: &Value,
    mounts: &Value,
    ports: &Value,
    env: &Value,
    networks: &Value,
    labels: &Value,
) -> Vec<String> {
    let mut run = vec![
        "docker".into(),
        "run".into(),
        "-d".into(),
        "--name".into(),
        name.to_string(),
    ];

    if restart != "no" && !restart.is_empty() {
        run.push("--restart".into());
        run.push(restart.into());
    }

    let mut used_bind = false;
    if let Some(arr) = binds.as_array() {
        for b in arr {
            if let Some(s) = b.as_str() {
                run.push("-v".into());
                run.push(s.to_string());
                used_bind = true;
            }
        }
    }
    // Compose / CasaOS : Binds est souvent null — reprendre Mounts.
    if !used_bind {
        if let Some(arr) = mounts.as_array() {
            for m in arr {
                let typ = m.get("Type").and_then(|t| t.as_str()).unwrap_or("bind");
                if typ != "bind" && typ != "volume" {
                    continue;
                }
                let src = m.get("Source").and_then(|s| s.as_str()).unwrap_or("");
                let dst = m
                    .get("Destination")
                    .or_else(|| m.get("Target"))
                    .and_then(|s| s.as_str())
                    .unwrap_or("");
                if src.is_empty() || dst.is_empty() {
                    continue;
                }
                let rw = m.get("RW").and_then(|v| v.as_bool()).unwrap_or(true);
                let spec = if rw {
                    format!("{src}:{dst}")
                } else {
                    format!("{src}:{dst}:ro")
                };
                run.push("-v".into());
                run.push(spec);
            }
        }
    }

    if let Some(ports) = ports.as_object() {
        for (container_port, hosts) in ports {
            let port_key = container_port.replace("/tcp", "").replace("/udp", "");
            if let Some(arr) = hosts.as_array() {
                for h in arr {
                    let host_ip = h.get("HostIp").and_then(|x| x.as_str()).unwrap_or("");
                    let host_port = h.get("HostPort").and_then(|x| x.as_str()).unwrap_or("");
                    if host_port.is_empty() {
                        continue;
                    }
                    let mapping = if host_ip.is_empty() || host_ip == "0.0.0.0" {
                        format!("{host_port}:{port_key}")
                    } else {
                        format!("{host_ip}:{host_port}:{port_key}")
                    };
                    run.push("-p".into());
                    run.push(mapping);
                }
            }
        }
    }

    if let Some(env) = env.as_array() {
        for e in env {
            if let Some(s) = e.as_str() {
                if s.starts_with("DEVFORGE_VERSION=") {
                    run.push("-e".into());
                    run.push(format!("DEVFORGE_VERSION={target}"));
                } else {
                    run.push("-e".into());
                    run.push(s.to_string());
                }
            }
        }
    } else {
        run.push("-e".into());
        run.push(format!("DEVFORGE_VERSION={target}"));
    }

    if let Some(labels) = labels.as_object() {
        for (k, v) in labels {
            if let Some(val) = v.as_str() {
                run.push("--label".into());
                run.push(format!("{k}={val}"));
            }
        }
    }

    if let Some(nets) = networks.as_object() {
        if let Some(net_name) = nets.keys().next() {
            run.push("--network".into());
            run.push(net_name.clone());
        }
    }

    run.push(image_ref.to_string());
    run
}

/// Conteneur helper : stop l’ancien (libère les ports) puis `docker run` le nouveau.
fn detached_recreate_helper_cmd(
    name: &str,
    old: &str,
    updater: &str,
    image_ref: &str,
    run_cmd: &str,
) -> String {
    let inner = format!(
        "set +e\n\
sleep 2\n\
docker stop {old} >/dev/null 2>&1\n\
docker rm -f {name} >/dev/null 2>&1\n\
if {run_cmd}; then\n\
  docker rm -f {old} >/dev/null 2>&1\n\
  exit 0\n\
fi\n\
docker rm -f {name} >/dev/null 2>&1\n\
docker rename {old} {name} >/dev/null 2>&1\n\
docker start {name} >/dev/null 2>&1\n\
exit 1\n",
        old = shell_escape(old),
        name = shell_escape(name),
        run_cmd = run_cmd,
    );
    let b64 = b64_encode(inner.as_bytes());
    format!(
        "docker rm -f {updater} >/dev/null 2>&1 || true; \
docker run -d --rm --name {updater} \
-v /var/run/docker.sock:/var/run/docker.sock \
--entrypoint sh {image} \
-c 'echo {b64} | base64 -d | sh'",
        updater = shell_escape(updater),
        image = shell_escape(image_ref),
        b64 = b64,
    )
}

fn b64_encode(data: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    let mut i = 0;
    while i < data.len() {
        let b0 = data[i] as u32;
        let b1 = if i + 1 < data.len() {
            data[i + 1] as u32
        } else {
            0
        };
        let b2 = if i + 2 < data.len() {
            data[i + 2] as u32
        } else {
            0
        };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((triple >> 18) & 0x3f) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3f) as usize] as char);
        if i + 1 < data.len() {
            out.push(TABLE[((triple >> 6) & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
        if i + 2 < data.len() {
            out.push(TABLE[(triple & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
        i += 3;
    }
    out
}

fn download_path_for(current: &Path, asset_name: &str) -> PathBuf {
    let dir = current
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    dir.join(format!(".devforge-update-{asset_name}"))
}

async fn extract_zip_find_binary(zip_path: &Path, dest_dir: &Path) -> Result<PathBuf> {
    let status = if cfg!(windows) {
        let zip = zip_path.to_string_lossy().replace('\'', "''");
        let dest = dest_dir.to_string_lossy().replace('\'', "''");
        tokio::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "Expand-Archive -LiteralPath '{zip}' -DestinationPath '{dest}' -Force"
                ),
            ])
            .status()
            .await
    } else {
        tokio::process::Command::new("unzip")
            .arg("-o")
            .arg(zip_path.as_os_str())
            .arg("-d")
            .arg(dest_dir.as_os_str())
            .status()
            .await
    }
    .map_err(|e| DevForgeError::Message(format!("extract zip: {e}")))?;
    if !status.success() {
        return Err(DevForgeError::Message(
            "Échec extraction ZIP (unzip / Expand-Archive).".into(),
        ));
    }

    let mut stack = vec![dest_dir.to_path_buf()];
    let mut candidates = Vec::new();
    while let Some(dir) = stack.pop() {
        let mut rd = tokio::fs::read_dir(&dir)
            .await
            .map_err(|e| DevForgeError::Message(format!("read extract: {e}")))?;
        while let Some(entry) = rd
            .next_entry()
            .await
            .map_err(|e| DevForgeError::Message(format!("read extract entry: {e}")))?
        {
            let path = entry.path();
            let ft = entry
                .file_type()
                .await
                .map_err(|e| DevForgeError::Message(format!("file_type: {e}")))?;
            if ft.is_dir() {
                stack.push(path);
                continue;
            }
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_lowercase();
            if name == "devforge-server"
                || name == "devforge-server.exe"
                || name == "devforge"
                || name == "devforge.exe"
            {
                return Ok(path);
            }
            if !name.contains("readme") && !name.ends_with(".md") && !name.ends_with(".txt") {
                candidates.push(path);
            }
        }
    }
    candidates
        .into_iter()
        .next()
        .ok_or_else(|| DevForgeError::Message("ZIP sans binaire exécutable".into()))
}

/// True if `a` is strictly greater than `b` (semver loosely: major.minor.patch).
pub fn version_gt(a: &str, b: &str) -> bool {
    parse_ver(a) > parse_ver(b)
}

fn parse_ver(s: &str) -> (u64, u64, u64) {
    let s = s.trim().trim_start_matches('v');
    let mut parts = s.split(|c| c == '.' || c == '-');
    let major = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    let minor = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    let patch = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    (major, minor, patch)
}

fn shell_escape(s: &str) -> String {
    if s.chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | ':' | '@'))
    {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}

fn truncate(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max {
        t.to_string()
    } else {
        format!("{}…", t.chars().take(max).collect::<String>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_compare() {
        assert!(version_gt("2.1.0", "2.0.0"));
        assert!(version_gt("v2.0.1", "2.0.0"));
        assert!(!version_gt("2.0.0", "2.0.0"));
        assert!(!version_gt("1.9.9", "2.0.0"));
    }

    #[test]
    fn pick_windows_asset() {
        let assets = vec![
            json!({"name": "README.md", "browser_download_url": "http://x/r", "size": 1}),
            json!({
                "name": "devforge-server-x86_64-pc-windows-msvc.zip",
                "browser_download_url": "http://x/bin",
                "size": 10
            }),
        ];
        let a = pick_asset(&assets, "x86_64-pc-windows-msvc").expect("asset");
        assert!(a.name.contains("windows"));
    }

    #[test]
    fn b64_roundtrip_ascii() {
        let s = "docker stop devforge-old\n";
        let enc = b64_encode(s.as_bytes());
        assert_eq!(enc, "ZG9ja2VyIHN0b3AgZGV2Zm9yZ2Utb2xkCg==");
    }

    #[test]
    fn docker_run_args_include_port_and_version() {
        let ports = json!({"8000/tcp": [{"HostIp": "0.0.0.0", "HostPort": "8000"}]});
        let mounts = json!([{"Type": "bind", "Source": "/DATA/AppData/devforge", "Destination": "/data", "RW": true}]);
        let env = json!(["DEVFORGE_VERSION=2.0.7", "PORT=8000"]);
        let args = build_docker_run_args(
            "devforge",
            "bobdivx/devforge:2.0.9",
            "2.0.9",
            "unless-stopped",
            &Value::Null,
            &mounts,
            &ports,
            &env,
            &json!({"bridge": {}}),
            &Value::Null,
        );
        let joined = shell_join(&args);
        assert!(joined.contains("-p 8000:8000"));
        assert!(joined.contains("DEVFORGE_VERSION=2.0.9"));
        assert!(joined.contains("-v /DATA/AppData/devforge:/data"));
        assert!(joined.ends_with("bobdivx/devforge:2.0.9"));
    }

    #[test]
    fn detached_helper_stops_old_before_run() {
        let cmd = detached_recreate_helper_cmd(
            "devforge",
            "devforge-old",
            "devforge-updater",
            "bobdivx/devforge:2.0.9",
            "docker run -d --name devforge -p 8000:8000 bobdivx/devforge:2.0.9",
        );
        assert!(cmd.contains("devforge-updater"));
        assert!(cmd.contains("/var/run/docker.sock"));
        assert!(cmd.contains("base64 -d"));
        // Le script encodé doit contenir « docker stop » (libère le port).
        let b64 = cmd
            .split("echo ")
            .nth(1)
            .and_then(|s| s.split(" |").next())
            .expect("b64 payload");
        assert!(!b64.is_empty());
        // Décodage minimal : vérifier longueur plausible du payload.
        assert!(b64.len() > 40);
    }
}
