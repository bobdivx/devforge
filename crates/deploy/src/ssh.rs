use async_trait::async_trait;
use devforge_shared::{DevForgeError, Result};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tokio::io::AsyncReadExt;
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
        let inner = if workdir.trim().is_empty() {
            command.to_string()
        } else {
            format!("cd {} && {}", shell_quote(workdir), command)
        };
        let pid_file = remote_pid_file();
        let remote = remote_tracked_command(&pid_file, &inner);

        let limit = timeout_secs.max(5);
        let output =
            match run_killable(ssh_command(target, &remote), Duration::from_secs(limit)).await {
                Ok(o) => o,
                Err(RunError::Spawn(e)) => {
                    return Err(DevForgeError::Message(format!("ssh spawn failed: {e}")));
                }
                Err(RunError::Timeout) => {
                    // Killing the local ssh client does not stop the remote command
                    // (no tty, no SIGHUP): terminate its process group explicitly.
                    let killed = run_killable(
                        ssh_command(target, &remote_kill_command(&pid_file)),
                        Duration::from_secs(30),
                    )
                    .await
                    .map(|o| o.status.success())
                    .unwrap_or(false);
                    let note = if killed {
                        "remote process stopped"
                    } else {
                        "remote process stop failed"
                    };
                    return Err(DevForgeError::Message(format!(
                        "SSH timeout ({limit}s, {note})"
                    )));
                }
            };

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
        dirs.push(format!(r"{local}\Programs\DockerDesktop\resources\bin"));
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
        let limit = timeout_secs.max(5);
        let output = match run_killable(cmd, Duration::from_secs(limit)).await {
            Ok(o) => o,
            Err(RunError::Timeout) => {
                return Err(DevForgeError::Message(format!(
                    "local exec timeout ({limit}s, process stopped)"
                )));
            }
            Err(RunError::Spawn(e)) => {
                return Err(DevForgeError::Message(format!("local spawn failed: {e}")));
            }
        };

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

fn ssh_command(target: &SshTarget, remote: &str) -> Command {
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
    cmd
}

/// Unique remote pid file for one SSH exec.
fn remote_pid_file() -> String {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!(
        "/tmp/devforge-exec-{}-{}-{}.pid",
        std::process::id(),
        nanos,
        SEQ.fetch_add(1, Ordering::Relaxed)
    )
}

/// Remote wrapper: sshd starts the command in its own session, so the remote
/// shell pid is also the process group id of everything the command spawns.
/// It is written to `pid_file` so a timeout can stop the whole group.
fn remote_tracked_command(pid_file: &str, inner: &str) -> String {
    let f = shell_quote(pid_file);
    format!(
        "printf '%s' \"$$\" > {f} 2>/dev/null; ( {inner}\n); __df_rc=$?; rm -f {f}; exit $__df_rc"
    )
}

/// Remote stop: TERM the process group recorded in `pid_file`, then KILL after a grace period.
fn remote_kill_command(pid_file: &str) -> String {
    let f = shell_quote(pid_file);
    format!(
        "__df_p=$(cat {f} 2>/dev/null); [ -n \"$__df_p\" ] || exit 1; \
         kill -s TERM -- -\"$__df_p\" 2>/dev/null || kill -TERM -\"$__df_p\" 2>/dev/null \
         || kill -TERM \"$__df_p\" 2>/dev/null; \
         sleep 5; kill -s KILL -- -\"$__df_p\" 2>/dev/null || kill -KILL -\"$__df_p\" 2>/dev/null; \
         rm -f {f}; exit 0"
    )
}

#[derive(Debug)]
enum RunError {
    Spawn(std::io::Error),
    Timeout,
}

/// Grace period between SIGTERM and SIGKILL when a command times out.
const KILL_GRACE: Duration = Duration::from_secs(5);

/// Kills the child's process group if the exec future is dropped before the
/// child is reaped (timeout, cancelled deploy).
struct GroupGuard {
    pid: Option<u32>,
}

impl GroupGuard {
    fn disarm(&mut self) {
        self.pid = None;
    }
}

impl Drop for GroupGuard {
    fn drop(&mut self) {
        if let Some(pid) = self.pid {
            signal_group(pid, Signal::Kill);
        }
    }
}

#[derive(Clone, Copy)]
enum Signal {
    Term,
    Kill,
}

#[cfg(unix)]
fn signal_group(pid: u32, sig: Signal) {
    let Ok(pgid) = i32::try_from(pid) else {
        return;
    };
    if pgid <= 1 {
        return;
    }
    let signo = match sig {
        Signal::Term => libc::SIGTERM,
        Signal::Kill => libc::SIGKILL,
    };
    // SAFETY: kill(2) on a negative pid targets the process group we created
    // with process_group(0); it has no memory-safety implications.
    unsafe {
        libc::kill(-pgid, signo);
    }
}

#[cfg(not(unix))]
fn signal_group(_pid: u32, _sig: Signal) {}

/// Runs `cmd` capturing stdout/stderr, with a hard limit. On timeout the child
/// and every process it started (same process group on unix) are terminated
/// and reaped, instead of being left running in the background.
async fn run_killable(
    mut cmd: Command,
    limit: Duration,
) -> std::result::Result<std::process::Output, RunError> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);

    let mut child = cmd.spawn().map_err(RunError::Spawn)?;
    let mut guard = GroupGuard { pid: child.id() };
    let mut stdout = child.stdout.take();
    let mut stderr = child.stderr.take();
    let out_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        if let Some(s) = stdout.as_mut() {
            let _ = s.read_to_end(&mut buf).await;
        }
        buf
    });
    let err_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        if let Some(s) = stderr.as_mut() {
            let _ = s.read_to_end(&mut buf).await;
        }
        buf
    });

    let finished = tokio::time::timeout(limit, async {
        let status = child.wait().await;
        let out = out_task.await.unwrap_or_default();
        let err = err_task.await.unwrap_or_default();
        (status, out, err)
    })
    .await;

    match finished {
        Ok((Ok(status), stdout, stderr)) => {
            guard.disarm();
            Ok(std::process::Output {
                status,
                stdout,
                stderr,
            })
        }
        Ok((Err(e), _, _)) => Err(RunError::Spawn(e)),
        Err(_) => {
            if let Some(pid) = child.id() {
                signal_group(pid, Signal::Term);
                if tokio::time::timeout(KILL_GRACE, child.wait())
                    .await
                    .is_err()
                {
                    signal_group(pid, Signal::Kill);
                }
                // Grandchildren that ignored SIGTERM still share the group.
                signal_group(pid, Signal::Kill);
            }
            let _ = child.kill().await;
            let _ = child.wait().await;
            guard.disarm();
            Err(RunError::Timeout)
        }
    }
}

fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracked_command_records_pid_and_keeps_exit_code() {
        let c = remote_tracked_command("/tmp/x.pid", "cd '/w' && make");
        assert!(c.starts_with("printf '%s' \"$$\" > '/tmp/x.pid'"));
        assert!(c.contains("( cd '/w' && make\n)"));
        assert!(c.ends_with("rm -f '/tmp/x.pid'; exit $__df_rc"));
    }

    #[test]
    fn kill_command_targets_recorded_group() {
        let c = remote_kill_command("/tmp/x.pid");
        assert!(c.contains("cat '/tmp/x.pid'"));
        assert!(c.contains("kill -s TERM -- -\"$__df_p\""));
        assert!(c.contains("kill -s KILL -- -\"$__df_p\""));
    }

    #[test]
    fn pid_files_are_unique() {
        assert_ne!(remote_pid_file(), remote_pid_file());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn tracked_command_runs_and_cleans_up_locally() {
        let dir = std::env::temp_dir().join(format!("df-track-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let pid_file = dir.join("p.pid").to_string_lossy().to_string();
        let mut cmd = Command::new("sh");
        cmd.arg("-c")
            .arg(remote_tracked_command(&pid_file, "echo hi; exit 3"));
        let out = run_killable(cmd, Duration::from_secs(10)).await.unwrap();
        assert_eq!(out.status.code(), Some(3));
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "hi");
        assert!(!std::path::Path::new(&pid_file).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn run_killable_captures_output() {
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg("echo out; echo err >&2; exit 2");
        let out = run_killable(cmd, Duration::from_secs(10)).await.unwrap();
        assert_eq!(out.status.code(), Some(2));
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "out");
        assert_eq!(String::from_utf8_lossy(&out.stderr).trim(), "err");
    }

    #[cfg(unix)]
    fn process_alive(pid: i32) -> bool {
        // A zombie (already dead, waiting to be reaped by init) counts as stopped.
        match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
            Ok(stat) => !stat
                .rsplit(')')
                .next()
                .map(|r| r.trim_start().starts_with('Z'))
                .unwrap_or(false),
            Err(_) => unsafe { libc::kill(pid, 0) == 0 },
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn timeout_kills_the_whole_process_group() {
        let dir = std::env::temp_dir().join(format!("df-kill-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let pid_file = dir.join("child.pid");
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg(format!(
            "sleep 60 & echo $! > '{}'; wait",
            pid_file.display()
        ));
        let started = std::time::Instant::now();
        let r = run_killable(cmd, Duration::from_millis(500)).await;
        assert!(matches!(r, Err(RunError::Timeout)));
        assert!(started.elapsed() < Duration::from_secs(15));
        let pid: i32 = std::fs::read_to_string(&pid_file)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        let mut alive = true;
        for _ in 0..50 {
            if !process_alive(pid) {
                alive = false;
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert!(!alive, "grandchild {pid} still running after timeout");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn local_executor_reports_timeout() {
        let r = LocalShellExecutor.exec("", "", "sleep 30", 5).await;
        let msg = format!("{}", r.err().expect("timeout expected"));
        assert!(msg.contains("local exec timeout (5s"), "{msg}");
    }

    /// Simulates the SSH timeout path locally: the tracked command runs as a
    /// process group leader (as under sshd) and the kill command stops it.
    #[cfg(unix)]
    #[tokio::test]
    async fn remote_kill_command_stops_tracked_group() {
        let dir = std::env::temp_dir().join(format!("df-rkill-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let pid_file = dir.join("g.pid").to_string_lossy().to_string();
        let mut cmd = Command::new("sh");
        cmd.arg("-c")
            .arg(remote_tracked_command(&pid_file, "sleep 60 & wait"));
        let run = tokio::spawn(run_killable(cmd, Duration::from_secs(60)));
        for _ in 0..50 {
            if std::path::Path::new(&pid_file).exists() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let started = std::time::Instant::now();
        let mut kill = Command::new("sh");
        kill.arg("-c").arg(remote_kill_command(&pid_file));
        let k = run_killable(kill, Duration::from_secs(20)).await.unwrap();
        assert!(k.status.success());
        let out = tokio::time::timeout(Duration::from_secs(10), run)
            .await
            .expect("tracked command still running")
            .unwrap()
            .unwrap();
        assert!(!out.status.success());
        assert!(started.elapsed() < Duration::from_secs(15));
        assert!(!std::path::Path::new(&pid_file).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
