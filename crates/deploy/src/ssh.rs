use async_trait::async_trait;
use devforge_shared::{DevForgeError, Result};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;
use tokio::process::Command;

use crate::{ExecResult, RemoteExecutor};

/// SSH target for a logical `server_id`.
#[derive(Debug, Clone)]
pub struct SshTarget {
    pub host: String,
    pub user: String,
    pub port: u16,
    pub identity_file: Option<PathBuf>,
}

impl SshTarget {
    pub fn from_env() -> Option<Self> {
        let host = std::env::var("DEVFORGE_SSH_HOST").ok()?;
        if host.trim().is_empty() {
            return None;
        }
        Some(Self {
            host,
            user: std::env::var("DEVFORGE_SSH_USER").unwrap_or_else(|_| "root".into()),
            port: std::env::var("DEVFORGE_SSH_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(22),
            identity_file: std::env::var("DEVFORGE_SSH_KEY").ok().map(PathBuf::from),
        })
    }
}

/// Executes commands on remote hosts via the system `ssh` binary.
pub struct SshRemoteExecutor {
    /// server_id → target ; empty key `"*"` or `"default"` used as fallback.
    targets: HashMap<String, SshTarget>,
    default: Option<SshTarget>,
}

impl SshRemoteExecutor {
    pub fn new(default: SshTarget) -> Self {
        Self {
            targets: HashMap::new(),
            default: Some(default),
        }
    }

    pub fn from_env() -> Option<Self> {
        SshTarget::from_env().map(Self::new)
    }

    pub fn with_target(mut self, server_id: impl Into<String>, target: SshTarget) -> Self {
        self.targets.insert(server_id.into(), target);
        self
    }

    fn resolve(&self, server_id: &str) -> Result<&SshTarget> {
        self.targets
            .get(server_id)
            .or(self.default.as_ref())
            .ok_or_else(|| {
                DevForgeError::Message(format!(
                    "Aucun target SSH pour server_id={server_id}. Définis DEVFORGE_SSH_HOST."
                ))
            })
    }
}

#[async_trait]
impl RemoteExecutor for SshRemoteExecutor {
    async fn exec(
        &self,
        server_id: &str,
        workdir: &str,
        command: &str,
        timeout_secs: u64,
    ) -> Result<ExecResult> {
        let target = self.resolve(server_id)?;
        let remote = if workdir.trim().is_empty() {
            command.to_string()
        } else {
            format!("cd {} && {}", shell_quote(workdir), command)
        };

        let mut cmd = Command::new("ssh");
        cmd.arg("-o")
            .arg("BatchMode=yes")
            .arg("-o")
            .arg("StrictHostKeyChecking=accept-new")
            .arg("-p")
            .arg(target.port.to_string());
        if let Some(key) = &target.identity_file {
            cmd.arg("-i").arg(key);
        }
        cmd.arg(format!("{}@{}", target.user, target.host))
            .arg(remote);

        let child = cmd.output();
        let output = tokio::time::timeout(Duration::from_secs(timeout_secs.max(5)), child)
            .await
            .map_err(|_| DevForgeError::Message("SSH timeout".into()))?
            .map_err(|e| DevForgeError::Message(format!("ssh spawn failed: {e}")))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let combined = if stderr.trim().is_empty() {
            stdout.to_string()
        } else {
            format!("{stdout}\n{stderr}")
        };
        let exit_code = output.status.code().unwrap_or(1);
        Ok(ExecResult {
            ok: output.status.success(),
            exit_code,
            output: combined.chars().take(512_000).collect(),
        })
    }
}

/// Local shell executor (dev machine / same host as Docker).
pub struct LocalShellExecutor;

fn windows_docker_bin_dirs() -> Vec<String> {
    let mut dirs = Vec::new();
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        dirs.push(format!(
            r"{local}\Programs\DockerDesktop\resources\bin"
        ));
        dirs.push(format!(r"{local}\Docker\bin"));
    }
    dirs.push(r"C:\Program Files\Docker\Docker\resources\bin".into());
    dirs.push(r"C:\Program Files\Docker\Docker\resources".into());
    dirs
}

fn enrich_path_for_docker(cmd: &mut Command) {
    let mut path = std::env::var_os("PATH").unwrap_or_default();
    if cfg!(windows) {
        for dir in windows_docker_bin_dirs() {
            if std::path::Path::new(&dir).is_dir() {
                let mut new_path = std::ffi::OsString::from(&dir);
                new_path.push(";");
                new_path.push(&path);
                path = new_path;
            }
        }
    }
    cmd.env("PATH", path);
}

#[async_trait]
impl RemoteExecutor for LocalShellExecutor {
    async fn exec(
        &self,
        _server_id: &str,
        workdir: &str,
        command: &str,
        timeout_secs: u64,
    ) -> Result<ExecResult> {
        let mut cmd = if cfg!(windows) {
            let mut c = Command::new("powershell");
            c.arg("-NoProfile").arg("-Command").arg(command);
            c
        } else {
            let mut c = Command::new("sh");
            c.arg("-lc").arg(command);
            c
        };
        enrich_path_for_docker(&mut cmd);
        if !workdir.trim().is_empty() {
            let dir = std::path::Path::new(workdir);
            if !dir.is_dir() {
                return Ok(ExecResult {
                    ok: false,
                    exit_code: 1,
                    output: format!(
                        "workdir introuvable: {workdir}\n(chemin distant NAS ? clone local absent)"
                    ),
                });
            }
            cmd.current_dir(workdir);
        }
        let output = tokio::time::timeout(Duration::from_secs(timeout_secs.max(5)), cmd.output())
            .await
            .map_err(|_| DevForgeError::Message("local exec timeout".into()))?
            .map_err(|e| DevForgeError::Message(format!("local spawn failed: {e}")))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let combined = if stderr.trim().is_empty() {
            stdout.to_string()
        } else {
            format!("{stdout}\n{stderr}")
        };
        Ok(ExecResult {
            ok: output.status.success(),
            exit_code: output.status.code().unwrap_or(1),
            output: combined.chars().take(512_000).collect(),
        })
    }
}

fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
