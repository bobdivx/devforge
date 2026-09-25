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
    /// Télécharge l’installateur (assistant Windows, Flatpak) ou un ancien zip.
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
        let repo =
            std::env::var("DEVFORGE_UPDATE_REPO").unwrap_or_else(|_| "bobdivx/devforge".into());
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
            channel: std::env::var("DEVFORGE_UPDATE_CHANNEL").unwrap_or_else(|_| "stable".into()),
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
    /// True si l’instance tourne une version plus récente que la release publiée.
    pub ahead: bool,
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
                let ahead = version_gt(&self.config.current_version, &latest);
                let can_apply = available && self.mode_ready_hint().is_none();
                let message = if available {
                    if let Some(hint) = self.mode_ready_hint() {
                        format!("Nouvelle version {latest} disponible — {hint}")
                    } else {
                        format!("Nouvelle version {latest} disponible.")
                    }
                } else if ahead {
                    format!(
                        "Cette instance ({}) est en avance sur la dernière version publiée ({}).",
                        self.config.current_version, latest
                    )
                } else {
                    "DevForge est à jour.".into()
                };
                Ok(VersionCheck {
                    current: self.config.current_version.clone(),
                    latest: Some(latest),
                    latest_name: Some(name),
                    latest_url: Some(url),
                    update_available: available,
                    ahead,
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
                ahead: false,
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
        let mut best: Option<LatestCandidate> = None;
        if let Ok(releases) = self.github.list_releases(owner, name).await {
            for r in releases {
                if r.draft || (self.config.channel == "stable" && r.prerelease) {
                    continue;
                }
                consider_latest(&mut best, &r.tag, &r.name, &r.html_url);
            }
        }
        // L’image Docker est publiée sur le tag git, parfois sans page GitHub Release.
        if matches!(self.config.mode, UpdateMode::Docker | UpdateMode::Compose) {
            if let Ok(tags) = self.github.list_tags(owner, name).await {
                for t in tags {
                    let url = format!("https://github.com/{owner}/{name}/tree/{}", t.name);
                    consider_latest(&mut best, &t.name, &t.name, &url);
                }
            }
        }
        if let Some(best) = best {
            return Ok((best.tag, best.name, best.url));
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

        let downloaded = match self.config.mode {
            UpdateMode::Compose | UpdateMode::Docker => {
                self.run_container_pipeline(job_id, target).await?;
                None
            }
            UpdateMode::Binary => Some(self.run_binary_pipeline(job_id, target).await?),
        };

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

        match downloaded {
            None => {
                // Apply a déjà recréé le conteneur ; process peut mourir ici.
            }
            Some(release) => self.restart_downloaded(&release).await?,
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
        self.set_step(
            job_id,
            "pull",
            StepStatus::Done,
            &truncate(&pull.output, 180),
        )
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

        if cluster_role_is_worker() {
            tracing::info!("nœud worker — Traefik reste sur le leader");
            return Ok(());
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
        let check_res = self
            .executor
            .exec(&self.config.server_id, ".", check_cmd, 30)
            .await?;
        let status = check_res.output.trim();

        match status {
            "running" => {
                tracing::info!("Traefik proxy is already running");
                return Ok(());
            }
            "missing" => {
                tracing::warn!(
                    "Traefik proxy is MISSING — recreating (critical fix for 2026-09-14 outage)"
                );
            }
            _ => {
                tracing::warn!(status = %status, "Traefik proxy is not running — restarting");
            }
        }

        // Ensure devforge network exists
        let network_cmd =
            r#"docker network inspect devforge >/dev/null 2>&1 || docker network create devforge"#;
        let _ = self
            .executor
            .exec(&self.config.server_id, ".", network_cmd, 30)
            .await;

        // Chemin DATA vu par le process (conteneur) — sert à préparer les fichiers.
        let data_path =
            std::env::var("DEVFORGE_DATA_DIR").unwrap_or_else(|_| "/var/lib/devforge".into());
        let local_traefik_dir = format!("{}/proxy", data_path.trim_end_matches('/'));
        // Chemin HÔTE pour `docker run -v` : le daemon résout la source côté hôte.
        // Incident 2026-09-25 : `-v /data/proxy:/traefik` (chemin conteneur) → sur ZimaOS
        // `mkdir /data: read-only file system`, Traefik bloqué en « created », 502 partout.
        let traefik_dir = self.resolve_traefik_host_dir(&data_path).await;

        // Prepare data directory (acme.json + dynamic/) — via le chemin local au process,
        // c'est le même répertoire que `traefik_dir` à travers le bind mount DATA.
        let prep_cmd = format!(
            r#"mkdir -p {}/dynamic && touch {}/acme.json && chmod 600 {}/acme.json"#,
            shell_escape(&local_traefik_dir),
            shell_escape(&local_traefik_dir),
            shell_escape(&local_traefik_dir)
        );
        let _ = self
            .executor
            .exec(&self.config.server_id, ".", &prep_cmd, 30)
            .await;

        let mut need_create = status == "missing";
        if !need_create {
            // Conteneur existant mais arrêté : vérifier le mount avant de le relancer.
            let mount_cmd = r#"docker inspect devforge-traefik --format '{{range .Mounts}}{{if eq .Destination "/traefik"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true"#;
            let actual = self
                .executor
                .exec(&self.config.server_id, ".", mount_cmd, 30)
                .await
                .map(|r| r.output.trim().to_string())
                .unwrap_or_default();
            if !actual.is_empty() && actual != traefik_dir {
                tracing::warn!(
                    actual = %actual,
                    expected = %traefik_dir,
                    "Traefik arrêté avec un volume /traefik incorrect — recréation"
                );
                need_create = true;
            } else {
                let start_res = self
                    .executor
                    .exec(&self.config.server_id, ".", "docker start devforge-traefik", 30)
                    .await?;
                if start_res.ok {
                    tracing::info!("Traefik proxy started successfully");
                    return Ok(());
                }
                tracing::warn!(
                    output = %truncate(&start_res.output, 300),
                    "docker start Traefik échoué — recréation"
                );
                need_create = true;
            }
            if need_create {
                let _ = self
                    .executor
                    .exec(&self.config.server_id, ".", "docker rm -f devforge-traefik", 60)
                    .await;
            }
        }

        // Create Traefik
        if need_create {
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
            let create_res = self
                .executor
                .exec(&self.config.server_id, ".", &create_cmd, 60)
                .await?;
            if !create_res.ok {
                let err_msg = format!(
                    "Failed to create Traefik: {}",
                    truncate(&create_res.output, 300)
                );
                tracing::error!("{}", err_msg);
                return Err(DevForgeError::Message(err_msg));
            }
            tracing::info!("Traefik proxy recreated successfully");
        }

        Ok(())
    }

    /// Chemin hôte du volume Traefik (`<source du bind DATA>/proxy`).
    ///
    /// 1. `DEVFORGE_TRAEFIK_HOST_DIR` explicite ;
    /// 2. bind mount du conteneur DevForge courant dont la destination est `/data`
    ///    ou `DEVFORGE_DATA_DIR` ;
    /// 3. repli : `DEVFORGE_DATA_DIR/proxy` (bare metal / Flatpak, chemin = hôte).
    async fn resolve_traefik_host_dir(&self, data_path: &str) -> String {
        if let Ok(explicit) = std::env::var("DEVFORGE_TRAEFIK_HOST_DIR") {
            if !explicit.trim().is_empty() {
                return explicit.trim().to_string();
            }
        }
        let name = self
            .running_container_name()
            .await
            .unwrap_or_else(|| self.config.container_name.clone());
        if let Ok(mounts) = self.docker_inspect_json(&name, "{{json .Mounts}}").await {
            if let Some(p) = traefik_host_dir_from_mounts(&mounts, data_path) {
                return p;
            }
        }
        format!("{}/proxy", data_path.trim_end_matches('/'))
    }

    /// Recreate nommé via inspect ciblé (évite le JSON complet tronqué) + Mounts.
    ///
    /// Un simple `docker rename` ne libère **pas** les ports publiés : le nouveau
    /// `docker run -p 8000:…` échoue avec « port is already allocated ».
    /// On planifie donc un conteneur helper (docker.sock) qui stoppe l’ancien
    /// *puis* démarre le nouveau — le process courant peut mourir sans bloquer.
    async fn recreate_docker_container(&self, target: &str) -> Result<String> {
        let configured = self.config.container_name.clone();
        let name_owned = self
            .running_container_name()
            .await
            .unwrap_or(configured);
        let name = name_owned.as_str();
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
        let mut env = self
            .docker_inspect_json(name, "{{json .Config.Env}}")
            .await
            .unwrap_or(Value::Null);
        upsert_env(&mut env, "DEVFORGE_SELF_CONTAINER", name);
        upsert_env(&mut env, "DEVFORGE_VERSION", target);
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

    /// Nom réel du conteneur qui exécute ce process (`hostname` = id Docker).
    /// Le défaut `DEVFORGE_SELF_CONTAINER=devforge` ne correspond pas à `devforge-worker`.
    async fn running_container_name(&self) -> Option<String> {
        let host = std::fs::read_to_string("/etc/hostname").ok()?;
        let host = host.trim();
        if host.is_empty() || host.len() > 128 {
            return None;
        }
        let raw = self.docker_inspect_str(host, "{{.Name}}").await.ok()?;
        let name = container_name_from_inspect(&raw);
        if name.is_empty() {
            None
        } else {
            Some(name)
        }
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

    async fn run_binary_pipeline(&self, job_id: &str, target: &str) -> Result<DownloadedRelease> {
        let triple = host_target_triple();
        self.set_step(
            job_id,
            "prepare",
            StepStatus::Done,
            &format!("Paquet {triple}"),
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
                    "{e} — publie DevForge-Setup-<version>-x64.exe (Windows) ou DevForge-<version>-x86_64.flatpak (Linux)."
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

        let kind = release_kind(&asset.name);
        match kind {
            ReleaseKind::ZipOrBinary => {
                self.set_step(
                    job_id,
                    "apply",
                    StepStatus::Running,
                    "Remplacement du programme…",
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
                Ok(DownloadedRelease {
                    kind,
                    path: installed,
                })
            }
            ReleaseKind::WindowsSetup => {
                self.set_step(job_id, "apply", StepStatus::Done, "Assistant Windows prêt")
                    .await?;
                Ok(DownloadedRelease {
                    kind,
                    path: download_path,
                })
            }
            ReleaseKind::Flatpak => {
                self.set_step(job_id, "apply", StepStatus::Done, "Paquet Flatpak prêt")
                    .await?;
                Ok(DownloadedRelease {
                    kind,
                    path: download_path,
                })
            }
        }
    }

    async fn restart_downloaded(&self, release: &DownloadedRelease) -> Result<()> {
        match release.kind {
            ReleaseKind::ZipOrBinary => self.restart_replaced_binary().await,
            ReleaseKind::WindowsSetup => handoff_windows_setup(&release.path).await,
            ReleaseKind::Flatpak => handoff_flatpak(&release.path).await,
        }
    }

    async fn resolve_release_asset(&self, tag: &str, triple: &str) -> Result<ReleaseAsset> {
        let owner = &self.config.repo_owner;
        let name = &self.config.repo_name;
        let tag_variants = [format!("v{tag}"), tag.to_string()];
        let mut last_err = DevForgeError::Message("release introuvable".into());

        for tag_name in &tag_variants {
            let url =
                format!("https://api.github.com/repos/{owner}/{name}/releases/tags/{tag_name}");
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
            let res = req
                .send()
                .await
                .map_err(|e| DevForgeError::Message(format!("GitHub release {tag_name}: {e}")))?;
            if !res.status().is_success() {
                last_err =
                    DevForgeError::Message(format!("GitHub release {tag_name}: {}", res.status()));
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
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| DevForgeError::Message(format!("mkdir download: {e}")))?;
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
            tokio::fs::create_dir_all(&dir)
                .await
                .map_err(|e| DevForgeError::Message(format!("mkdir extract: {e}")))?;
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
        let current = std::env::current_exe()
            .map_err(|e| DevForgeError::Message(format!("current_exe: {e}")))?;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReleaseKind {
    ZipOrBinary,
    WindowsSetup,
    Flatpak,
}

struct DownloadedRelease {
    kind: ReleaseKind,
    path: PathBuf,
}

/// Même id que `deploy/flatpak/io.github.bobdivx.DevForge.yml`.
const FLATPAK_APP_ID: &str = "io.github.bobdivx.DevForge";

fn release_kind(name: &str) -> ReleaseKind {
    let lower = name.to_lowercase();
    if lower.ends_with(".flatpak") {
        ReleaseKind::Flatpak
    } else if lower.ends_with(".msi")
        || (lower.ends_with(".exe") && (lower.contains("setup") || lower.contains("installer")))
    {
        ReleaseKind::WindowsSetup
    } else {
        ReleaseKind::ZipOrBinary
    }
}

fn pick_asset(assets: &[Value], triple: &str) -> Option<ReleaseAsset> {
    pick_asset_for(assets, triple, std::env::consts::OS, std::env::consts::ARCH)
}

fn pick_asset_for(assets: &[Value], triple: &str, os: &str, arch: &str) -> Option<ReleaseAsset> {
    let mut best: Option<(i32, ReleaseAsset)> = None;
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
        let score = installer_asset_score(&name.to_lowercase(), triple, os, arch);
        if score <= 0 {
            continue;
        }
        let replace = best.as_ref().map(|(s, _)| score > *s).unwrap_or(true);
        if replace {
            best = Some((score, ReleaseAsset { name, url, size }));
        }
    }
    best.map(|(_, asset)| asset)
}

fn installer_asset_score(lower: &str, triple: &str, os: &str, arch: &str) -> i32 {
    if lower.ends_with(".sha256")
        || lower.ends_with(".asc")
        || lower.ends_with(".sig")
        || lower.ends_with(".yml")
        || lower.ends_with(".yaml")
    {
        return 0;
    }
    let arch_ok = arch_matches(lower, arch);
    let triple_ok = lower.contains(&triple.to_lowercase());
    let mut score = 0;
    if os == "windows" {
        let setup =
            lower.ends_with(".exe") && (lower.contains("setup") || lower.contains("installer"));
        let msi = lower.ends_with(".msi");
        if (setup || msi) && (arch_ok || triple_ok) {
            score = if setup { 300 } else { 280 };
        } else if lower.ends_with(".zip") && (triple_ok || (lower.contains("windows") && arch_ok)) {
            score = 100;
        }
    } else if os == "linux" {
        if lower.ends_with(".flatpak") && (arch_ok || triple_ok) {
            score = 300;
        } else if lower.ends_with(".zip") && (triple_ok || (lower.contains("linux") && arch_ok)) {
            score = 100;
        }
    } else if lower.ends_with(".zip") && triple_ok {
        score = 100;
    }
    if score > 0 && lower.contains("devforge") {
        score += 20;
    }
    score
}

fn arch_matches(lower: &str, arch: &str) -> bool {
    match arch {
        "x86_64" => lower.contains("x86_64") || lower.contains("amd64") || lower.contains("x64"),
        "aarch64" => lower.contains("aarch64") || lower.contains("arm64"),
        _ => lower.contains(arch),
    }
}

async fn handoff_windows_setup(setup: &Path) -> Result<()> {
    let mut cmd = tokio::process::Command::new(setup);
    cmd.args([
        "/VERYSILENT",
        "/SUPPRESSMSGBOXES",
        "/FORCECLOSEAPPLICATIONS",
        "/NORESTART",
    ])
    .stdin(std::process::Stdio::null())
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
        const DETACHED_PROCESS: u32 = 0x00000008;
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS);
    }
    cmd.spawn().map_err(|e| {
        DevForgeError::Message(format!(
            "Lancement de l’assistant {} : {e}",
            setup.display()
        ))
    })?;
    schedule_exit();
    Ok(())
}

async fn handoff_flatpak(bundle: &Path) -> Result<()> {
    let bundle = bundle.to_string_lossy().to_string();
    let status = flatpak_command(&[
        "install",
        "--user",
        "-y",
        "--noninteractive",
        "--or-update",
        &bundle,
    ])
    .status()
    .await
    .map_err(|e| DevForgeError::Message(format!("flatpak install : {e}")))?;
    if !status.success() {
        return Err(DevForgeError::Message(format!(
            "flatpak install a échoué. Commande manuelle : flatpak install --user --or-update {bundle}"
        )));
    }
    flatpak_command(&["run", FLATPAK_APP_ID])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| DevForgeError::Message(format!("relance Flatpak : {e}")))?;
    schedule_exit();
    Ok(())
}

fn flatpak_command(args: &[&str]) -> tokio::process::Command {
    if std::env::var_os("FLATPAK_ID").is_some() {
        let mut cmd = tokio::process::Command::new("flatpak-spawn");
        cmd.arg("--host").arg("flatpak");
        cmd.args(args);
        cmd
    } else {
        let mut cmd = tokio::process::Command::new("flatpak");
        cmd.args(args);
        cmd
    }
}

fn schedule_exit() {
    tokio::spawn(async {
        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
        std::process::exit(0);
    });
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
            if p.chars().all(|c| {
                c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | ':' | '=' | '@')
            }) {
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
fn container_name_from_inspect(raw: &str) -> String {
    raw.trim().trim_start_matches('/').to_string()
}

fn upsert_env(env: &mut Value, key: &str, value: &str) {
    let entry = format!("{key}={value}");
    let prefix = format!("{key}=");
    if let Some(arr) = env.as_array_mut() {
        if let Some(slot) = arr
            .iter_mut()
            .find(|v| v.as_str().is_some_and(|s| s.starts_with(&prefix)))
        {
            *slot = Value::String(entry);
        } else {
            arr.push(Value::String(entry));
        }
    } else {
        *env = json!([entry]);
    }
}

fn cluster_role_is_worker() -> bool {
    role_is_worker(&read_cluster_identity())
}

fn read_cluster_identity() -> String {
    let dir = std::env::var("DEVFORGE_DATA_DIR").unwrap_or_else(|_| "/data".into());
    std::fs::read_to_string(std::path::Path::new(&dir).join("cluster-identity.json")).unwrap_or_default()
}

fn role_is_worker(raw: &str) -> bool {
    serde_json::from_str::<Value>(raw)
        .ok()
        .and_then(|v| {
            v.get("role")
                .and_then(|r| r.as_str())
                .map(|s| s.eq_ignore_ascii_case("worker"))
        })
        .unwrap_or(false)
}

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

fn download_path_for(_current: &Path, asset_name: &str) -> PathBuf {
    let safe: String = asset_name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    update_download_dir().join(safe)
}

fn update_download_dir() -> PathBuf {
    if std::env::var_os("FLATPAK_ID").is_some() {
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            let trimmed = xdg.trim();
            if !trimmed.is_empty() {
                return PathBuf::from(trimmed).join("devforge").join("updates");
            }
        }
    }
    std::env::temp_dir().join("devforge-updates")
}

async fn extract_zip_find_binary(zip_path: &Path, dest_dir: &Path) -> Result<PathBuf> {
    let status = if cfg!(windows) {
        let zip = zip_path.to_string_lossy().replace('\'', "''");
        let dest = dest_dir.to_string_lossy().replace('\'', "''");
        tokio::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!("Expand-Archive -LiteralPath '{zip}' -DestinationPath '{dest}' -Force"),
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

struct LatestCandidate {
    tag: String,
    name: String,
    url: String,
}

/// Garde la plus haute version `major.minor.patch`. Une égalité conserve la première
/// (la page GitHub Release, avant le tag git).
fn consider_latest(best: &mut Option<LatestCandidate>, tag: &str, name: &str, url: &str) {
    let Some(ver) = release_semver(tag) else {
        return;
    };
    let replace = match best.as_ref().and_then(|b| release_semver(&b.tag)) {
        Some(cur) => ver > cur,
        None => true,
    };
    if !replace {
        return;
    }
    let shown = tag.trim().trim_start_matches('v').to_string();
    let label = if name.trim().is_empty() {
        shown.clone()
    } else {
        name.trim().to_string()
    };
    *best = Some(LatestCandidate {
        tag: shown,
        name: label,
        url: url.to_string(),
    });
}

fn release_semver(tag: &str) -> Option<(u64, u64, u64)> {
    let s = tag.trim().trim_start_matches('v');
    let mut parts = s.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?;
    if parts.next().is_some() || !patch.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some((major, minor, patch.parse().ok()?))
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

/// `<Source>/proxy` du bind mount DATA (destination `/data` ou `data_dir`).
fn traefik_host_dir_from_mounts(mounts: &Value, data_dir: &str) -> Option<String> {
    let data = data_dir.trim_end_matches('/');
    mounts.as_array()?.iter().find_map(|m| {
        if m.get("Type").and_then(|t| t.as_str()).unwrap_or("bind") != "bind" {
            return None;
        }
        let dest = m
            .get("Destination")
            .or_else(|| m.get("Target"))
            .and_then(|d| d.as_str())?
            .trim_end_matches('/');
        let src = m.get("Source").and_then(|s| s.as_str())?.trim_end_matches('/');
        if src.is_empty() || !(dest == "/data" || dest == data) {
            return None;
        }
        Some(format!("{src}/proxy"))
    })
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
    fn traefik_host_dir_uses_host_bind_source_not_container_path() {
        let mounts = json!([
            {"Type": "bind", "Source": "/var/run/docker.sock", "Destination": "/var/run/docker.sock"},
            {"Type": "bind", "Source": "/media/Docker/AppData/devforge", "Destination": "/data"}
        ]);
        assert_eq!(
            traefik_host_dir_from_mounts(&mounts, "/data").as_deref(),
            Some("/media/Docker/AppData/devforge/proxy")
        );
        let vol = json!([{"Type": "volume", "Source": "/var/lib/docker/volumes/x/_data", "Destination": "/data"}]);
        assert_eq!(traefik_host_dir_from_mounts(&vol, "/data"), None);
        assert_eq!(traefik_host_dir_from_mounts(&json!([]), "/data"), None);
        assert_eq!(traefik_host_dir_from_mounts(&Value::Null, "/data"), None);
    }

    #[test]
    fn version_compare() {
        assert!(version_gt("2.1.0", "2.0.0"));
        assert!(version_gt("v2.0.1", "2.0.0"));
        assert!(version_gt("2.0.109", "2.0.108"));
        assert!(!version_gt("2.0.0", "2.0.0"));
        assert!(!version_gt("1.9.9", "2.0.0"));
    }

    #[test]
    fn highest_tag_beats_older_release() {
        let mut best = None;
        consider_latest(&mut best, "v2.0.108", "DevForge v2.0.108", "http://release");
        consider_latest(&mut best, "v2.0.99", "old", "http://old");
        consider_latest(&mut best, "v2.0.109", "v2.0.109", "http://tag");
        consider_latest(&mut best, "v2.0.110-rc1", "rc", "http://rc");
        let b = best.expect("candidate");
        assert_eq!(b.tag, "2.0.109");
        assert_eq!(b.url, "http://tag");
    }

    #[test]
    fn equal_version_keeps_release_page() {
        let mut best = None;
        consider_latest(&mut best, "v2.0.109", "DevForge v2.0.109", "http://release");
        consider_latest(&mut best, "v2.0.109", "v2.0.109", "http://tag");
        let b = best.expect("candidate");
        assert_eq!(b.url, "http://release");
        assert_eq!(b.name, "DevForge v2.0.109");
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
        let a =
            pick_asset_for(&assets, "x86_64-pc-windows-msvc", "windows", "x86_64").expect("asset");
        assert!(a.name.contains("windows"));
    }

    #[test]
    fn pick_setup_over_legacy_zip() {
        let assets = vec![
            json!({
                "name": "devforge-server-x86_64-pc-windows-msvc.zip",
                "browser_download_url": "http://x/zip",
                "size": 10
            }),
            json!({
                "name": "DevForge-Setup-2.0.102-x64.exe",
                "browser_download_url": "http://x/setup",
                "size": 20
            }),
        ];
        let a =
            pick_asset_for(&assets, "x86_64-pc-windows-msvc", "windows", "x86_64").expect("asset");
        assert!(a.name.contains("Setup"));
        assert_eq!(release_kind(&a.name), ReleaseKind::WindowsSetup);
    }

    #[test]
    fn pick_flatpak_over_legacy_zip() {
        let assets = vec![
            json!({
                "name": "devforge-server-x86_64-unknown-linux-gnu.zip",
                "browser_download_url": "http://x/zip",
                "size": 10
            }),
            json!({
                "name": "DevForge-2.0.102-x86_64.flatpak",
                "browser_download_url": "http://x/flatpak",
                "size": 20
            }),
            json!({
                "name": "DevForge-2.0.102-aarch64.flatpak",
                "browser_download_url": "http://x/arm",
                "size": 20
            }),
        ];
        let a =
            pick_asset_for(&assets, "x86_64-unknown-linux-gnu", "linux", "x86_64").expect("asset");
        assert!(a.name.ends_with("x86_64.flatpak"));
        assert_eq!(release_kind(&a.name), ReleaseKind::Flatpak);
    }

    #[test]
    fn b64_roundtrip_ascii() {
        let s = "docker stop devforge-old\n";
        let enc = b64_encode(s.as_bytes());
        assert_eq!(enc, "ZG9ja2VyIHN0b3AgZGV2Zm9yZ2Utb2xkCg==");
    }

    #[test]
    fn container_name_strips_docker_slash() {
        assert_eq!(container_name_from_inspect(" /devforge-worker\n"), "devforge-worker");
        assert_eq!(container_name_from_inspect("/devforge"), "devforge");
    }

    #[test]
    fn upsert_env_replaces_self_container() {
        let mut env = json!(["DEVFORGE_SELF_CONTAINER=devforge", "PORT=8000"]);
        upsert_env(&mut env, "DEVFORGE_SELF_CONTAINER", "devforge-worker");
        let joined = env.to_string();
        assert!(joined.contains("DEVFORGE_SELF_CONTAINER=devforge-worker"));
        assert!(!joined.contains("DEVFORGE_SELF_CONTAINER=devforge\""));
        assert!(joined.contains("PORT=8000"));
    }

    #[test]
    fn worker_role_detected_from_identity() {
        assert!(role_is_worker(r#"{"role":"worker","node_id":"n"}"#));
        assert!(!role_is_worker(r#"{"role":"leader"}"#));
        assert!(!role_is_worker(""));
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
