use async_trait::async_trait;
use devforge_shared::{DevForgeError, ProjectTestContext, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

pub mod builders;
pub mod docker;
pub mod error_parser;
pub mod runtime;
pub mod runtime_logs;
pub mod ssh;

pub use runtime::{app_http_is_up, classify_public_response, PublicReach, RuntimeSpec};

pub use error_parser::{parse_deploy_error_fr, DeployError};
pub use ssh::{LocalShellExecutor, SshRemoteExecutor, SshTarget};

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Clone)]
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
    /// Dockerfile relatif a la racine du depot. None/vide = Dockerfile dans le contexte de build.
    pub dockerfile_path: Option<String>,
    /// Contexte docker build, relatif a la racine du depot. None/vide = base_directory.
    pub docker_build_context: Option<String>,
    pub publish_directory: Option<String>,
    pub is_static: bool,
    pub github_token: Option<String>,
    /// Token d'installation GitHub App éphémère : passé en en-tête HTTP à git,
    /// jamais écrit dans l'URL du remote ni dans `.git/config`.
    pub github_token_ephemeral: bool,
    /// Note lisible (sans secret) sur l'authentification GitHub choisie côté serveur :
    /// mode utilisé et, en cas de repli, raison de l'échec du jeton d'installation.
    pub github_auth_note: Option<String>,
    /// SHA exact à déployer (relance GitHub « Re-run ») ; `None` = tête de branche.
    pub pin_sha: Option<String>,
    pub env_file: Option<String>,
    /// Labels Traefik (tous les hosts) appliqués au `docker run`.
    pub proxy_labels: Option<serde_json::Value>,
    /// `docker run --gpus all`
    pub gpu_nvidia: bool,
    /// `docker run --device /dev/dri`
    pub gpu_dri: bool,
    /// Réseau Docker du groupe (`dfg-{slug}`), en plus du réseau Traefik.
    pub group_network: Option<String>,
    /// Alias DNS du rôle (`server`, `web`, …) posé après le basculement.
    pub group_alias: Option<String>,
    /// Montages `source:cible[:ro]` (`docker run -v`).
    pub volumes: Vec<String>,
    pub runtime: RuntimeSpec,
}

impl std::fmt::Debug for DeployRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DeployRequest")
            .field("project_uuid", &self.project_uuid)
            .field("server_id", &self.server_id)
            .field("workdir", &self.workdir)
            .field("git_repository", &self.git_repository)
            .field("git_branch", &self.git_branch)
            .field("build_pack", &self.build_pack)
            .field("port", &self.port)
            .field("base_directory", &self.base_directory)
            .field("docker_compose_location", &self.docker_compose_location)
            .field("dockerfile_path", &self.dockerfile_path)
            .field("docker_build_context", &self.docker_build_context)
            .field("publish_directory", &self.publish_directory)
            .field("is_static", &self.is_static)
            .field(
                "github_token",
                &self.github_token.as_ref().map(|_| "[redacted]"),
            )
            .field("github_token_ephemeral", &self.github_token_ephemeral)
            .field("github_auth_note", &self.github_auth_note)
            .field("pin_sha", &self.pin_sha)
            .field("env_file", &self.env_file.as_ref().map(|_| "[set]"))
            .field("proxy_labels", &self.proxy_labels)
            .field("gpu_nvidia", &self.gpu_nvidia)
            .field("gpu_dri", &self.gpu_dri)
            .field("group_network", &self.group_network)
            .field("group_alias", &self.group_alias)
            .field("volumes", &self.volumes)
            .field("runtime", &self.runtime)
            .finish()
    }
}

#[derive(Debug, Clone, Default)]
struct ContainerExtras {
    gpu_nvidia: bool,
    gpu_dri: bool,
    group_network: Option<String>,
    group_alias: Option<String>,
    volumes: Vec<String>,
    runtime: crate::runtime::RuntimeSpec,
}

/// Fichiers suivis contenant des marqueurs `<<<<<<< ` / `>>>>>>> ` en début de ligne
/// (hors documentation). `git grep` sort 0 quand il trouve, 1 sinon.
pub const CONFLICT_GREP_CMD: &str = "git grep -nIE '^(<<<<<<<|>>>>>>>)( |$)' -- . ':!*.md' ':!*.mdx' ':!*.txt' ':!*.rst' ':!*.patch' ':!*.diff' | head -n 20";

/// Message d'échec si des marqueurs de conflit ont été trouvés, sinon `None`.
pub fn conflict_marker_message(exit_code: i32, output: &str) -> Option<String> {
    let hits: Vec<&str> = output
        .lines()
        .map(str::trim)
        .filter(|l| l.contains(":<<<<<<<") || l.contains(":>>>>>>>"))
        .collect();
    if exit_code != 0 || hits.is_empty() {
        return None;
    }
    let mut files: Vec<String> = Vec::new();
    for h in &hits {
        let mut it = h.splitn(3, ':');
        if let (Some(f), Some(n)) = (it.next(), it.next()) {
            let loc = format!("{f}:{n}");
            if !files.iter().any(|x| x.starts_with(&format!("{f}:"))) {
                files.push(loc);
            }
        }
    }
    Some(format!(
        "[conflit] Marqueurs de conflit Git commités dans {} — build non lancé.\n\
         [conflit] Résous le conflit (garde une seule version, supprime les lignes <<<<<<< ======= >>>>>>>) puis pousse un nouveau commit.\n",
        files.join(", ")
    ))
}

#[derive(Debug, Clone, Serialize)]
pub struct DeployResult {
    pub ok: bool,
    pub git_sha: Option<String>,
    pub logs: String,
}

/// Default limit for an image build (docker build / compose up / nixpacks): 60 min.
/// Large Rust images take longer than the former 15 min on a NAS.
const DEFAULT_DOCKER_BUILD_TIMEOUT_SECS: u64 = 3600;

/// Image build timeout in seconds, overridable with `DEVFORGE_DOCKER_BUILD_TIMEOUT_SECS`
/// (accepted range 300..=14400, otherwise the default).
fn docker_build_timeout_secs() -> u64 {
    parse_docker_build_timeout(
        std::env::var("DEVFORGE_DOCKER_BUILD_TIMEOUT_SECS")
            .ok()
            .as_deref(),
    )
}

fn parse_docker_build_timeout(raw: Option<&str>) -> u64 {
    raw.and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|v| (300..=14_400).contains(v))
        .unwrap_or(DEFAULT_DOCKER_BUILD_TIMEOUT_SECS)
}

/// Callback invoqué à chaque append de log (snapshot complet) — pour le live UI.
pub type DeployLogHook = Arc<dyn Fn(&str) + Send + Sync>;

/// Buffer de logs de déploiement. Chaque `push_str` notifie le hook (si présent)
/// pour que le serveur puisse flusher en base pendant le build.
pub struct LogBuffer {
    inner: String,
    hook: Option<DeployLogHook>,
}

impl LogBuffer {
    pub fn new(hook: Option<DeployLogHook>) -> Self {
        Self {
            inner: String::new(),
            hook,
        }
    }

    pub fn push_str(&mut self, s: &str) {
        self.inner.push_str(s);
        if let Some(h) = &self.hook {
            h(&self.inner);
        }
    }

    pub fn as_str(&self) -> &str {
        &self.inner
    }

    pub fn into_string(self) -> String {
        self.inner
    }
}

impl std::fmt::Display for LogBuffer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.inner)
    }
}

impl AsRef<str> for LogBuffer {
    fn as_ref(&self) -> &str {
        &self.inner
    }
}

fn data_dir_base() -> std::path::PathBuf {
    if let Ok(v) = std::env::var("DEVFORGE_DATA_DIR") {
        return std::path::PathBuf::from(v);
    }
    std::env::current_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("data")
}

/// Join `rel` (repo-relative, `/` or `.` = root) under `workdir`.
fn resolve_repo_subdir(workdir: &str, rel: &str) -> String {
    let r = rel.trim();
    if r.is_empty() || r == "/" || r == "." {
        workdir.to_string()
    } else {
        let b = r.trim_start_matches("./").trim_start_matches('/');
        format!("{workdir}/{b}")
    }
}

fn normalize_repo_rel(rel: &str) -> String {
    rel.trim()
        .trim_start_matches("./")
        .trim_start_matches('/')
        .to_string()
}

/// Path of `abs` relative to `workdir`, or `.` when equal. Falls back to `abs`.
fn path_relative_to(abs: &str, workdir: &str) -> String {
    let abs = abs.trim_end_matches('/');
    let workdir = workdir.trim_end_matches('/');
    if abs == workdir {
        ".".into()
    } else if let Some(rest) = abs.strip_prefix(workdir) {
        let rest = rest.trim_start_matches('/');
        if rest.is_empty() {
            ".".into()
        } else {
            rest.to_string()
        }
    } else {
        abs.to_string()
    }
}

fn resolve_workdir(workdir: &str, project_uuid: &str) -> String {
    let w = workdir.trim();
    // Unix-style /data/... paths are remapped on Windows to a local data dir.
    let needs_local =
        w.is_empty() || (cfg!(windows) && (w.starts_with('/') || w.starts_with("/data")));
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

/// Source du `git fetch` quand le workdir contient déjà un `.git`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FetchFrom<'a> {
    /// `git fetch origin` : uniquement sans jeton (dépôt public, ou remote géré à la main).
    Origin,
    /// `git fetch <url> +refs/heads/<b>:refs/remotes/origin/<b>` : l'authentification ne
    /// dépend jamais des identifiants (éventuellement absents) du remote `origin`.
    Url(&'a str),
}

/// Commande shell pour synchroniser Git : fetch/pull si .git existe, sinon clone.
///
/// IMPORTANT : Gère le cas du workdir non-vide sans .git (issue #2) :
/// - Si .git existe : fetch + checkout + reset
/// - Si .git n'existe pas mais le workdir a des fichiers : clone dans .tmp puis move
/// - Si le workdir est vide : clone directement
///
/// `clean_remote` : si fourni, `origin` est réécrit sur cette URL (sans jeton) après la
/// synchro — un jeton passé dans `clone_url` ne reste jamais dans `.git/config`.
fn git_sync_command(
    workdir: &str,
    clone_url: &str,
    branch: &str,
    fetch_from: FetchFrom<'_>,
    clean_remote: Option<&str>,
) -> String {
    let w = shell_single_quote(workdir);
    let url = shell_single_quote(clone_url);
    let b = shell_single_quote(branch);
    if cfg!(windows) {
        // LocalShellExecutor runs via PowerShell — keep native PS syntax.
        let wp = workdir.replace('\'', "''");
        let up = clone_url.replace('\'', "''").replace('"', "");
        let bp = branch.replace('\'', "''");
        let fetch = match fetch_from {
            FetchFrom::Origin => format!("git -C '{wp}' fetch origin"),
            FetchFrom::Url(u) => {
                let fp = u.replace('\'', "''").replace('"', "");
                format!("git -C '{wp}' fetch '{fp}' '+refs/heads/{bp}:refs/remotes/origin/{bp}'")
            }
        };
        let clean = match clean_remote {
            Some(c) => {
                let cp = c.replace('\'', "''").replace('"', "");
                format!("git -C '{wp}' remote set-url origin '{cp}' 2>$null; ")
            }
            None => String::new(),
        };
        format!(
            "if (Test-Path -LiteralPath '{wp}\\.git') {{ \
                {clean}{fetch}; if ($LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }}; \
                git -C '{wp}' checkout '{bp}'; if ($LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }}; \
                git -C '{wp}' reset --hard origin/{bp}; exit $LASTEXITCODE \
            }} else {{ \
                if (Test-Path -LiteralPath '{wp}' ) {{ \
                    $files = Get-ChildItem -LiteralPath '{wp}' -Force -ErrorAction SilentlyContinue; \
                    if ($files.Count -gt 0) {{ \
                        $tmp = '{wp}.tmp.git'; \
                        git clone --branch '{bp}' --single-branch '{up}' $tmp; \
                        if ($LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }}; \
                        Get-ChildItem -Path $tmp -Force | Move-Item -Destination '{wp}' -Force; \
                        Remove-Item -Path $tmp -Force -ErrorAction SilentlyContinue; \
                        {clean}exit 0 \
                    }} \
                }}; \
                git clone --branch '{bp}' --single-branch '{up}' '{wp}'; $rc = $LASTEXITCODE; \
                if ($rc -eq 0) {{ {clean}}}; exit $rc \
            }}"
        )
    } else {
        let fetch = match fetch_from {
            FetchFrom::Origin => format!("git -C {w} fetch origin"),
            FetchFrom::Url(u) => format!(
                "git -C {w} fetch {} {}",
                shell_single_quote(u),
                shell_single_quote(&format!(
                    "+refs/heads/{branch}:refs/remotes/origin/{branch}"
                ))
            ),
        };
        let sync = format!(
            "if [ -d {w}/.git ]; then \
                {fetch} && git -C {w} checkout {b} && git -C {w} reset --hard origin/{b}; \
            else \
                if [ -d {w} ] && [ \"$(ls -A {w} 2>/dev/null)\" ]; then \
                    tmp=\"{w}.tmp.git\"; \
                    git clone --branch {b} --single-branch {url} \"$tmp\" && \
                    mv \"$tmp\"/.git {w}/.git && \
                    mv \"$tmp\"/* {w}/ 2>/dev/null; \
                    mv \"$tmp\"/.[!.]* {w}/ 2>/dev/null; \
                    rm -rf \"$tmp\"; \
                else \
                    git clone --branch {b} --single-branch {url} {w}; \
                fi; \
            fi"
        );
        match clean_remote {
            // Le remote est nettoyé quoi qu'il arrive (succès ou échec), le code
            // de sortie reste celui de la synchro.
            Some(c) => format!(
                "{{ {sync}; }}; rc=$?; \
                 if [ -d {w}/.git ]; then git -C {w} remote set-url origin {} 2>/dev/null; fi; \
                 (exit $rc)",
                shell_single_quote(c)
            ),
            None => sync,
        }
    }
}

/// Variante authentifiée (GitHub App **ou** jeton classique) : l'authentification passe par
/// `http.<github>.extraheader` via les variables `GIT_CONFIG_*` (git ≥ 2.31), le remote est
/// (ré)écrit sans token et le fetch vise l'URL explicite : rien n'est persisté dans
/// `.git/config` et la synchro ne dépend jamais d'identifiants stockés dans `origin`.
fn git_sync_command_header_auth(
    workdir: &str,
    clean_url: &str,
    branch: &str,
    token: &str,
) -> String {
    let w = shell_single_quote(workdir);
    let url = shell_single_quote(clean_url);
    let header = shell_single_quote(&format!("AUTHORIZATION: basic {}", basic_auth_value(token)));
    let base = git_sync_command(workdir, clean_url, branch, FetchFrom::Url(clean_url), None);
    format!(
        "export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.https://github.com/.extraheader GIT_CONFIG_VALUE_0={header} GIT_TERMINAL_PROMPT=0; \
         if [ -d {w}/.git ]; then git -C {w} remote set-url origin {url}; fi; \
         {base}"
    )
}

fn basic_auth_value(token: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(format!("x-access-token:{token}"))
}

/// Masque le jeton (en clair, en Basic base64, dans une URL) d'une sortie git avant les logs.
fn redact_git_output(text: &str, token: Option<&str>) -> String {
    let mut out = text.to_string();
    if let Some(t) = token.map(str::trim).filter(|t| t.len() >= 4) {
        out = out.replace(&basic_auth_value(t), "***");
        out = out.replace(t, "***");
    }
    devforge_shared::redact::redact_urls_in_text(&out)
}

/// Ligne `[git] auth : …` des logs de déploiement (jamais de secret).
fn git_auth_log_line(token: Option<&str>, ephemeral: bool, note: Option<&str>) -> String {
    let has_token = token.map(|t| !t.trim().is_empty()).unwrap_or(false);
    let mode = match (has_token, ephemeral) {
        (false, _) => "aucun jeton (accès anonyme : dépôts publics uniquement)",
        (true, true) => "GitHub App (jeton d'installation limité au dépôt)",
        (true, false) => "jeton classique (PAT d'instance)",
    };
    let transport = if !has_token {
        ""
    } else if cfg!(windows) {
        ", URL explicite puis remote nettoyé"
    } else {
        ", en-tête HTTP, jamais écrit dans .git/config"
    };
    let mut line = format!("[git] auth : {mode}{transport}");
    if let Some(n) = note.map(str::trim).filter(|n| !n.is_empty()) {
        line.push_str(" — ");
        line.push_str(&redact_git_output(n, token));
    }
    line.push('\n');
    line
}

/// Suffixe shell qui fixe le dépôt sur un commit précis (après la synchro de branche).
fn pin_sha_suffix(workdir: &str, sha: &str, fetch_from: FetchFrom<'_>) -> Option<String> {
    let sha = sha.trim();
    if !(7..=40).contains(&sha.len()) || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let w = shell_single_quote(workdir);
    let src = match fetch_from {
        FetchFrom::Origin => "origin".to_string(),
        FetchFrom::Url(u) => shell_single_quote(u),
    };
    Some(format!(
        " && git -C {w} fetch {src} {sha} && git -C {w} reset --hard {sha}"
    ))
}

fn shell_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

fn trim_out(s: &str) -> String {
    const MAX_TOTAL: usize = 8000;
    const HEAD_CHARS: usize = 2000;
    const TAIL_CHARS: usize = 6000;

    if s.chars().count() <= MAX_TOTAL {
        return s.to_string();
    }

    let head: String = s.chars().take(HEAD_CHARS).collect();
    let tail: String = s
        .chars()
        .rev()
        .take(TAIL_CHARS)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();

    format!(
        "{}\n…[truncated {} chars]…\n{}",
        head,
        s.chars().count() - HEAD_CHARS - TAIL_CHARS,
        tail
    )
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
    let nitro_mjs = dir.join(".output/server/index.mjs");
    let nitro_js = dir.join(".output/server/index.js");
    let entry = dir.join("dist/server/entry.mjs");
    let mut cmd = if nitro_mjs.is_file() {
        let mut c = Command::new("node");
        c.arg(&nitro_mjs);
        c
    } else if nitro_js.is_file() {
        let mut c = Command::new("node");
        c.arg(&nitro_js);
        c
    } else if entry.is_file() {
        let mut c = Command::new("node");
        c.arg(&entry);
        c
    } else if cfg!(windows) {
        let mut c = Command::new("npm.cmd");
        c.args(["run", "start"]);
        c
    } else {
        let mut c = Command::new("sh");
        c.arg("-c");
        c.arg(docker::npm_start_if_present_shell());
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

pub fn project_container_name(project_uuid: &str) -> String {
    format!("df-{}", project_uuid.chars().take(12).collect::<String>())
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

    /// Best-effort : arrête le conteneur blue-green temporaire (`df-…-new`)
    /// sans toucher au conteneur de production. À appeler quand un deploy
    /// en cours est supersédé.
    pub async fn abort_in_flight_swap(&self, project_uuid: &str, server_id: &str) {
        let name = Self::container_name(project_uuid);
        let new_name = format!("{name}-new");
        let server = if server_id.trim().is_empty() {
            "default"
        } else {
            server_id.trim()
        };
        let cmd = format!("docker rm -f {new_name} 2>/dev/null || true");
        match self.executor.exec(server, "", &cmd, 30).await {
            Ok(r) => {
                if !r.output.trim().is_empty() {
                    tracing::info!(
                        project = %project_uuid,
                        container = %new_name,
                        out = %r.output.trim(),
                        "Conteneur blue-green temporaire nettoyé (supersede)"
                    );
                }
            }
            Err(e) => {
                tracing::debug!(
                    project = %project_uuid,
                    error = %e,
                    "Nettoyage blue-green supersede ignoré"
                );
            }
        }
    }

    fn container_name(project_uuid: &str) -> String {
        project_container_name(project_uuid)
    }

    fn sidecar_network(app_container: &str) -> String {
        format!("dfside-{}", app_container.trim_start_matches("df-"))
    }

    pub fn image_name(project_uuid: &str) -> String {
        format!(
            "df-{}:latest",
            project_uuid.chars().take(12).collect::<String>()
        )
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
        self.deploy_with_log_hook(req, None).await
    }

    /// Comme `deploy`, avec notification live des logs (flush UI pendant le build).
    pub async fn deploy_with_log_hook(
        &self,
        req: &DeployRequest,
        on_log: Option<DeployLogHook>,
    ) -> DeployResult {
        let mut logs = LogBuffer::new(on_log);
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
                    logs.push_str(&format!("[error] mkdir: {e} / {fs_e}\n"));
                    return DeployResult {
                        ok: false,
                        git_sha: None,
                        logs: logs.into_string(),
                    };
                }
            }
        } else {
            logs.push_str("[mkdir] ok\n");
        }

        // Sync git
        let branch = if req.git_branch.trim().is_empty() {
            "main"
        } else {
            req.git_branch.trim()
        };
        // Jeton (App ou classique) : toujours en en-tête + fetch sur l'URL explicite, jamais
        // `git fetch origin` sur un remote sans identifiants, jamais de jeton dans .git/config.
        let token = req
            .github_token
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty());
        logs.push_str(&git_auth_log_line(
            token,
            req.github_token_ephemeral,
            req.github_auth_note.as_deref(),
        ));
        let clean = git_clone_url(&req.git_repository, None);
        let (sync_cmd, pin_from) = match token {
            Some(tok) if !cfg!(windows) => (
                git_sync_command_header_auth(&workdir, &clean, branch, tok),
                FetchFrom::Url(clean.as_str()),
            ),
            Some(tok) => {
                let auth_url = git_clone_url(&req.git_repository, Some(tok));
                (
                    git_sync_command(
                        &workdir,
                        &auth_url,
                        branch,
                        FetchFrom::Url(&auth_url),
                        Some(&clean),
                    ),
                    FetchFrom::Origin,
                )
            }
            None => (
                git_sync_command(&workdir, &clean, branch, FetchFrom::Origin, None),
                FetchFrom::Origin,
            ),
        };
        let sync_cmd = match req.pin_sha.as_deref() {
            Some(sha) if !cfg!(windows) => match pin_sha_suffix(&workdir, sha, pin_from) {
                Some(suffix) => {
                    logs.push_str(&format!("[git] commit demandé : {sha}\n"));
                    format!("{sync_cmd}{suffix}")
                }
                None => {
                    logs.push_str("[git] SHA demandé invalide — tête de branche déployée\n");
                    sync_cmd
                }
            },
            _ => sync_cmd,
        };
        logs.push_str("[git] synchronisation en cours…\n");
        match self
            .exec_with_heartbeat(server, "", &sync_cmd, 600, &mut logs, "git")
            .await
        {
            Ok(r) => {
                logs.push_str(&format!(
                    "[git] exit={} {}\n",
                    r.exit_code,
                    redact_git_output(&trim_out(&r.output), token)
                ));
                if !r.ok {
                    return DeployResult {
                        ok: false,
                        git_sha: None,
                        logs: logs.into_string(),
                    };
                }
            }
            Err(e) => {
                logs.push_str(&format!(
                    "[git] error: {}\n",
                    redact_git_output(&e.to_string(), token)
                ));
                return DeployResult {
                    ok: false,
                    git_sha: None,
                    logs: logs.into_string(),
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

        // Marqueurs de conflit Git commités (incident devforge-esp 11/10) : échec immédiat et
        // lisible plutôt qu'un build Docker qui plante loin dans les logs.
        if !cfg!(windows) {
            if let Ok(r) = self
                .executor
                .exec(server, &workdir, CONFLICT_GREP_CMD, 60)
                .await
            {
                if let Some(msg) = conflict_marker_message(r.exit_code, &r.output) {
                    logs.push_str(&msg);
                    return DeployResult {
                        ok: false,
                        git_sha: sha,
                        logs: logs.into_string(),
                    };
                }
            }
        }

        // Clone env projet → workdir `.env` (source de vérité = DB / req.env_file).
        // Si aucune var : supprimer un éventuel leftover (évite mélange entre projets).
        {
            let env_path = std::path::PathBuf::from(&workdir).join(".env");
            match req
                .env_file
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                Some(env_body) => {
                    if std::fs::write(&env_path, env_body).is_ok() {
                        logs.push_str("[env] cloned project env → .env\n");
                    } else {
                        let escaped = env_body.replace('\'', "'\\''");
                        let write_cmd = format!("printf '%s' '{escaped}' > .env");
                        match self.executor.exec(server, &workdir, &write_cmd, 30).await {
                            Ok(r) => {
                                logs.push_str(&format!("[env] remote clone exit={}\n", r.exit_code))
                            }
                            Err(e) => logs.push_str(&format!("[env] write error: {e}\n")),
                        }
                    }
                }
                None => {
                    let _ = std::fs::remove_file(&env_path);
                    let rm = "rm -f .env 2>/dev/null; true";
                    let _ = self.executor.exec(server, &workdir, rm, 15).await;
                    logs.push_str("[env] no project env — cleared stale .env\n");
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
                    logs: logs.into_string(),
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
                logs: logs.into_string(),
            };
        }

        let package_json = self.read_package_json(server, &build_dir).await;
        let nitro_server = package_json
            .as_deref()
            .is_some_and(docker::package_json_is_nitro_server);
        let explicit_pack = matches!(req.build_pack.as_str(), "dockercompose" | "dockerfile");

        let extras = ContainerExtras {
            gpu_nvidia: req.gpu_nvidia,
            gpu_dri: req.gpu_dri,
            group_network: req.group_network.clone(),
            group_alias: req.group_alias.clone(),
            volumes: req.volumes.clone(),
            runtime: req.runtime.clone(),
        };

        let build_ok = if nitro_server && !explicit_pack {
            self.deploy_nitro_node(
                server,
                &build_dir,
                &image,
                &name,
                port,
                req.proxy_labels.as_ref(),
                &mut logs,
                &extras,
            )
            .await
        } else {
            match req.build_pack.as_str() {
                "dockercompose" => {
                    if extras.gpu_nvidia || extras.gpu_dri || extras.group_network.is_some() {
                        logs.push_str(
                        "[compose] GPU et réseau de groupe non appliqués (chemin docker compose)\n",
                    );
                    }
                    if !extras.volumes.is_empty() || !extras.runtime.sidecars.is_empty() {
                        logs.push_str(
                        "[compose] montages, ports extra, sidecars et healthcheck du projet ne sont pas injectés — déclare-les dans le fichier compose\n",
                    );
                    }
                    let compose = req
                        .docker_compose_location
                        .as_deref()
                        .unwrap_or("/docker-compose.yaml")
                        .trim_start_matches('/');
                    let cmd = docker::docker_compose_up(compose);
                    logs.push_str("[compose] démarrage…\n");
                    match self
                        .exec_with_heartbeat(
                            server,
                            &build_dir,
                            &cmd,
                            docker_build_timeout_secs(),
                            &mut logs,
                            "compose",
                        )
                        .await
                    {
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
                    logs.push_str("[static-build] démarrage…\n");
                    match self
                        .exec_with_heartbeat(
                            server,
                            &build_dir,
                            &cmd,
                            docker_build_timeout_secs(),
                            &mut logs,
                            "static-build",
                        )
                        .await
                    {
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
                                    &extras,
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
                    let explicit_df = req
                        .dockerfile_path
                        .as_deref()
                        .map(str::trim)
                        .filter(|s| !s.is_empty());
                    let explicit_ctx = req
                        .docker_build_context
                        .as_deref()
                        .map(str::trim)
                        .filter(|s| !s.is_empty());
                    let context_dir = resolve_repo_subdir(
                        &workdir,
                        explicit_ctx.unwrap_or(req.base_directory.trim()),
                    );
                    let (cmd, label, exec_cwd) = if explicit_df.is_some() || explicit_ctx.is_some()
                    {
                        let df_rel = match explicit_df {
                            Some(p) => normalize_repo_rel(p),
                            None => {
                                // Dockerfile par defaut dans le contexte, chemin relatif a workdir
                                let abs = format!("{context_dir}/Dockerfile");
                                path_relative_to(&abs, &workdir)
                            }
                        };
                        let ctx_rel = path_relative_to(&context_dir, &workdir);
                        let cmd = builders::dockerfile_image_build_cmd(&image, &df_rel, &ctx_rel);
                        (
                            cmd,
                            format!("docker build -f {df_rel} {ctx_rel}"),
                            workdir.clone(),
                        )
                    } else {
                        let (cmd, label) = builders::fallback_image_build_cmd(&image, port);
                        (cmd, label.to_string(), build_dir.clone())
                    };
                    logs.push_str(&format!("[dockerfile] {label}\n"));
                    logs.push_str("[docker-build] démarrage…\n");
                    match self
                        .exec_with_heartbeat(
                            server,
                            &exec_cwd,
                            &cmd,
                            docker_build_timeout_secs(),
                            &mut logs,
                            "docker-build",
                        )
                        .await
                    {
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
                                    &extras,
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
                        builders::nixpacks_image(),
                        build_envs
                            .iter()
                            .map(|(k, _)| k.as_str())
                            .collect::<Vec<_>>()
                            .join(",")
                    ));
                    logs.push_str("[nixpacks-docker] build en cours…\n");
                    match self
                        .exec_with_heartbeat(
                            server,
                            &build_dir,
                            &nix,
                            docker_build_timeout_secs().max(1800),
                            &mut logs,
                            "nixpacks",
                        )
                        .await
                    {
                        Ok(r) if r.ok => {
                            logs.push_str(&format!("[nixpacks-docker] {}\n", trim_out(&r.output)));
                            self.docker_restart_container(
                                server,
                                &build_dir,
                                &name,
                                &image,
                                port,
                                port,
                                req.proxy_labels.as_ref(),
                                &mut logs,
                                &extras,
                            )
                            .await
                        }
                        Ok(r) => {
                            logs.push_str(&format!(
                                "[nixpacks-docker] exit={} {}\n",
                                r.exit_code,
                                trim_out(&r.output)
                            ));
                            let (cmd, label) = builders::fallback_image_build_cmd(&image, port);
                            logs.push_str(&format!("[fallback] {label}\n"));
                            logs.push_str("[docker-build] démarrage…\n");
                            match self
                                .exec_with_heartbeat(
                                    server,
                                    &build_dir,
                                    &cmd,
                                    docker_build_timeout_secs(),
                                    &mut logs,
                                    "docker-build",
                                )
                                .await
                            {
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
                                            &extras,
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
                            let (cmd, label) = builders::fallback_image_build_cmd(&image, port);
                            logs.push_str(&format!("[fallback] {label}\n"));
                            logs.push_str("[docker-build] démarrage…\n");
                            match self
                                .exec_with_heartbeat(
                                    server,
                                    &build_dir,
                                    &cmd,
                                    docker_build_timeout_secs(),
                                    &mut logs,
                                    "docker-build",
                                )
                                .await
                            {
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
                                            &extras,
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
            }
        };

        if build_ok && !cfg!(windows) {
            // Tag de rollback : `:latest` est réécrit à chaque build, ce tag garde
            // l'image de ce déploiement (le nettoyage Docker en conserve N par projet).
            let cmd = rollback_tag_command(&image, unix_now_secs());
            if let Ok(r) = self.executor.exec(server, "", &cmd, 30).await {
                if r.ok && !r.output.trim().is_empty() {
                    logs.push_str(&format!("[image] {}\n", r.output.trim()));
                }
            }
        }

        if !build_ok {
            logs.push_str(
                "[fallback] image Docker non démarrée — pas de processus local (il ne crée pas de route publique)\n",
            );
        }

        logs.push_str(if build_ok {
            "[devforge] deploy OK\n"
        } else {
            "[devforge] deploy FAILED\n"
        });

        DeployResult {
            ok: build_ok,
            git_sha: sha,
            logs: logs.into_string(),
        }
    }

    /// Exécute une commande longue en émettant un heartbeat dans les logs
    /// (pour que l’UI live ne reste pas figée pendant un docker build).
    async fn exec_with_heartbeat(
        &self,
        server_id: &str,
        workdir: &str,
        command: &str,
        timeout_secs: u64,
        logs: &mut LogBuffer,
        label: &str,
    ) -> Result<ExecResult> {
        let fut = self
            .executor
            .exec(server_id, workdir, command, timeout_secs);
        tokio::pin!(fut);
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(15));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        interval.tick().await; // ignore le tick immédiat
        let started = std::time::Instant::now();
        loop {
            tokio::select! {
                result = &mut fut => return result,
                _ = interval.tick() => {
                    logs.push_str(&format!(
                        "[{label}] toujours en cours… ({}s)\n",
                        started.elapsed().as_secs()
                    ));
                }
            }
        }
    }

    async fn read_package_json(&self, server: &str, dir: &str) -> Option<String> {
        let local = std::path::Path::new(dir).join("package.json");
        if let Ok(text) = std::fs::read_to_string(&local) {
            if !text.trim().is_empty() {
                return Some(text);
            }
        }
        match self
            .executor
            .exec(server, dir, "cat package.json", 20)
            .await
        {
            Ok(r) if r.ok && !r.output.trim().is_empty() => Some(r.output),
            _ => None,
        }
    }

    /// Nitro / TanStack Start : image Node qui écoute le port du projet.
    /// Traefik cible ce port ; on ne publie pas 80/443 sur l’hôte.
    async fn deploy_nitro_node(
        &self,
        server: &str,
        build_dir: &str,
        image: &str,
        name: &str,
        port: u16,
        proxy_labels: Option<&serde_json::Value>,
        logs: &mut LogBuffer,
        extras: &ContainerExtras,
    ) -> bool {
        logs.push_str(
            "[nitro] serveur Node (TanStack Start / Nitro) — image node_server, pas nginx/dist\n",
        );
        let df = docker::nitro_node_dockerfile(port);
        let cmd = docker::docker_build_from_content(image, &df);
        logs.push_str("[nitro-build] démarrage…\n");
        match self
            .exec_with_heartbeat(
                server,
                build_dir,
                &cmd,
                docker_build_timeout_secs(),
                logs,
                "nitro-build",
            )
            .await
        {
            Ok(r) => {
                logs.push_str(&format!(
                    "[nitro-build] exit={} {}\n",
                    r.exit_code,
                    trim_out(&r.output)
                ));
                if r.ok {
                    self.docker_restart_container(
                        server,
                        build_dir,
                        name,
                        image,
                        port,
                        port,
                        proxy_labels,
                        logs,
                        extras,
                    )
                    .await
                } else {
                    false
                }
            }
            Err(e) => {
                logs.push_str(&format!("[nitro-build] error: {e}\n"));
                false
            }
        }
    }

    async fn probe_docker(&self, server: &str, logs: &mut LogBuffer) -> bool {
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
        logs: &mut LogBuffer,
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

        let build = docker::npm_build_if_present_shell();
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

        let mut refused = String::new();
        for attempt in 1..=8 {
            match probe_local_http(port).await {
                Ok(code) => {
                    logs.push_str(&format!("[local-node] probe http={code}\n"));
                    return matches!(
                        code.as_str(),
                        "200" | "301" | "302" | "307" | "308" | "alive"
                    );
                }
                Err(e) => {
                    refused = e;
                    if attempt < 8 {
                        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    }
                }
            }
        }
        logs.push_str(&format!("[local-node] probe error: {refused}\n"));
        false
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
        logs: &mut LogBuffer,
        extras: &ContainerExtras,
    ) -> bool {
        // BLUE/GREEN DEPLOY STRATEGY:
        // 1. Check if old container exists and is healthy → keep as fallback
        // 2. Start new container with temp name
        // 3. Wait for healthcheck (HTTP probe or running state)
        // 4. If new is healthy: stop old, rename new → production name
        // 5. If new fails: stop new, keep old running

        let old_exists = self.container_exists(server, workdir, name).await;
        let old_is_healthy = if old_exists {
            self.container_is_healthy(server, workdir, name, logs).await
        } else {
            false
        };

        if old_is_healthy {
            logs.push_str(&format!(
                "[blue-green] Ancien conteneur {} en production (healthy) — protection activée\n",
                name
            ));
        } else if old_exists {
            logs.push_str(&format!(
                "[blue-green] Ancien conteneur {} existe mais pas healthy\n",
                name
            ));
        }

        // Ports hôte 80/443 = entrée du reverse proxy DevForge (Traefik). Incident 2026-09-25 :
        // un projet static avec port=80 publiait `-p 80:80` → prepare supprimait
        // `devforge-traefik` (il publie 80) et le site captait TOUT le trafic du nœud.
        // Jamais de libération ni de publication de ces ports pour une app.
        let reserved_port = docker::is_proxy_reserved_host_port(host_port);
        if reserved_port {
            logs.push_str(&format!(
                "[prepare] port hôte {host_port} réservé au reverse proxy — pas de publication sur ce port\n"
            ));
        } else {
            // Free the host port if needed (only kill containers publishing same port, not our production container yet)
            let prepare = docker::docker_prepare_run_except(name, host_port);
            match self.executor.exec(server, workdir, &prepare, 60).await {
                Ok(r) => {
                    if !r.output.trim().is_empty() {
                        logs.push_str(&format!("[prepare] {}\n", trim_out(&r.output)));
                    }
                }
                Err(e) => logs.push_str(&format!("[prepare] warn: {e}\n")),
            }
        }

        // Vérifier `.env` via l’executor (local ou remote), pas seulement le FS local.
        let env_file = {
            let local = std::path::Path::new(&format!("{workdir}/.env")).exists();
            if local {
                Some(".env")
            } else {
                match self
                    .executor
                    .exec(server, workdir, "test -f .env", 10)
                    .await
                {
                    Ok(r) if r.ok => Some(".env"),
                    _ => None,
                }
            }
        };

        // Try to get network from env, then auto-detect if Traefik labels are present
        let mut network = std::env::var("DEVFORGE_DOCKER_NETWORK")
            .ok()
            .filter(|s| !s.trim().is_empty());

        let has_traefik_labels = proxy_labels.is_some();

        if has_traefik_labels && network.is_none() {
            logs.push_str(
                "[start] DEVFORGE_DOCKER_NETWORK not set, attempting auto-detection...\n",
            );
            let detect_cmd = docker::docker_detect_traefik_network();
            match self.executor.exec(server, workdir, &detect_cmd, 20).await {
                Ok(r) if r.ok && !r.output.trim().is_empty() => {
                    let detected = r.output.trim().to_string();
                    if detected == "host-network-detected" {
                        logs.push_str("[start] ✓ Detected host-network proxy\n");
                    } else {
                        logs.push_str(&format!(
                            "[start] ✓ Detected Traefik network: {}\n",
                            detected
                        ));
                        network = Some(detected);
                    }
                }
                _ => {
                    logs.push_str("[start] Auto-detection failed, trying fallback networks...\n");
                    for candidate in ["devforge-net", "traefik-public", "traefik"] {
                        let check = format!(
                            "docker network inspect {} >/dev/null 2>&1 && echo {}",
                            candidate, candidate
                        );
                        if let Ok(r) = self.executor.exec(server, workdir, &check, 5).await {
                            if r.ok && !r.output.trim().is_empty() {
                                logs.push_str(&format!(
                                    "[start] Using fallback network: {}\n",
                                    candidate
                                ));
                                network = Some(candidate.to_string());
                                break;
                            }
                        }
                    }
                }
            }
        }

        let ports = if has_traefik_labels && network.is_some() {
            vec![]
        } else if reserved_port {
            // Port hôte éphémère attribué par Docker (jamais 80/443).
            vec![(0, container_port)]
        } else {
            vec![(host_port, container_port)]
        };

        // Start NEW container with temporary name (blue/green)
        let new_name = format!("{}-new", name);

        // Remove any leftover -new container from previous failed deploy
        let cleanup_new = format!("docker rm -f {} 2>/dev/null || true", new_name);
        let _ = self.executor.exec(server, workdir, &cleanup_new, 10).await;

        if has_traefik_labels {
            logs.push_str("[start] Traefik labels will be applied AFTER healthcheck (prevent Host theft #106)\n");
            if network.is_some() {
                logs.push_str("[start] Routing via Docker network (no host port)\n");
            }
        }

        logs.push_str(&format!(
            "[blue-green] Starting new container: {} ...\n",
            new_name
        ));

        // CRITICAL: Start new container WITHOUT Traefik labels first (prevent Host theft #106)
        // Labels will be applied only after healthcheck passes
        if !extras.volumes.is_empty() {
            logs.push_str(&format!("[volumes] {}\n", extras.volumes.join(" ")));
        }
        if extras.runtime.memory.is_some() || extras.runtime.cpus.is_some() {
            logs.push_str(&format!(
                "[runtime] memory={} cpus={}\n",
                extras.runtime.memory.as_deref().unwrap_or("—"),
                extras.runtime.cpus.as_deref().unwrap_or("—"),
            ));
        }
        if !extras.runtime.ports.is_empty() {
            logs.push_str(&format!(
                "[runtime] ports {}\n",
                extras
                    .runtime
                    .ports
                    .iter()
                    .map(|p| p.publish_flag())
                    .collect::<Vec<_>>()
                    .join(" ")
            ));
        }

        let side_net = Self::sidecar_network(name);
        if !self
            .start_sidecars(server, workdir, name, &side_net, extras, logs)
            .await
        {
            logs.push_str("[sidecar] échec — l’app en production n’est pas remplacée\n");
            return false;
        }

        let tune = crate::runtime::RunTune::from_runtime(&extras.runtime);
        let run_no_labels = docker::docker_run_ex(
            &new_name,
            image,
            &ports,
            env_file,
            network.as_deref(),
            None, // NO proxy labels yet
            extras.gpu_nvidia,
            extras.gpu_dri,
            &extras.volumes,
            &tune,
            Some(container_port),
        );

        let new_started = match self
            .executor
            .exec(server, workdir, &run_no_labels, 120)
            .await
        {
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
        };

        if !new_started {
            logs.push_str("[blue-green] ❌ Échec démarrage nouveau conteneur\n");
            if old_is_healthy {
                logs.push_str(&format!("[blue-green] ✅ Ancien conteneur {} reste en production (aucune interruption)\n", name));
            }
            return false;
        }

        if !extras.runtime.sidecars.is_empty() {
            logs.push_str(&format!("[sidecar] réseau {side_net}\n"));
            let cmd = docker::docker_network_attach(&side_net, &new_name, None);
            match self.executor.exec(server, workdir, &cmd, 30).await {
                Ok(r) if r.ok => logs.push_str("[sidecar] app reliée aux services\n"),
                Ok(r) => logs.push_str(&format!("[sidecar] warn: {}\n", trim_out(&r.output))),
                Err(e) => logs.push_str(&format!("[sidecar] warn: {e}\n")),
            }
        }

        if let Some(net) = extras.group_network.as_deref().filter(|s| !s.is_empty()) {
            logs.push_str(&format!("[group] réseau {net}\n"));
            let cmd = docker::docker_network_attach(net, &new_name, None);
            match self.executor.exec(server, workdir, &cmd, 30).await {
                Ok(r) if r.ok => logs.push_str("[group] conteneur relié au réseau du groupe\n"),
                Ok(r) => logs.push_str(&format!("[group] warn: {}\n", trim_out(&r.output))),
                Err(e) => logs.push_str(&format!("[group] warn: {e}\n")),
            }
        }

        // Disponibilité HTTP réelle (pas seulement « running ») avant toute bascule.
        logs.push_str("[blue-green] Attente disponibilité HTTP du nouveau conteneur...\n");
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;

        let new_is_healthy = self
            .wait_container_ready(
                server,
                workdir,
                &new_name,
                network.as_deref(),
                container_port,
                logs,
            )
            .await;

        if !new_is_healthy {
            logs.push_str("[blue-green] ❌ Nouveau conteneur failed healthcheck\n");
            let _ = self
                .executor
                .exec(server, workdir, &format!("docker rm -f {}", new_name), 30)
                .await;
            if old_is_healthy {
                logs.push_str(&format!("[blue-green] ✅ Ancien conteneur {} reste en production (déploiement annulé, pas d'interruption)\n", name));
            }
            return false;
        }

        logs.push_str("[blue-green] ✅ Nouveau conteneur healthy\n");

        // NOW apply Traefik labels (only after healthcheck passed) — prevents Host theft #106
        if has_traefik_labels {
            logs.push_str("[blue-green] Application des labels Traefik au nouveau conteneur (après healthcheck)...\n");
            let update_labels = docker::docker_update_labels(&new_name, proxy_labels.unwrap());
            match self
                .executor
                .exec(server, workdir, &update_labels, 60)
                .await
            {
                Ok(r) if r.ok => {
                    logs.push_str("[blue-green] ✅ Labels Traefik appliqués\n");
                }
                Ok(r) => {
                    logs.push_str(&format!(
                        "[blue-green] ⚠️ Erreur application labels: {}\n",
                        trim_out(&r.output)
                    ));
                }
                Err(e) => {
                    logs.push_str(&format!(
                        "[blue-green] ⚠️ Erreur application labels (docker_update_labels, plateforme): {}\n",
                        e
                    ));
                }
            }
        }

        // La pose des labels recrée le conteneur (redémarrage à froid) : il faut
        // re-vérifier qu’il répond AVANT d’arrêter l’ancien, sinon fenêtre 404/502.
        if has_traefik_labels {
            if !extras.runtime.sidecars.is_empty() {
                let cmd = docker::docker_network_attach(&side_net, &new_name, None);
                let _ = self.executor.exec(server, workdir, &cmd, 30).await;
            }
            let ready = self
                .wait_container_ready(
                    server,
                    workdir,
                    &new_name,
                    network.as_deref(),
                    container_port,
                    logs,
                )
                .await;
            if !ready {
                logs.push_str("[blue-green] ❌ Nouveau conteneur non disponible après pose des labels — bascule annulée\n");
                let _ = self
                    .executor
                    .exec(server, workdir, &format!("docker rm -f {}", new_name), 30)
                    .await;
                if old_exists {
                    logs.push_str(&format!(
                        "[blue-green] ✅ Ancien conteneur {} reste en production (déploiement échoué, pas d'interruption)\n",
                        name
                    ));
                }
                return false;
            }
            if old_exists {
                // Laisse le reverse proxy intégrer le nouveau backend avant de retirer l’ancien.
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
            }
        }

        // Cutover: stop old, rename new → production
        if old_exists {
            logs.push_str(&format!(
                "[blue-green] Arrêt ancien conteneur {} ...\n",
                name
            ));
            let stop_old = format!("docker stop {} && docker rm -f {}", name, name);
            let _ = self.executor.exec(server, workdir, &stop_old, 30).await;
        }

        logs.push_str(&format!(
            "[blue-green] Renommage {} → {} (production)\n",
            new_name, name
        ));
        let rename = format!("docker rename {} {}", new_name, name);
        let renamed = match self.executor.exec(server, workdir, &rename, 10).await {
            Ok(_) => {
                logs.push_str("[blue-green] ✅ Basculement terminé (zero-downtime deploy)\n");
                true
            }
            Err(e) => {
                logs.push_str(&format!("[blue-green] ⚠️ Erreur renommage: {}\n", e));
                logs.push_str(&format!(
                    "[blue-green] Conteneur {} actif mais nom temporaire\n",
                    new_name
                ));
                false
            }
        };
        let success = true;
        if let Some(net) = extras.group_network.as_deref().filter(|s| !s.is_empty()) {
            let live = if renamed { name } else { new_name.as_str() };
            let cmd = docker::docker_network_attach(net, live, extras.group_alias.as_deref());
            match self.executor.exec(server, workdir, &cmd, 30).await {
                Ok(r) if r.ok => logs.push_str(&format!(
                    "[group] alias {} sur {}\n",
                    extras.group_alias.as_deref().unwrap_or("—"),
                    live
                )),
                Ok(r) => logs.push_str(&format!("[group] alias warn: {}\n", trim_out(&r.output))),
                Err(e) => logs.push_str(&format!("[group] alias warn: {e}\n")),
            }
        }

        // CRITICAL: Ensure Traefik is still running after app deploy (fix for recurring disappearance)
        // Traefik can be stopped/removed as a side effect of network operations or container recreation.
        // Always verify and restart Traefik at the end of each successful deploy.
        if success && has_traefik_labels {
            logs.push_str("[post-deploy] Vérification Traefik...\n");
            let traefik_check = "docker ps --filter name=^traefik$ --format '{{.Status}}' 2>/dev/null || echo 'missing'";
            match self.executor.exec(server, workdir, traefik_check, 10).await {
                Ok(r) if r.ok && r.output.trim().starts_with("Up") => {
                    logs.push_str("[post-deploy] ✅ Traefik actif\n");
                }
                Ok(r) if r.ok && r.output.trim() == "missing" => {
                    logs.push_str("[post-deploy] ⚠️ Traefik manquant — recréation en cours...\n");
                    // Note: ensure_traefik sera appelé par ProxyFacade après ce deploy via callbacks
                }
                Ok(r) => {
                    logs.push_str(&format!(
                        "[post-deploy] ⚠️ Traefik état: {} — vérification requise\n",
                        r.output.trim()
                    ));
                }
                Err(e) => {
                    logs.push_str(&format!(
                        "[post-deploy] ⚠️ Échec vérification Traefik: {}\n",
                        e
                    ));
                }
            }
        }

        success
    }

    async fn start_sidecars(
        &self,
        server: &str,
        workdir: &str,
        app_name: &str,
        network: &str,
        extras: &ContainerExtras,
        logs: &mut LogBuffer,
    ) -> bool {
        if extras.runtime.sidecars.is_empty() {
            return true;
        }
        for side in &extras.runtime.sidecars {
            let cname = format!("{app_name}-{}", side.name);
            logs.push_str(&format!("[sidecar] {cname} {}\n", side.image));
            let run = docker::docker_run_ex(
                &cname,
                &side.image,
                &[],
                None,
                Some(network),
                None,
                false,
                false,
                &[],
                &crate::runtime::RunTune::for_sidecar(side),
                None,
            );
            let cmd = format!(
                "docker network create {net} >/dev/null 2>&1 || true; docker rm -f {cname} >/dev/null 2>&1 || true; {run}",
                net = network,
                cname = cname,
                run = run,
            );
            match self.executor.exec(server, workdir, &cmd, 180).await {
                Ok(r) if r.ok => logs.push_str(&format!("[sidecar] {cname} démarré\n")),
                Ok(r) => {
                    logs.push_str(&format!(
                        "[sidecar] {cname} exit={} {}\n",
                        r.exit_code,
                        trim_out(&r.output)
                    ));
                    return false;
                }
                Err(e) => {
                    logs.push_str(&format!("[sidecar] {cname} error: {e}\n"));
                    return false;
                }
            }
        }
        true
    }

    async fn container_exists(&self, server: &str, workdir: &str, name: &str) -> bool {
        let cmd = format!(
            "docker ps -a --filter name=^{}$ --format '{{{{.ID}}}}'",
            name
        );
        self.executor
            .exec(server, workdir, &cmd, 10)
            .await
            .ok()
            .map(|r| r.ok && !r.output.trim().is_empty())
            .unwrap_or(false)
    }

    /// Attend que `container` réponde réellement en HTTP (code ≠ 404 et < 500), ou que
    /// son healthcheck Docker (configuré sur le projet) soit `healthy`.
    /// Sans réseau partagé avec le reverse proxy, retombe sur l’état `running`.
    /// Un 404 stable pendant 30 s est accepté (API sans page `/`), avec avertissement.
    async fn wait_container_ready(
        &self,
        server: &str,
        workdir: &str,
        container: &str,
        network: Option<&str>,
        port: u16,
        logs: &mut LogBuffer,
    ) -> bool {
        use docker::ReadyProbe;
        let Some(probe) = network.and_then(|n| docker::docker_http_probe(container, n, port, "/"))
        else {
            logs.push_str("[readiness] pas de réseau partagé avec le proxy — contrôle de l’état du conteneur uniquement\n");
            return self
                .container_is_healthy(server, workdir, container, logs)
                .await;
        };
        let timeout = std::env::var("DEVFORGE_DEPLOY_READY_TIMEOUT_SECS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|v| (5..=900).contains(v))
            .unwrap_or(90);
        let started = std::time::Instant::now();
        let deadline = started + std::time::Duration::from_secs(timeout);
        let mut first_404: Option<std::time::Instant> = None;
        let mut noprobe = 0u32;
        let mut last = String::new();
        loop {
            let out = match self.executor.exec(server, workdir, &probe, 20).await {
                Ok(r) => r.output,
                Err(e) => format!("error {e}"),
            };
            let verdict = docker::classify_ready_probe(&out);
            let summary = out
                .lines()
                .rev()
                .find(|l| l.contains("state="))
                .unwrap_or(out.trim())
                .to_string();
            if summary != last {
                logs.push_str(&format!(
                    "[readiness] {container} t+{}s {summary}\n",
                    started.elapsed().as_secs()
                ));
                last = summary;
            }
            match verdict {
                ReadyProbe::Ready => {
                    logs.push_str(&format!(
                        "[readiness] ✅ {container} répond en HTTP (t+{}s)\n",
                        started.elapsed().as_secs()
                    ));
                    return true;
                }
                ReadyProbe::Dead => {
                    logs.push_str(&format!(
                        "[readiness] ❌ {container} s’est arrêté pendant le démarrage\n"
                    ));
                    let tail = format!("docker logs --tail 20 {container} 2>&1");
                    if let Ok(r) = self.executor.exec(server, workdir, &tail, 15).await {
                        logs.push_str(&format!("[readiness] logs: {}\n", trim_out(&r.output)));
                    }
                    return false;
                }
                ReadyProbe::NoProbe => {
                    noprobe += 1;
                    if noprobe >= 3 {
                        logs.push_str("[readiness] sonde HTTP indisponible (proxy absent ou pas d’IP) — contrôle de l’état uniquement\n");
                        return self
                            .container_is_healthy(server, workdir, container, logs)
                            .await;
                    }
                }
                ReadyProbe::NotFound => {
                    let since = *first_404.get_or_insert_with(std::time::Instant::now);
                    if since.elapsed() >= std::time::Duration::from_secs(30) {
                        logs.push_str(&format!(
                            "[readiness] ⚠️ {container} répond 404 sur / depuis 30 s — app considérée prête (pas de page racine)\n"
                        ));
                        return true;
                    }
                }
                ReadyProbe::Wait => {
                    first_404 = None;
                }
            }
            if std::time::Instant::now() >= deadline {
                logs.push_str(&format!(
                    "[readiness] ❌ {container} ne répond pas en HTTP après {timeout}s (dernier état : {last}) — l’ancien conteneur reste en production (wait_container_ready timeout)\n"
                ));
                let tail = format!("docker logs --tail 40 {container} 2>&1");
                if let Ok(r) = self.executor.exec(server, workdir, &tail, 15).await {
                    logs.push_str(&format!("[readiness] logs: {}\n", trim_out(&r.output)));
                }
                return false;
            }
            tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
        }
    }

    async fn container_is_healthy(
        &self,
        server: &str,
        workdir: &str,
        name: &str,
        logs: &mut LogBuffer,
    ) -> bool {
        let status_cmd = format!("docker inspect {} --format '{{{{.State.Status}}}}'", name);
        let status = self.executor.exec(server, workdir, &status_cmd, 10).await;

        match status {
            Ok(r) if r.ok => {
                let state = r.output.trim();
                logs.push_str(&format!("[healthcheck] {} state={}\n", name, state));
                if state != "running" {
                    return false;
                }

                // Simple running check is enough for now
                // Future: add HTTP probe on container_port if available
                true
            }
            _ => false,
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

    /// Logs d’exécution du conteneur (lecture seule), `tail` lignes, options par défaut.
    pub async fn runtime_logs(&self, project: &ProjectTestContext, tail: u32) -> Value {
        let opts = runtime_logs::RuntimeLogsOptions {
            tail: tail.clamp(1, runtime_logs::MAX_TAIL),
            ..Default::default()
        };
        self.runtime_logs_with(project, &opts).await
    }

    /// Logs d’exécution du conteneur (lecture seule) : `tail`, `since`, `grep`, `level`,
    /// service annexe. Sortie masquée (secrets) et bornée (`truncated`).
    pub async fn runtime_logs_with(
        &self,
        project: &ProjectTestContext,
        opts: &runtime_logs::RuntimeLogsOptions,
    ) -> Value {
        let app = Self::container_name(&project.project_uuid);
        let name = opts.container(&app);
        let server_id = project.server_id.trim();
        let workdir = project.workdir.trim();
        if server_id.is_empty() || workdir.is_empty() {
            return json!({
                "ok": false,
                "container": name,
                "error": "server_id et workdir requis pour lire les logs",
                "logs": "",
            });
        }
        let cmd = runtime_logs::docker_logs_command(&name, opts);
        match self.executor.exec(server_id, workdir, &cmd, 90).await {
            Ok(r) => {
                let out = runtime_logs::finalize_logs(&r.output, opts);
                json!({
                    "ok": r.ok,
                    "container": name,
                    "logs": out.logs,
                    "lines": out.lines,
                    "bytes": out.bytes,
                    "truncated": out.truncated,
                    "query": runtime_logs::options_json(opts),
                })
            }
            Err(e) => json!({
                "ok": false,
                "container": name,
                "error": devforge_shared::log_redact::redact_log_text(&e.to_string()),
                "logs": "",
            }),
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
                    phase: if healthy {
                        "running".into()
                    } else {
                        "stopped".into()
                    },
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

fn unix_now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// `df-abc:latest` → tag `df-abc:r<secs>` si l'image existe (sinon rien).
pub fn rollback_tag_command(image: &str, secs: u64) -> String {
    let repo = image.split(':').next().unwrap_or(image);
    let target = format!("{repo}:r{secs}");
    format!(
        "docker image inspect {img} >/dev/null 2>&1 && docker tag {img} {t} && echo 'tag rollback {t}' || true",
        img = docker::shell_escape(image),
        t = docker::shell_escape(&target),
    )
}

#[cfg(test)]
mod tests {

    #[test]
    fn rollback_tag_targets_same_repo() {
        let cmd = rollback_tag_command("df-abc123def456:latest", 1_760_000_000);
        assert!(cmd.contains("docker tag df-abc123def456:latest df-abc123def456:r1760000000"));
        assert!(cmd.starts_with("docker image inspect df-abc123def456:latest"));
        assert!(!cmd.contains(" rm"));
    }

    use super::*;

    #[test]
    fn trim_out_keeps_short_output() {
        let short = "a".repeat(1000);
        let result = trim_out(&short);
        assert_eq!(result, short);
        assert_eq!(result.len(), 1000);
    }

    #[test]
    fn pin_sha_is_validated() {
        let sha = "6dcb09b5b57875f334f61aebed695e2e4193db5e";
        let s = pin_sha_suffix("/data/w", sha, FetchFrom::Origin).unwrap();
        assert!(s.contains("fetch origin 6dcb09b5b57875f334f61aebed695e2e4193db5e"));
        assert!(s.contains("reset --hard 6dcb09b5b57875f334f61aebed695e2e4193db5e"));
        let s =
            pin_sha_suffix("/data/w", sha, FetchFrom::Url("https://github.com/o/r.git")).unwrap();
        assert!(
            s.contains("fetch 'https://github.com/o/r.git' 6dcb09b5b"),
            "{s}"
        );
        assert!(!s.contains("fetch origin"), "{s}");
        assert!(pin_sha_suffix("/w", "main; rm -rf /", FetchFrom::Origin).is_none());
        assert!(pin_sha_suffix("/w", "abc", FetchFrom::Origin).is_none());
    }

    #[cfg(not(windows))]
    #[test]
    fn header_auth_never_puts_token_in_url_or_config() {
        let clean = git_clone_url("bobdivx/devforge", None);
        assert_eq!(clean, "https://github.com/bobdivx/devforge.git");
        let cmd = git_sync_command_header_auth("/data/w", &clean, "main", "ghs_ephemeral123");
        assert!(!cmd.contains("ghs_ephemeral123"));
        assert!(!cmd.contains("x-access-token:"));
        assert!(cmd.contains("GIT_CONFIG_KEY_0=http.https://github.com/.extraheader"));
        assert!(cmd.contains("remote set-url origin 'https://github.com/bobdivx/devforge.git'"));
        // Fetch sur l'URL explicite : ne dépend pas des identifiants stockés dans `origin`.
        assert!(
            cmd.contains("fetch 'https://github.com/bobdivx/devforge.git' '+refs/heads/main:refs/remotes/origin/main'"),
            "{cmd}"
        );
        assert!(!cmd.contains("fetch origin"), "{cmd}");
        assert!(git_clone_url("bobdivx/devforge", Some("ghp_x")).contains("x-access-token:ghp_x@"));
    }

    #[cfg(not(windows))]
    #[test]
    fn classic_pat_also_uses_header_auth_without_fetch_origin() {
        // Repli « jeton classique » (jeton d'installation indisponible) : même chemin
        // en-tête que la GitHub App — plus jamais `git fetch origin` sur un remote nettoyé.
        let clean = git_clone_url("https://github.com/bobdivx/popcorn-web", None);
        let cmd = git_sync_command_header_auth("/data/w", &clean, "main", "ghp_classic_pat_123");
        assert!(!cmd.contains("ghp_classic_pat_123"), "{cmd}");
        assert!(!cmd.contains("fetch origin"), "{cmd}");
        assert!(cmd.contains(&basic_auth_value("ghp_classic_pat_123")));
    }

    #[test]
    fn no_token_keeps_fetch_origin() {
        let clean = git_clone_url("bobdivx/public-repo", None);
        let cmd = git_sync_command("/data/w", &clean, "main", FetchFrom::Origin, None);
        assert!(cmd.contains("fetch origin"), "{cmd}");
        assert!(!cmd.contains("set-url"), "{cmd}");
    }

    #[cfg(not(windows))]
    #[test]
    fn token_url_variant_cleans_remote_and_fetches_explicit_url() {
        let auth = git_clone_url("bobdivx/devforge", Some("ghp_tok_abcdef"));
        let clean = git_clone_url("bobdivx/devforge", None);
        let cmd = git_sync_command(
            "/data/w",
            &auth,
            "main",
            FetchFrom::Url(&auth),
            Some(&clean),
        );
        assert!(!cmd.contains("fetch origin"), "{cmd}");
        assert!(
            cmd.contains("remote set-url origin 'https://github.com/bobdivx/devforge.git'"),
            "{cmd}"
        );
    }

    #[test]
    fn git_output_redaction_hides_token_and_basic_header() {
        let tok = "ghs_secretinstallation42";
        let raw = format!(
            "fatal: https://x-access-token:{tok}@github.com/o/r.git\nAUTHORIZATION: basic {}\nbare {tok}",
            basic_auth_value(tok)
        );
        let out = redact_git_output(&raw, Some(tok));
        assert!(!out.contains(tok), "{out}");
        assert!(!out.contains(&basic_auth_value(tok)), "{out}");
        // Sans jeton connu, les URL avec identifiants restent masquées.
        let out = redact_git_output("https://user:pw123456@github.com/o/r", None);
        assert!(!out.contains("pw123456"), "{out}");
    }

    #[test]
    fn git_auth_log_line_names_mode_and_reason_without_secret() {
        let l = git_auth_log_line(Some("ghs_x1234567"), true, Some("installation 171677569"));
        assert!(l.starts_with("[git] auth : GitHub App"), "{l}");
        assert!(l.contains("installation 171677569"), "{l}");
        let l = git_auth_log_line(
            Some("ghp_pat1234567"),
            false,
            Some("repli : jeton d'installation indisponible (HTTP 422) ghp_pat1234567"),
        );
        assert!(l.contains("jeton classique"), "{l}");
        assert!(l.contains("HTTP 422"), "{l}");
        assert!(!l.contains("ghp_pat1234567"), "{l}");
        let l = git_auth_log_line(None, false, None);
        assert!(l.contains("aucun jeton"), "{l}");
    }

    /// Bout en bout avec un vrai git : `origin` pointe sur une URL inaccessible (remote
    /// « nettoyé »), la synchro réussit quand même via l'URL explicite, et un remote
    /// propre est posé quand on le demande.
    #[cfg(unix)]
    #[test]
    fn sync_with_explicit_url_ignores_broken_origin() {
        use std::process::Command;
        if Command::new("git").arg("--version").output().is_err() {
            return;
        }
        let root = std::env::temp_dir().join(format!(
            "df-git-sync-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let sh = |cmd: &str| {
            let o = Command::new("sh").arg("-c").arg(cmd).output().unwrap();
            assert!(
                o.status.success(),
                "{cmd}\n{}{}",
                String::from_utf8_lossy(&o.stdout),
                String::from_utf8_lossy(&o.stderr)
            );
            String::from_utf8_lossy(&o.stdout).to_string()
        };
        let r = root.display();
        sh(&format!(
            "set -e; cd {r}; git init -q -b main src; cd src; \
             git -c user.email=t@t -c user.name=t commit -q --allow-empty -m one; \
             cd ..; git clone -q --bare src bare.git; git clone -q bare.git work; \
             git -C work remote set-url origin https://127.0.0.1:9/nope/repo.git; \
             cd src; git -c user.email=t@t -c user.name=t commit -q --allow-empty -m two; \
             git push -q ../bare.git main"
        ));
        let bare = format!("{r}/bare.git");
        let work = format!("{r}/work");
        let clean = "https://github.com/o/r.git";
        let cmd = git_sync_command(&work, &bare, "main", FetchFrom::Url(&bare), Some(clean));
        sh(&cmd);
        let head = sh(&format!("git -C {work} log -1 --format=%s"));
        assert_eq!(head.trim(), "two");
        let remote = sh(&format!("git -C {work} remote get-url origin"));
        assert_eq!(remote.trim(), clean);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn trim_out_preserves_head_and_tail() {
        let long = format!("{}MIDDLE{}", "A".repeat(2000), "Z".repeat(6000));
        let result = trim_out(&long);

        assert!(result.starts_with("AAAA"));
        assert!(result.ends_with("ZZZZ"));
        assert!(result.contains("…[truncated"));
        assert!(result.contains("chars]…"));

        let truncated_msg_count = result.matches("…[truncated").count();
        assert_eq!(truncated_msg_count, 1);
    }

    #[test]
    fn trim_out_shows_accurate_truncation_count() {
        let head = "A".repeat(2000);
        let middle = "M".repeat(5000);
        let tail = "Z".repeat(6000);
        let full = format!("{}{}{}", head, middle, tail);

        let result = trim_out(&full);

        assert!(result.contains("5000 chars"));
    }

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

/// Garde la fin des logs (les lignes récentes) sous `max` octets, sans couper un caractère.
pub fn truncate_runtime_logs(raw: &str, max: usize) -> String {
    if raw.len() <= max {
        return raw.to_string();
    }
    let mut start = raw.len() - max;
    while !raw.is_char_boundary(start) {
        start += 1;
    }
    let tail = &raw[start..];
    match tail.find('\n') {
        Some(i) => tail[i + 1..].to_string(),
        None => tail.to_string(),
    }
}

#[cfg(test)]
mod runtime_logs_tests {
    use super::*;

    #[test]
    fn keeps_recent_lines_only() {
        let raw = (0..100)
            .map(|i| format!("ligne {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let out = truncate_runtime_logs(&raw, 40);
        assert!(out.len() <= 40);
        assert!(out.ends_with("ligne 99"));
        assert!(out.starts_with("ligne "));
        assert_eq!(truncate_runtime_logs("court", 40), "court");
    }

    #[test]
    fn deploy_request_debug_redacts_github_token() {
        let req = DeployRequest {
            project_uuid: "p".into(),
            server_id: "s".into(),
            workdir: "/w".into(),
            git_repository: "https://github.com/o/r".into(),
            git_branch: "main".into(),
            build_pack: "static".into(),
            port: 80,
            base_directory: "/".into(),
            docker_compose_location: None,
            dockerfile_path: None,
            docker_build_context: None,
            publish_directory: None,
            is_static: true,
            github_token: Some("ghp_supersecret_token_value".into()),
            github_token_ephemeral: true,
            github_auth_note: Some("GitHub App".into()),
            pin_sha: None,
            env_file: Some("SECRET=1".into()),
            proxy_labels: None,
            gpu_nvidia: false,
            gpu_dri: false,
            group_network: None,
            group_alias: None,
            volumes: vec![],
            runtime: RuntimeSpec::default(),
        };
        let s = format!("{req:?}");
        assert!(s.contains("[redacted]"), "{s}");
        assert!(!s.contains("ghp_supersecret"), "{s}");
        assert!(!s.contains("SECRET=1"), "{s}");
    }

    #[test]
    fn runtime_logs_command_is_escaped_and_clamped() {
        let cmd = docker::docker_runtime_logs("devforge-abc", 50_000);
        assert!(cmd.contains("--tail 5000"));
        assert!(cmd.contains("devforge-abc"));
    }
}

#[cfg(test)]
mod log_buffer_tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn hook_receives_snapshots_on_each_append() {
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let seen2 = seen.clone();
        let hook: DeployLogHook = Arc::new(move |s: &str| {
            seen2.lock().unwrap().push(s.to_string());
        });
        let mut buf = LogBuffer::new(Some(hook));
        buf.push_str("a\n");
        buf.push_str("b\n");
        let snaps = seen.lock().unwrap().clone();
        assert_eq!(snaps, vec!["a\n".to_string(), "a\nb\n".to_string()]);
        assert_eq!(buf.into_string(), "a\nb\n");
    }
}

#[cfg(test)]
mod conflict_marker_tests {
    use super::*;

    #[test]
    fn detects_markers_and_lists_files_once() {
        let out = "scripts/turso-store.mjs:1186:<<<<<<< HEAD\nscripts/turso-store.mjs:1263:>>>>>>> 692f355 (feat)\nsrc/a.ts:3:<<<<<<< ours\n";
        let m = conflict_marker_message(0, out).unwrap();
        assert!(m.contains("scripts/turso-store.mjs:1186"));
        assert!(m.contains("src/a.ts:3"));
        assert!(!m.contains(":1263"));
        assert!(m.contains("build non lancé"));
    }

    #[test]
    fn clean_repo_passes() {
        assert!(conflict_marker_message(1, "").is_none());
        assert!(conflict_marker_message(0, "").is_none());
        // `head` peut renvoyer 0 même sans résultat : seul un vrai marqueur compte.
        assert!(conflict_marker_message(0, "fatal: not a git repository").is_none());
    }
}

#[cfg(test)]
mod docker_build_timeout_tests {
    use super::*;

    #[test]
    fn default_is_one_hour() {
        assert_eq!(parse_docker_build_timeout(None), 3600);
        assert_eq!(parse_docker_build_timeout(Some("abc")), 3600);
    }

    #[test]
    fn override_within_range() {
        assert_eq!(parse_docker_build_timeout(Some("5400")), 5400);
        assert_eq!(parse_docker_build_timeout(Some(" 300 ")), 300);
    }

    #[test]
    fn out_of_range_falls_back() {
        assert_eq!(parse_docker_build_timeout(Some("10")), 3600);
        assert_eq!(parse_docker_build_timeout(Some("999999")), 3600);
    }
}
