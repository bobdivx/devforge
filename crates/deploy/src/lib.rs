use async_trait::async_trait;
use devforge_shared::{DevForgeError, ProjectTestContext, Result};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

pub mod builders;
pub mod docker;
pub mod ssh;

pub use ssh::{LocalShellExecutor, SshRemoteExecutor, SshTarget};

#[derive(Debug, Clone, Serialize)]
pub struct ExecResult {
    pub ok: bool,
    pub exit_code: i32,
    pub output: String,
}

#[async_trait]
pub trait RemoteExecutor: Send + Sync {
    async fn exec(
        &self,
        server_id: &str,
        workdir: &str,
        command: &str,
        timeout_secs: u64,
    ) -> Result<ExecResult>;
}

pub struct StubRemoteExecutor {
    scripted: HashMap<String, ExecResult>,
}

impl StubRemoteExecutor {
    pub fn new() -> Self {
        Self {
            scripted: HashMap::new(),
        }
    }

    pub fn with_script(mut self, key: impl Into<String>, result: ExecResult) -> Self {
        self.scripted.insert(key.into(), result);
        self
    }
}

impl Default for StubRemoteExecutor {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl RemoteExecutor for StubRemoteExecutor {
    async fn exec(
        &self,
        server_id: &str,
        workdir: &str,
        command: &str,
        _timeout_secs: u64,
    ) -> Result<ExecResult> {
        let key = format!("{server_id}|{workdir}|{command}");
        if let Some(r) = self.scripted.get(&key) {
            return Ok(r.clone());
        }
        Ok(ExecResult {
            ok: true,
            exit_code: 0,
            output: format!(
                "[stub] server={server_id} workdir={workdir}\n$ {command}\nOK (stub executor)"
            ),
        })
    }
}

/// Build executor from env:
/// - `DEVFORGE_EXECUTOR=local|ssh|stub` (default: **auto**)
/// - auto: SSH if `DEVFORGE_SSH_HOST`, sinon **local** (jamais de stub silencieux)
/// - `stub` uniquement pour tests / CI explicite
pub fn executor_from_env() -> (Arc<dyn RemoteExecutor>, &'static str) {
    let mode = std::env::var("DEVFORGE_EXECUTOR")
        .unwrap_or_else(|_| "auto".into())
        .to_lowercase();
    match mode.as_str() {
        "local" => (Arc::new(LocalShellExecutor), "local"),
        "ssh" => match SshRemoteExecutor::from_env() {
            Some(e) => (Arc::new(e), "ssh"),
            None => {
                tracing::error!(
                    "DEVFORGE_EXECUTOR=ssh sans DEVFORGE_SSH_HOST — fallback local (pas de stub)"
                );
                (Arc::new(LocalShellExecutor), "local")
            }
        },
        "stub" => (Arc::new(StubRemoteExecutor::new()), "stub"),
        _ => {
            if let Some(e) = SshRemoteExecutor::from_env() {
                (Arc::new(e), "ssh")
            } else {
                (Arc::new(LocalShellExecutor), "local")
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DeployStatus {
    pub project_uuid: String,
    pub phase: String,
    pub healthy: bool,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct DeployRequest {
    pub project_uuid: String,
    pub server_id: String,
    pub workdir: String,
    pub git_repository: String,
    pub git_branch: String,
    pub build_pack: String,
    pub port: u16,
    pub base_directory: String,
    pub docker_compose_location: Option<String>,
    pub publish_directory: Option<String>,
    pub is_static: bool,
    pub github_token: Option<String>,
    pub env_file: Option<String>,
    /// Labels Traefik (tous les hosts) appliqués au `docker run`.
    pub proxy_labels: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeployResult {
    pub ok: bool,
    pub git_sha: Option<String>,
    pub logs: String,
}

fn data_dir_base() -> std::path::PathBuf {
    if let Ok(v) = std::env::var("DEVFORGE_DATA_DIR") {
        return std::path::PathBuf::from(v);
    }
    std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("data")
}

fn resolve_workdir(workdir: &str, project_uuid: &str) -> String {
    let w = workdir.trim();
    // Unix-style /data/... paths are remapped on Windows to a local data dir.
    let needs_local = w.is_empty()
        || (cfg!(windows) && (w.starts_with('/') || w.starts_with("/data")));
    let path = if needs_local {
        data_dir_base().join("applications").join(project_uuid)
    } else {
        std::path::PathBuf::from(w)
    };
    // Absolute path avoids cmd.exe quoting bugs with relative `data/...`.
    let abs = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("."))
            .join(path)
    };
    abs.to_string_lossy().to_string()
}

/// Résout le workdir projet (remap `/data/...` → local sous Windows).
pub fn resolve_project_workdir(workdir: &str, project_uuid: &str) -> String {
    resolve_workdir(workdir, project_uuid)
}

fn git_clone_url(repo: &str, token: Option<&str>) -> String {
    let repo = repo.trim().trim_end_matches(".git");
    let https = if repo.starts_with("http://") || repo.starts_with("https://") {
        format!("{repo}.git")
    } else if repo.contains("github.com/") {
        if repo.starts_with("git@") {
            // git@github.com:owner/repo → https
            let path = repo.split(':').nth(1).unwrap_or(repo);
            format!("https://github.com/{}.git", path.trim_end_matches(".git"))
        } else {
            format!("https://{}.git", repo.trim_start_matches("https://"))
        }
    } else {
        // owner/repo
        format!("https://github.com/{repo}.git")
    };
    if let Some(t) = token.filter(|t| !t.is_empty()) {
        https.replacen("https://", &format!("https://x-access-token:{t}@"), 1)
    } else {
        https
    }
}

fn git_sync_command(workdir: &str, clone_url: &str, branch: &str) -> String {
    let w = shell_single_quote(workdir);
    let url = shell_single_quote(clone_url);
    let b = shell_single_quote(branch);
    if cfg!(windows) {
        // LocalShellExecutor runs via PowerShell — keep native PS syntax.
        let wp = workdir.replace('\'', "''");
        let up = clone_url.replace('\'', "''").replace('"', "");
        let bp = branch.replace('\'', "''");
        format!(
            "if (Test-Path -LiteralPath '{wp}\\.git') {{ git -C '{wp}' fetch origin; if ($LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }}; git -C '{wp}' checkout '{bp}'; if ($LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }}; git -C '{wp}' reset --hard origin/{bp}; exit $LASTEXITCODE }} else {{ git clone --branch '{bp}' --single-branch '{up}' '{wp}'; exit $LASTEXITCODE }}"
        )
    } else {
        format!(
            "if [ -d {w}/.git ]; then git -C {w} fetch origin && git -C {w} checkout {b} && git -C {w} reset --hard origin/{b}; else git clone --branch {b} --single-branch {url} {w}; fi"
        )
    }
}

fn shell_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

fn trim_out(s: &str) -> String {
    s.chars().take(2000).collect()
}

fn pid_path(build_dir: &str) -> std::path::PathBuf {
    std::path::Path::new(build_dir).join(".devforge.pid")
}

fn stop_local_runtime(build_dir: &str, port: u16) -> std::result::Result<(), String> {
    let pid_file = pid_path(build_dir);
    if let Ok(txt) = std::fs::read_to_string(&pid_file) {
        if let Ok(pid) = txt.trim().parse::<u32>() {
            #[cfg(windows)]
            {
                let _ = std::process::Command::new("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .output();
            }
            #[cfg(not(windows))]
            {
                let _ = std::process::Command::new("kill")
                    .args(["-9", &pid.to_string()])
                    .output();
            }
        }
        let _ = std::fs::remove_file(&pid_file);
    }
    // Best-effort free port (Windows)
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "Get-NetTCPConnection -LocalPort {port} -ErrorAction SilentlyContinue | ForEach-Object {{ Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }}"
                ),
            ])
            .output();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("fuser")
            .args([format!("{port}/tcp"), "-k".into()])
            .output();
    }
    std::thread::sleep(std::time::Duration::from_millis(400));
    Ok(())
}

fn spawn_local_runtime(build_dir: &str, port: u16) -> std::result::Result<u32, String> {
    use std::process::{Command, Stdio};
    let dir = std::path::Path::new(build_dir);
    let out = std::fs::File::create(dir.join(".devforge.out")).map_err(|e| e.to_string())?;
    let err = std::fs::File::create(dir.join(".devforge.err")).map_err(|e| e.to_string())?;
    let entry = dir.join("dist/server/entry.mjs");
    let mut cmd = if entry.is_file() {
        let mut c = Command::new("node");
        c.arg(&entry);
        c
    } else if cfg!(windows) {
        let mut c = Command::new("npm.cmd");
        c.args(["run", "start"]);
        c
    } else {
        let mut c = Command::new("npm");
        c.args(["run", "start"]);
        c
    };
    cmd.current_dir(dir)
        .env("HOST", "0.0.0.0")
        .env("PORT", port.to_string())
        .env("NODE_ENV", "production")
        .stdin(Stdio::null())
        .stdout(Stdio::from(out))
        .stderr(Stdio::from(err));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        const DETACHED_PROCESS: u32 = 0x00000008;
        cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
    }
    let child = cmd.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    let pid = child.id();
    std::fs::write(pid_path(build_dir), pid.to_string()).map_err(|e| e.to_string())?;
    // Detach: drop Child without wait
    std::mem::forget(child);
    Ok(pid)
}

fn pid_is_alive(build_dir: &str) -> bool {
    let Ok(txt) = std::fs::read_to_string(pid_path(build_dir)) else {
        return false;
    };
    let Ok(pid) = txt.trim().parse::<u32>() else {
        return false;
    };
    #[cfg(windows)]
    {
        std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        std::path::Path::new(&format!("/proc/{pid}")).exists()
    }
}

async fn probe_local_http(port: u16) -> std::result::Result<String, String> {
    match tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::net::TcpStream::connect(("127.0.0.1", port)),
    )
    .await
    {
        Ok(Ok(_)) => Ok("200".into()),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err("timeout".into()),
    }
}

pub struct DeployFacade {
    executor: Arc<dyn RemoteExecutor>,
}

impl DeployFacade {
    pub fn new(executor: Arc<dyn RemoteExecutor>) -> Self {
        Self { executor }
    }

    pub fn executor(&self) -> Arc<dyn RemoteExecutor> {
        self.executor.clone()
    }

    fn container_name(project_uuid: &str) -> String {
        format!("df-{}", project_uuid.chars().take(12).collect::<String>())
    }

    fn image_name(project_uuid: &str) -> String {
        format!("df-{}:latest", project_uuid.chars().take(12).collect::<String>())
    }

    pub async fn run_tests(&self, project: &ProjectTestContext) -> Value {
        let server_id = project.server_id.trim();
        let workdir = project.workdir.trim();
        let command = project.test_command.trim();

        if server_id.is_empty() {
            return json!({ "ok": false, "error": "server_id manquant sur le projet." });
        }
        if workdir.is_empty() {
            return json!({
                "ok": false,
                "error": "workdir manquant. Déclarez le répertoire de travail du projet (pas de scan magique).",
                "hint": "PATCH /api/v1/projects/{uuid} avec workdir"
            });
        }
        if command.is_empty() {
            return json!({
                "ok": false,
                "error": "test_command manquant. Déclarez la commande de tests du projet.",
                "hint": "PATCH /api/v1/projects/{uuid} avec test_command"
            });
        }

        let timeout = project.timeout.unwrap_or(180).clamp(30, 300);
        match self
            .executor
            .exec(server_id, workdir, command, timeout)
            .await
        {
            Ok(raw) => {
                let output: String = raw.output.chars().take(8000).collect();
                json!({
                    "ok": raw.ok,
                    "exit_code": raw.exit_code,
                    "output": output,
                    "workdir": workdir,
                    "command": command,
                    "project_uuid": project.project_uuid,
                    "server_id": server_id,
                })
            }
            Err(e) => json!({ "ok": false, "error": e.to_string() }),
        }
    }

    pub async fn build(&self, project: &ProjectTestContext, git_sha: Option<&str>) -> Value {
        let sha = git_sha.unwrap_or("HEAD");
        let image = Self::image_name(&project.project_uuid);
        let cmd = docker::docker_build(".", &image, "Dockerfile");
        match self.run_lifecycle(project, &cmd).await {
            Ok(r) => json!({
                "ok": r.ok,
                "phase": "build",
                "git_sha": sha,
                "image": image,
                "command": cmd,
                "output": r.output,
                "project_uuid": project.project_uuid
            }),
            Err(e) => json!({"ok": false, "phase": "build", "error": e.to_string()}),
        }
    }

    pub async fn start(&self, project: &ProjectTestContext) -> Value {
        let name = Self::container_name(&project.project_uuid);
        let image = Self::image_name(&project.project_uuid);
        let stop = docker::docker_stop(&name);
        let run = docker::docker_run(&name, &image, &[(8080, 80)], None);
        let cmd = format!("{stop} 2>/dev/null; {run}");
        match self.run_lifecycle(project, &cmd).await {
            Ok(r) => json!({
                "ok": r.ok,
                "phase": "start",
                "container": name,
                "command": cmd,
                "output": r.output,
                "project_uuid": project.project_uuid
            }),
            Err(e) => json!({"ok": false, "phase": "start", "error": e.to_string()}),
        }
    }

    /// Full deploy: sync git → build → start (selon build_pack).
    pub async fn deploy(&self, req: &DeployRequest) -> DeployResult {
        let mut logs = String::new();
        let workdir = resolve_workdir(&req.workdir, &req.project_uuid);
        let server = if req.server_id.trim().is_empty() {
            "default"
        } else {
            req.server_id.trim()
        };

        logs.push_str(&format!(
            "[devforge] deploy {} ({})\n[devforge] workdir={workdir}\n",
            req.project_uuid, req.build_pack
        ));

        // Prefer local fs mkdir (avoids Windows cmd quoting); fall back to remote mkdir.
        if let Err(fs_e) = std::fs::create_dir_all(&workdir) {
            let mkdir = if cfg!(windows) {
                format!(
                    "New-Item -ItemType Directory -Force -Path '{p}' | Out-Null",
                    p = workdir.replace('\'', "''")
                )
            } else {
                format!("mkdir -p {}", shell_single_quote(&workdir))
            };
            match self.executor.exec(server, "", &mkdir, 60).await {
                Ok(r) => logs.push_str(&format!("[mkdir] {}\n", trim_out(&r.output))),
                Err(e) => {
                    return DeployResult {
                        ok: false,
                        git_sha: None,
                        logs: format!("{logs}[error] mkdir: {e} / {fs_e}\n"),
                    };
                }
            }
        } else {
            logs.push_str("[mkdir] ok\n");
        }

        // Sync git
        let clone_url = git_clone_url(&req.git_repository, req.github_token.as_deref());
        let branch = if req.git_branch.trim().is_empty() {
            "main"
        } else {
            req.git_branch.trim()
        };
        let sync_cmd = git_sync_command(&workdir, &clone_url, branch);
        match self.executor.exec(server, "", &sync_cmd, 600).await {
            Ok(r) => {
                logs.push_str(&format!(
                    "[git] exit={} {}\n",
                    r.exit_code,
                    trim_out(&r.output)
                ));
                if !r.ok {
                    return DeployResult {
                        ok: false,
                        git_sha: None,
                        logs,
                    };
                }
            }
            Err(e) => {
                return DeployResult {
                    ok: false,
                    git_sha: None,
                    logs: format!("{logs}[git] error: {e}\n"),
                };
            }
        }

        let sha = match self
            .executor
            .exec(server, &workdir, "git rev-parse --short HEAD", 30)
            .await
        {
            Ok(r) if r.ok => Some(r.output.trim().to_string()),
            _ => None,
        };
        if let Some(ref s) = sha {
            logs.push_str(&format!("[git] HEAD={s}\n"));
        }

        // Write env file if provided (local filesystem; remote uses printf)
        if let Some(ref env_body) = req.env_file {
            let env_path = std::path::PathBuf::from(&workdir).join(".env");
            if std::fs::write(&env_path, env_body).is_ok() {
                logs.push_str("[env] wrote .env\n");
            } else {
                let escaped = env_body.replace('\'', "'\\''");
                let write_cmd = format!("printf '%s' '{escaped}' > .env");
                match self.executor.exec(server, &workdir, &write_cmd, 30).await {
                    Ok(r) => logs.push_str(&format!(
                        "[env] remote write exit={}\n",
                        r.exit_code
                    )),
                    Err(e) => logs.push_str(&format!("[env] write error: {e}\n")),
                }
            }
        }

        let build_dir = {
            let base = req.base_directory.trim();
            if base.is_empty() || base == "/" {
                workdir.clone()
            } else {
                let b = base.trim_start_matches('/');
                format!("{workdir}/{b}")
            }
        };

        let image = Self::image_name(&req.project_uuid);
        let name = Self::container_name(&req.project_uuid);
        let port = if req.port == 0 { 3000 } else { req.port };

        let docker_ok = self.probe_docker(server, &mut logs).await;
        if !docker_ok {
            logs.push_str("[docker] indisponible — tentative runtime Node local\n");
            if self
                .try_local_node_runtime(server, &build_dir, port, &mut logs)
                .await
            {
                logs.push_str("[devforge] deploy OK (runtime local sans Docker)\n");
                return DeployResult {
                    ok: true,
                    git_sha: sha,
                    logs,
                };
            }
            logs.push_str(
                "[error] Impossible de démarrer l’app en local sans Docker.\n\
                 Options: installer Docker Desktop, ou Settings → serveur SSH (DEVFORGE_SSH_HOST) avec Docker.\n\
                 Pour Node/Astro le fallback local a été tenté (voir logs [local-node]).\n",
            );
            logs.push_str("[devforge] deploy FAILED\n");
            return DeployResult {
                ok: false,
                git_sha: sha,
                logs,
            };
        }

        let build_ok = match req.build_pack.as_str() {
            "dockercompose" => {
                let compose = req
                    .docker_compose_location
                    .as_deref()
                    .unwrap_or("/docker-compose.yaml")
                    .trim_start_matches('/');
                let cmd = docker::docker_compose_up(compose);
                match self.executor.exec(server, &build_dir, &cmd, 900).await {
                    Ok(r) => {
                        logs.push_str(&format!(
                            "[compose] exit={} {}\n",
                            r.exit_code,
                            trim_out(&r.output)
                        ));
                        r.ok
                    }
                    Err(e) => {
                        logs.push_str(&format!("[compose] error: {e}\n"));
                        false
                    }
                }
            }
            "static" => {
                let pub_dir = req
                    .publish_directory
                    .as_deref()
                    .unwrap_or("dist")
                    .trim_start_matches('/');
                let df = docker::static_inline_dockerfile(pub_dir);
                let cmd = if cfg!(windows) {
                    // Windows: prefer project Dockerfile if present; else inline via PS.
                    if std::path::Path::new(&format!("{build_dir}/Dockerfile")).exists() {
                        docker::docker_build(".", &image, "Dockerfile")
                    } else {
                        docker::docker_build_from_content(&image, &df)
                    }
                } else {
                    docker::docker_build_from_content(&image, &df)
                };
                match self.executor.exec(server, &build_dir, &cmd, 900).await {
                    Ok(r) => {
                        logs.push_str(&format!(
                            "[static-build] exit={} {}\n",
                            r.exit_code,
                            trim_out(&r.output)
                        ));
                        if r.ok {
                            self.docker_restart_container(
                                server,
                                &build_dir,
                                &name,
                                &image,
                                port,
                                80,
                                req.proxy_labels.as_ref(),
                                &mut logs,
                            )
                            .await
                        } else {
                            false
                        }
                    }
                    Err(e) => {
                        logs.push_str(&format!("[static-build] error: {e}\n"));
                        false
                    }
                }
            }
            "dockerfile" => {
                let has_df = std::path::Path::new(&format!("{build_dir}/Dockerfile")).is_file();
                let cmd = if has_df {
                    docker::docker_build(".", &image, "Dockerfile")
                } else {
                    logs.push_str(
                        "[dockerfile] pas de Dockerfile — fallback Node inline\n",
                    );
                    docker::docker_build_from_content(
                        &image,
                        &docker::node_inline_dockerfile(port),
                    )
                };
                match self.executor.exec(server, &build_dir, &cmd, 900).await {
                    Ok(r) => {
                        logs.push_str(&format!(
                            "[docker-build] exit={} {}\n",
                            r.exit_code,
                            trim_out(&r.output)
                        ));
                        if r.ok {
                            self.docker_restart_container(
                                server,
                                &build_dir,
                                &name,
                                &image,
                                port,
                                port,
                                req.proxy_labels.as_ref(),
                                &mut logs,
                            )
                            .await
                        } else {
                            false
                        }
                    }
                    Err(e) => {
                        logs.push_str(&format!("[docker-build] error: {e}\n"));
                        false
                    }
                }
            }
            // nixpacks (default) — Docker-first builder image, no host CLI
            _ => {
                let build_envs = builders::collect_build_envs(req.env_file.as_deref());
                let nix = builders::nixpacks_docker_build(&image, &build_envs);
                logs.push_str(&format!(
                    "[nixpacks-docker] image={} envs={}\n",
                    std::env::var("DEVFORGE_NIXPACKS_IMAGE").unwrap_or_else(|_| {
                        builders::DEFAULT_NIXPACKS_IMAGE.to_string()
                    }),
                    build_envs
                        .iter()
                        .map(|(k, _)| k.as_str())
                        .collect::<Vec<_>>()
                        .join(",")
                ));
                match self.executor.exec(server, &build_dir, &nix, 1800).await {
                    Ok(r) if r.ok => {
                        logs.push_str(&format!(
                            "[nixpacks-docker] {}\n",
                            trim_out(&r.output)
                        ));
                        self.docker_restart_container(
                            server,
                            &build_dir,
                            &name,
                            &image,
                            port,
                            port,
                            req.proxy_labels.as_ref(),
                            &mut logs,
                        )
                        .await
                    }
                    Ok(r) => {
                        logs.push_str(&format!(
                            "[nixpacks-docker] exit={} {}\n",
                            r.exit_code,
                            trim_out(&r.output)
                        ));
                        let (cmd, label) =
                            builders::fallback_image_build_cmd(&build_dir, &image, port);
                        logs.push_str(&format!("[fallback] {label}\n"));
                        match self.executor.exec(server, &build_dir, &cmd, 900).await {
                            Ok(r2) => {
                                logs.push_str(&format!(
                                    "[docker-build] exit={} {}\n",
                                    r2.exit_code,
                                    trim_out(&r2.output)
                                ));
                                if r2.ok {
                                    self.docker_restart_container(
                                        server,
                                        &build_dir,
                                        &name,
                                        &image,
                                        port,
                                        port,
                                        req.proxy_labels.as_ref(),
                                        &mut logs,
                                    )
                                    .await
                                } else {
                                    false
                                }
                            }
                            Err(e) => {
                                logs.push_str(&format!("[docker-build] error: {e}\n"));
                                false
                            }
                        }
                    }
                    Err(e) => {
                        logs.push_str(&format!("[nixpacks-docker] error: {e}\n"));
                        let (cmd, label) =
                            builders::fallback_image_build_cmd(&build_dir, &image, port);
                        logs.push_str(&format!("[fallback] {label}\n"));
                        match self.executor.exec(server, &build_dir, &cmd, 900).await {
                            Ok(r2) => {
                                logs.push_str(&format!(
                                    "[docker-build] exit={} {}\n",
                                    r2.exit_code,
                                    trim_out(&r2.output)
                                ));
                                if r2.ok {
                                    self.docker_restart_container(
                                        server,
                                        &build_dir,
                                        &name,
                                        &image,
                                        port,
                                        port,
                                        req.proxy_labels.as_ref(),
                                        &mut logs,
                                    )
                                    .await
                                } else {
                                    false
                                }
                            }
                            Err(e2) => {
                                logs.push_str(&format!("[docker-build] error: {e2}\n"));
                                false
                            }
                        }
                    }
                }
            }
        };

        let build_ok = if build_ok {
            true
        } else {
            logs.push_str(
                "[fallback] Docker build KO — tentative runtime Node local (dernier recours)\n",
            );
            self.try_local_node_runtime(server, &build_dir, port, &mut logs)
                .await
        };

        logs.push_str(if build_ok {
            "[devforge] deploy OK\n"
        } else {
            "[devforge] deploy FAILED\n"
        });

        DeployResult {
            ok: build_ok,
            git_sha: sha,
            logs,
        }
    }

    async fn probe_docker(&self, server: &str, logs: &mut String) -> bool {
        let cmd = if cfg!(windows) {
            r#"
$ErrorActionPreference = 'Stop'
$candidates = @(
  (Get-Command docker -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
  "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin\docker.exe",
  'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
) | Where-Object { $_ -and (Test-Path $_) }
if (-not $candidates) { Write-Error 'docker missing'; exit 1 }
& $candidates[0] version --format '{{.Server.Version}}'
"#
            .to_string()
        } else {
            "command -v docker >/dev/null && docker version --format '{{.Server.Version}}'".into()
        };
        match self.executor.exec(server, "", &cmd, 30).await {
            Ok(r) if r.ok => {
                logs.push_str(&format!("[docker] ok {}\n", trim_out(r.output.trim())));
                true
            }
            Ok(r) => {
                logs.push_str(&format!(
                    "[docker] probe exit={} {}\n",
                    r.exit_code,
                    trim_out(&r.output)
                ));
                false
            }
            Err(e) => {
                logs.push_str(&format!("[docker] probe error: {e}\n"));
                false
            }
        }
    }

    /// Fallback laptop: npm build + node start (Astro/Next/Node) when Docker is absent.
    async fn try_local_node_runtime(
        &self,
        server: &str,
        build_dir: &str,
        port: u16,
        logs: &mut String,
    ) -> bool {
        let pkg = std::path::Path::new(build_dir).join("package.json");
        if !pkg.is_file() {
            logs.push_str("[local-node] pas de package.json — skip\n");
            return false;
        }

        let install = if cfg!(windows) {
            "$env:PUPPETEER_SKIP_DOWNLOAD='1'; $env:PUPPETEER_SKIP_CHROMIUM_DOWNLOAD='1'; if (Test-Path package-lock.json) { npm ci } else { npm install }"
        } else {
            "export PUPPETEER_SKIP_DOWNLOAD=1 PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1; if [ -f package-lock.json ]; then npm ci; else npm install; fi"
        };
        match self.executor.exec(server, build_dir, install, 900).await {
            Ok(r) => {
                logs.push_str(&format!(
                    "[local-node] install exit={} {}\n",
                    r.exit_code,
                    trim_out(&r.output)
                ));
                if !r.ok {
                    return false;
                }
            }
            Err(e) => {
                logs.push_str(&format!("[local-node] install error: {e}\n"));
                return false;
            }
        }

        let build = if cfg!(windows) {
            "npm run build"
        } else {
            "npm run build"
        };
        match self.executor.exec(server, build_dir, build, 900).await {
            Ok(r) => {
                logs.push_str(&format!(
                    "[local-node] build exit={} {}\n",
                    r.exit_code,
                    trim_out(&r.output)
                ));
                if !r.ok {
                    return false;
                }
            }
            Err(e) => {
                logs.push_str(&format!("[local-node] build error: {e}\n"));
                return false;
            }
        }

        // Stop + spawn en Rust (évite les hangs PowerShell Start-Process)
        if let Err(e) = stop_local_runtime(build_dir, port) {
            logs.push_str(&format!("[local-node] stop warn: {e}\n"));
        }
        match spawn_local_runtime(build_dir, port) {
            Ok(pid) => logs.push_str(&format!("[local-node] started pid={pid} port={port}\n")),
            Err(e) => {
                logs.push_str(&format!("[local-node] start error: {e}\n"));
                return false;
            }
        }

        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        match probe_local_http(port).await {
            Ok(code) => {
                logs.push_str(&format!("[local-node] probe http={code}\n"));
                matches!(code.as_str(), "200" | "301" | "302" | "307" | "308" | "alive")
            }
            Err(e) => {
                logs.push_str(&format!("[local-node] probe error: {e}\n"));
                // Process may still be booting — accept if pid file exists and process alive
                pid_is_alive(build_dir)
            }
        }
    }

    async fn docker_restart_container(
        &self,
        server: &str,
        workdir: &str,
        name: &str,
        image: &str,
        host_port: u16,
        container_port: u16,
        proxy_labels: Option<&serde_json::Value>,
        logs: &mut String,
    ) -> bool {
        let prepare = docker::docker_prepare_run(name, host_port);
        match self.executor.exec(server, workdir, &prepare, 60).await {
            Ok(r) => {
                if !r.output.trim().is_empty() {
                    logs.push_str(&format!("[prepare] {}\n", trim_out(&r.output)));
                }
            }
            Err(e) => logs.push_str(&format!("[prepare] warn: {e}\n")),
        }
        let env_file = if std::path::Path::new(&format!("{workdir}/.env")).exists() {
            Some(".env")
        } else {
            None
        };
        
        // Try to get network from env, then auto-detect if Traefik labels are present
        let mut network = std::env::var("DEVFORGE_DOCKER_NETWORK")
            .ok()
            .filter(|s| !s.trim().is_empty());
        
        let has_traefik_labels = proxy_labels.is_some();
        
        if has_traefik_labels && network.is_none() {
            // Auto-detect Traefik network by inspecting common proxy containers
            logs.push_str("[start] DEVFORGE_DOCKER_NETWORK not set, attempting auto-detection...\n");
            let detect_cmd = docker::docker_detect_traefik_network();
            match self.executor.exec(server, workdir, &detect_cmd, 10).await {
                Ok(r) if r.ok && !r.output.trim().is_empty() => {
                    let detected = r.output.trim().to_string();
                    logs.push_str(&format!("[start] Detected Traefik network: {}\n", detected));
                    network = Some(detected);
                }
                _ => {
                    logs.push_str("[start] Auto-detection failed. Checking common network names...\n");
                    // Fallback: try common network names
                    for candidate in ["coolify", "devforge-net", "traefik-public", "traefik"] {
                        let check = format!("docker network inspect {} >/dev/null 2>&1 && echo {}", candidate, candidate);
                        if let Ok(r) = self.executor.exec(server, workdir, &check, 5).await {
                            if r.ok && !r.output.trim().is_empty() {
                                logs.push_str(&format!("[start] Using network: {}\n", candidate));
                                network = Some(candidate.to_string());
                                break;
                            }
                        }
                    }
                }
            }
        }
        
        // When using Traefik routing, don't publish host ports (conflicts with multiple apps)
        // unless explicitly requested. Traefik reaches containers via Docker network.
        let ports = if has_traefik_labels && network.is_some() {
            vec![] // No host port publish - Traefik routes via Docker network
        } else {
            vec![(host_port, container_port)]
        };
        
        let run = docker::docker_run_ex(
            name,
            image,
            &ports,
            env_file,
            network.as_deref(),
            proxy_labels,
        );
        
        if has_traefik_labels {
            logs.push_str("[start] traefik labels applied\n");
            if let Some(net) = &network {
                logs.push_str(&format!("[start] Traefik routing via Docker network: {}\n", net));
                logs.push_str("[start] No host port published (Traefik routes internally)\n");
            } else {
                logs.push_str("[start] WARNING: Traefik labels set but no Docker network found.\n");
                logs.push_str("[start] WARNING: Traefik may not reach this container (no shared network).\n");
                logs.push_str("[start] WARNING: Set DEVFORGE_DOCKER_NETWORK to 'devforge-net', 'traefik-public', or 'coolify',\n");
                logs.push_str("[start] WARNING: or ensure a proxy container (traefik/coolify/caddy) is running.\n");
            }
        }
        match self.executor.exec(server, workdir, &run, 120).await {
            Ok(r) => {
                logs.push_str(&format!(
                    "[start] exit={} {}\n",
                    r.exit_code,
                    trim_out(&r.output)
                ));
                r.ok
            }
            Err(e) => {
                logs.push_str(&format!("[start] error: {e}\n"));
                false
            }
        }
    }

    pub async fn stop(&self, project: &ProjectTestContext) -> Value {
        let name = Self::container_name(&project.project_uuid);
        let cmd = docker::docker_stop(&name);
        match self.run_lifecycle(project, &cmd).await {
            Ok(r) => json!({
                "ok": r.ok,
                "phase": "stop",
                "container": name,
                "output": r.output,
                "project_uuid": project.project_uuid
            }),
            Err(e) => json!({"ok": false, "phase": "stop", "error": e.to_string()}),
        }
    }

    pub async fn restart(&self, project: &ProjectTestContext) -> Value {
        let name = Self::container_name(&project.project_uuid);
        let cmd = docker::docker_restart(&name);
        match self.run_lifecycle(project, &cmd).await {
            Ok(r) => json!({
                "ok": r.ok,
                "phase": "restart",
                "container": name,
                "output": r.output,
                "project_uuid": project.project_uuid
            }),
            Err(e) => json!({"ok": false, "phase": "restart", "error": e.to_string()}),
        }
    }

    pub async fn status(&self, project: &ProjectTestContext) -> DeployStatus {
        let name = Self::container_name(&project.project_uuid);
        let cmd = docker::docker_ps_status(&name);
        match self.run_lifecycle(project, &cmd).await {
            Ok(r) => {
                let msg = r.output.trim().to_string();
                let healthy = r.ok && !msg.is_empty() && !msg.to_lowercase().contains("exited");
                DeployStatus {
                    project_uuid: project.project_uuid.clone(),
                    phase: if healthy { "running".into() } else { "stopped".into() },
                    healthy,
                    message: if msg.is_empty() {
                        "aucun conteneur".into()
                    } else {
                        msg
                    },
                }
            }
            Err(e) => DeployStatus {
                project_uuid: project.project_uuid.clone(),
                phase: "unknown".into(),
                healthy: false,
                message: e.to_string(),
            },
        }
    }

    async fn run_lifecycle(
        &self,
        project: &ProjectTestContext,
        command: &str,
    ) -> Result<ExecResult> {
        let server_id = project.server_id.trim();
        let workdir = project.workdir.trim();
        if server_id.is_empty() || workdir.is_empty() {
            return Err(DevForgeError::Message(
                "server_id et workdir requis pour le lifecycle deploy".into(),
            ));
        }
        self.executor.exec(server_id, workdir, command, 300).await
    }

    pub async fn exec(
        &self,
        server_id: &str,
        workdir: &str,
        command: &str,
        timeout: u64,
    ) -> Result<ExecResult> {
        self.executor
            .exec(server_id, workdir, command, timeout)
            .await
            .map_err(|e| DevForgeError::Message(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn requires_workdir() {
        let facade = DeployFacade::new(Arc::new(StubRemoteExecutor::new()));
        let out = facade
            .run_tests(&ProjectTestContext {
                project_uuid: "abc".into(),
                server_id: "srv".into(),
                workdir: "".into(),
                test_command: "./vendor/bin/pest".into(),
                timeout: None,
            })
            .await;
        assert_eq!(out["ok"], false);
        assert!(out["error"].as_str().unwrap().contains("workdir"));
    }

    #[tokio::test]
    async fn runs_with_explicit_contract() {
        let exec = StubRemoteExecutor::new().with_script(
            "srv|/app|./vendor/bin/pest --compact",
            ExecResult {
                ok: true,
                exit_code: 0,
                output: "Tests: 3 passed".into(),
            },
        );
        let facade = DeployFacade::new(Arc::new(exec));
        let out = facade
            .run_tests(&ProjectTestContext {
                project_uuid: "uji97r70f1jaq9m7l9btm61d".into(),
                server_id: "srv".into(),
                workdir: "/app".into(),
                test_command: "./vendor/bin/pest --compact".into(),
                timeout: None,
            })
            .await;
        assert_eq!(out["ok"], true);
        assert_eq!(out["exit_code"], 0);
        assert!(out["output"].as_str().unwrap().contains("passed"));
    }
}
