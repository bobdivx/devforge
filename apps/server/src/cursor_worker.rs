//! Worker Cursor Self-Hosted (My Machines) géré par DevForge.
//!
//! Lance `agent worker … start` avec un `--worker-dir` par checkout projet,
//! pour que Cursor / Grok Bot exécutent les tool calls sur la machine
//! qui contient déjà tous les repos.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const STATE_DIR_NAME: &str = "cursor-worker";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerDir {
    pub project_uuid: String,
    pub project_name: String,
    pub path: String,
    pub exists: bool,
    pub has_git: bool,
    pub git_remote: Option<String>,
    /// Inclus dans le prochain / dernier démarrage (existe + .git).
    pub eligible: bool,
}

#[derive(Debug, Clone)]
pub struct WorkerSettings {
    pub enabled: bool,
    pub name: String,
    pub api_key_sealed: String,
    pub binary: String,
    pub extra_dirs: String,
}

impl Default for WorkerSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            name: String::new(),
            api_key_sealed: String::new(),
            binary: String::new(),
            extra_dirs: String::new(),
        }
    }
}

pub fn state_dir() -> PathBuf {
    data_dir_base().join(STATE_DIR_NAME)
}

fn data_dir_base() -> PathBuf {
    if let Ok(v) = std::env::var("DEVFORGE_DATA_DIR") {
        return PathBuf::from(v);
    }
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("data")
}

fn pid_path() -> PathBuf {
    state_dir().join("worker.pid")
}

fn out_path() -> PathBuf {
    state_dir().join("worker.out")
}

fn err_path() -> PathBuf {
    state_dir().join("worker.err")
}

fn registered_path() -> PathBuf {
    state_dir().join("registered.json")
}

fn ensure_state_dir() -> Result<(), String> {
    std::fs::create_dir_all(state_dir()).map_err(|e| e.to_string())
}

pub async fn load_settings(pool: &PgPool) -> WorkerSettings {
    let row: Option<(i64, String, String, String, String)> = sqlx::query_as(
        r#"SELECT COALESCE(cursor_worker_enabled, 0),
                  COALESCE(cursor_worker_name, ''),
                  COALESCE(cursor_worker_api_key, ''),
                  COALESCE(cursor_worker_binary, ''),
                  COALESCE(cursor_worker_extra_dirs, '')
           FROM instance_settings WHERE id = 1"#,
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    match row {
        Some((en, name, key, bin, extra)) => WorkerSettings {
            enabled: en != 0,
            name,
            api_key_sealed: key,
            binary: bin,
            extra_dirs: extra,
        },
        None => WorkerSettings::default(),
    }
}

pub fn resolve_worker_name(settings: &WorkerSettings) -> String {
    let n = settings.name.trim();
    if !n.is_empty() {
        return n.to_string();
    }
    hostname_fallback()
}

fn hostname_fallback() -> String {
    std::env::var("HOSTNAME")
        .or_else(|_| std::env::var("COMPUTERNAME"))
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "devforge".into())
}

pub fn api_key_plain(settings: &WorkerSettings) -> String {
    let raw = settings.api_key_sealed.trim();
    if raw.is_empty() {
        return String::new();
    }
    crate::secret_box::open_compat(raw)
}

pub fn mask_key(plain: &str) -> String {
    let t = plain.trim();
    if t.is_empty() {
        return String::new();
    }
    if t.len() <= 8 {
        return "••••".into();
    }
    format!("{}…{}", &t[..4], &t[t.len().saturating_sub(4)..])
}

/// Résout le binaire `agent` (chemin custom ou PATH).
pub fn resolve_agent_binary(settings: &WorkerSettings) -> Option<PathBuf> {
    let custom = settings.binary.trim();
    if !custom.is_empty() {
        let p = PathBuf::from(custom);
        if p.is_file() {
            return Some(p);
        }
        return None;
    }
    which_agent()
}

fn which_agent() -> Option<PathBuf> {
    #[cfg(windows)]
    let cmd = Command::new("where").arg("agent").output();
    #[cfg(not(windows))]
    let cmd = Command::new("sh")
        .args(["-c", "command -v agent"])
        .output();
    let Ok(out) = cmd else {
        return None;
    };
    if !out.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&out.stdout);
    let path = line.lines().next()?.trim();
    if path.is_empty() {
        return None;
    }
    let p = PathBuf::from(path);
    p.is_file().then_some(p)
}

pub fn agent_version(bin: &Path) -> Option<String> {
    let out = Command::new(bin).arg("--version").output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout);
    let line = s.lines().next()?.trim();
    (!line.is_empty()).then(|| line.to_string())
}

pub async fn list_project_workdirs(pool: &PgPool) -> Result<Vec<WorkerDir>, String> {
    let rows: Vec<(String, String, String, String)> = sqlx::query_as(
        r#"SELECT uuid, name, COALESCE(workdir, ''), COALESCE(git_repository, '')
           FROM projects ORDER BY name COLLATE "C""#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut dirs = Vec::with_capacity(rows.len());
    for (uuid, name, workdir, _repo) in rows {
        let path = devforge_deploy::resolve_project_workdir(&workdir, &uuid);
        let p = Path::new(&path);
        let exists = p.is_dir();
        let has_git = exists && (p.join(".git").exists());
        let git_remote = if has_git {
            read_git_remote(p)
        } else {
            None
        };
        let eligible = exists && has_git;
        dirs.push(WorkerDir {
            project_uuid: uuid,
            project_name: name,
            path,
            exists,
            has_git,
            git_remote,
            eligible,
        });
    }
    Ok(dirs)
}

fn read_git_remote(workdir: &Path) -> Option<String> {
    let out = Command::new("git")
        .args(["-C", &workdir.to_string_lossy(), "remote", "get-url", "origin"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

pub fn parse_extra_dirs(raw: &str) -> Vec<String> {
    raw.lines()
        .flat_map(|line| line.split([',', ';']))
        .map(str::trim)
        .filter(|s| !s.is_empty() && !s.starts_with('#'))
        .map(str::to_string)
        .collect()
}

pub fn eligible_paths(dirs: &[WorkerDir], extra_raw: &str) -> Vec<String> {
    let mut paths: Vec<String> = dirs
        .iter()
        .filter(|d| d.eligible)
        .map(|d| d.path.clone())
        .collect();
    for extra in parse_extra_dirs(extra_raw) {
        let p = Path::new(&extra);
        if p.is_dir() && p.join(".git").exists() && !paths.iter().any(|x| x == &extra) {
            paths.push(extra);
        }
    }
    paths
}

/// Construit les arguments CLI (sans le binaire) pour tests / démarrage.
pub fn build_worker_args(name: &str, workdirs: &[String], api_key: &str) -> Result<Vec<String>, String> {
    if workdirs.is_empty() {
        return Err(
            "Aucun workdir Git éligible. Clone les repos projets ou ajoute des chemins extra."
                .into(),
        );
    }
    let mut args = vec!["worker".into()];
    let name = name.trim();
    if !name.is_empty() {
        args.push("--name".into());
        args.push(name.to_string());
    }
    for dir in workdirs {
        args.push("--worker-dir".into());
        args.push(dir.clone());
    }
    args.push("start".into());
    let key = api_key.trim();
    if !key.is_empty() {
        args.push("--api-key".into());
        args.push(key.to_string());
    }
    Ok(args)
}

pub fn read_pid() -> Option<u32> {
    let raw = std::fs::read_to_string(pid_path()).ok()?;
    let pid: u32 = raw.trim().parse().ok()?;
    (pid > 0).then_some(pid)
}

pub fn pid_is_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(target_os = "linux")]
    {
        let Ok(status) = std::fs::read_to_string(format!("/proc/{pid}/status")) else {
            return false;
        };
        for line in status.lines() {
            if let Some(rest) = line.strip_prefix("State:") {
                return !rest.trim().starts_with('Z');
            }
        }
        true
    }
    #[cfg(all(windows, not(target_os = "linux")))]
    {
        Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
            .unwrap_or(true)
    }
    #[cfg(all(unix, not(target_os = "linux")))]
    {
        Command::new("kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

pub fn is_running() -> bool {
    read_pid().is_some_and(pid_is_alive)
}

fn kill_pid(pid: u32) -> Result<(), String> {
    if pid == 0 {
        return Ok(());
    }
    #[cfg(windows)]
    {
        let status = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() && pid_is_alive(pid) {
            return Err(format!("taskkill a échoué pour pid {pid}"));
        }
    }
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status();
        std::thread::sleep(std::time::Duration::from_millis(400));
        if pid_is_alive(pid) {
            let _ = Command::new("kill")
                .args(["-KILL", &pid.to_string()])
                .status();
        }
    }
    Ok(())
}

pub fn stop() -> Result<Value, String> {
    let Some(pid) = read_pid() else {
        let _ = std::fs::remove_file(pid_path());
        return Ok(json!({
            "ok": true,
            "running": false,
            "message": "Aucun worker en cours",
        }));
    };
    if !pid_is_alive(pid) {
        let _ = std::fs::remove_file(pid_path());
        return Ok(json!({
            "ok": true,
            "running": false,
            "message": "Process déjà arrêté",
        }));
    }
    kill_pid(pid)?;
    let _ = std::fs::remove_file(pid_path());
    Ok(json!({
        "ok": true,
        "running": false,
        "stopped_pid": pid,
        "message": format!("Worker arrêté (pid {pid})"),
    }))
}

pub fn read_logs_tail(max_lines: usize) -> String {
    let mut chunks = Vec::new();
    for path in [out_path(), err_path()] {
        if let Ok(raw) = std::fs::read_to_string(&path) {
            let lines: Vec<&str> = raw.lines().collect();
            let start = lines.len().saturating_sub(max_lines);
            if start < lines.len() {
                chunks.push(format!(
                    "—— {} ——\n{}",
                    path.file_name().and_then(|s| s.to_str()).unwrap_or("log"),
                    lines[start..].join("\n")
                ));
            }
        }
    }
    chunks.join("\n\n")
}

pub fn load_registered() -> Vec<String> {
    let Ok(raw) = std::fs::read_to_string(registered_path()) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<String>>(&raw).unwrap_or_default()
}

fn save_registered(paths: &[String]) -> Result<(), String> {
    ensure_state_dir()?;
    let raw = serde_json::to_string_pretty(paths).map_err(|e| e.to_string())?;
    std::fs::write(registered_path(), raw).map_err(|e| e.to_string())
}

pub fn start(settings: &WorkerSettings, workdirs: &[String]) -> Result<Value, String> {
    if is_running() {
        return Err("Worker déjà en cours — arrête-le avant de relancer.".into());
    }
    let bin = resolve_agent_binary(settings).ok_or_else(|| {
        "CLI Cursor introuvable (`agent`). Installe-le sur la machine : curl https://cursor.com/install -fsS | bash — ou indique le chemin du binaire.".to_string()
    })?;
    let name = resolve_worker_name(settings);
    let api_key = api_key_plain(settings);
    if api_key.trim().is_empty() {
        return Err(
            "Clé API Cursor manquante. Dashboard Cursor → API Keys (clé personnelle), puis enregistre-la ici."
                .into(),
        );
    }
    let args = build_worker_args(&name, workdirs, &api_key)?;
    ensure_state_dir()?;
    let out = std::fs::File::create(out_path()).map_err(|e| e.to_string())?;
    let err = std::fs::File::create(err_path()).map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&bin);
    cmd.args(&args)
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

    let child = cmd
        .spawn()
        .map_err(|e| format!("Échec démarrage `{}`: {e}", bin.display()))?;
    let pid = child.id();
    std::fs::write(pid_path(), pid.to_string()).map_err(|e| e.to_string())?;
    save_registered(workdirs)?;

    let _ = std::thread::Builder::new()
        .name("cursor-worker-reap".into())
        .spawn(move || {
            let mut child = child;
            let _ = child.wait();
        });

    // Laisse le process s’initialiser un court instant.
    std::thread::sleep(std::time::Duration::from_millis(600));
    if !pid_is_alive(pid) {
        let logs = read_logs_tail(40);
        let _ = std::fs::remove_file(pid_path());
        return Err(format!(
            "Le worker s’est arrêté immédiatement. Vérifie la clé API et le réseau sortant (api2.cursor.sh).\n{logs}"
        ));
    }

    Ok(json!({
        "ok": true,
        "running": true,
        "pid": pid,
        "name": name,
        "binary": bin.display().to_string(),
        "workdirs": workdirs,
        "workdirs_count": workdirs.len(),
        "message": format!("Worker « {name} » démarré avec {} repo(s)", workdirs.len()),
    }))
}

pub fn restart(settings: &WorkerSettings, workdirs: &[String]) -> Result<Value, String> {
    let _ = stop();
    std::thread::sleep(std::time::Duration::from_millis(300));
    start(settings, workdirs)
}

pub async fn status_json(pool: &PgPool) -> Result<Value, String> {
    let settings = load_settings(pool).await;
    let dirs = list_project_workdirs(pool).await?;
    let eligible = eligible_paths(&dirs, &settings.extra_dirs);
    let bin = resolve_agent_binary(&settings);
    let version = bin.as_ref().and_then(|p| agent_version(p));
    let running = is_running();
    let pid = read_pid().filter(|_| running);
    let plain = api_key_plain(&settings);
    let name = resolve_worker_name(&settings);

    Ok(json!({
        "ok": true,
        "running": running,
        "pid": pid,
        "name": name,
        "cli_installed": bin.is_some(),
        "cli_path": bin.as_ref().map(|p| p.display().to_string()),
        "cli_version": version,
        "api_key_set": !plain.is_empty(),
        "api_key_masked": if plain.is_empty() { Value::Null } else { json!(mask_key(&plain)) },
        "enabled": settings.enabled,
        "settings": {
            "name": settings.name,
            "binary": settings.binary,
            "extra_dirs": settings.extra_dirs,
            "enabled": settings.enabled,
        },
        "workdirs": dirs,
        "eligible_count": eligible.len(),
        "eligible_paths": eligible,
        "registered_paths": load_registered(),
        "logs_tail": if running || err_path().is_file() || out_path().is_file() {
            read_logs_tail(30)
        } else {
            String::new()
        },
        "hint": if bin.is_none() {
            "Installe le CLI Cursor sur cette machine : curl https://cursor.com/install -fsS | bash"
        } else if plain.is_empty() {
            "Ajoute une clé API personnelle Cursor (Dashboard → API Keys)."
        } else if eligible.is_empty() {
            "Aucun checkout Git prêt. Les workdirs projets doivent exister avec un dépôt .git."
        } else if !running {
            "Prêt à démarrer. Les agents Cursor / Grok Bot pourront cibler cette machine (My Machines)."
        } else {
            "Worker connecté. Dans cursor.com/agents ou Grok Bot, choisis cette machine (worker=<name>)."
        },
    }))
}

/// Au boot : si auto-start activé, lance le worker après un délai.
pub fn spawn_autostart(pool: PgPool) {
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(20)).await;
        let settings = load_settings(&pool).await;
        if !settings.enabled {
            return;
        }
        if is_running() {
            tracing::info!("cursor-worker déjà actif");
            return;
        }
        let dirs = match list_project_workdirs(&pool).await {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!(error = %e, "cursor-worker autostart: list workdirs");
                return;
            }
        };
        let paths = eligible_paths(&dirs, &settings.extra_dirs);
        match start(&settings, &paths) {
            Ok(v) => tracing::info!(?v, "cursor-worker autostart ok"),
            Err(e) => tracing::warn!(error = %e, "cursor-worker autostart"),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_args_multi_dirs() {
        let args = build_worker_args(
            "demeter",
            &[
                "/data/devforge/applications/a".into(),
                "/data/devforge/applications/b".into(),
            ],
            "key_test",
        )
        .unwrap();
        assert_eq!(args[0], "worker");
        assert!(args.contains(&"--name".into()));
        assert!(args.contains(&"demeter".into()));
        let dir_flags = args.iter().filter(|a| *a == "--worker-dir").count();
        assert_eq!(dir_flags, 2);
        assert!(args.contains(&"start".into()));
        assert!(args.contains(&"--api-key".into()));
        assert!(args.contains(&"key_test".into()));
    }

    #[test]
    fn build_args_rejects_empty() {
        assert!(build_worker_args("x", &[], "k").is_err());
    }

    #[test]
    fn parse_extra_dirs_mixed() {
        let v = parse_extra_dirs("/a\n# comment\n/b, /c ; /d");
        assert_eq!(v, vec!["/a", "/b", "/c", "/d"]);
    }

    #[test]
    fn mask_key_short_and_long() {
        assert_eq!(mask_key(""), "");
        assert_eq!(mask_key("abcd"), "••••");
        let m = mask_key("abcdefghijklmnop");
        assert!(m.starts_with("abcd"));
        assert!(m.ends_with("mnop"));
    }
}
