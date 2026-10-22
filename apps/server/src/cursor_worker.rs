//! Worker Cursor Self-Hosted (My Machines) géré par DevForge.
//!
//! Lance `agent worker … start` avec un `--worker-dir` par checkout projet,
//! pour que Cursor / Grok Bot exécutent les tool calls sur la machine
//! qui contient déjà tous les repos.
//!
//! Installation « un bouton » : DevForge installe lui-même le CLI Cursor dans
//! son dossier de données (`<data>/cursor-worker/home`, persistant), sur le
//! leader (processus enfant) ou sur un nœud worker (scripts via l'executor du
//! cluster). Seule la clé API personnelle Cursor reste à fournir.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const STATE_DIR_NAME: &str = "cursor-worker";

/// Adresse locale des sondes `/healthz` / `/readyz` du worker.
pub const MANAGEMENT_ADDR: &str = "127.0.0.1:47917";

/// Le CLI accepte au plus 20 `--worker-dir`.
pub const MAX_WORKER_DIRS: usize = 20;

/// Script officiel d'installation du CLI Cursor.
pub const INSTALL_URL: &str = "https://cursor.com/install";

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
    /// Nœud cible (`''` ou `default` = leader).
    pub node_id: String,
}

impl Default for WorkerSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            name: String::new(),
            api_key_sealed: String::new(),
            binary: String::new(),
            extra_dirs: String::new(),
            node_id: String::new(),
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

/// Un sous-dossier par dépôt servi en plus du premier (pid, logs, data-dir).
fn repos_dir() -> PathBuf {
    state_dir().join("repos")
}

/// Identifiant stable d'un dépôt : `<nom>-<hash court du chemin>`.
pub fn repo_slot_id(path: &str) -> String {
    let base = Path::new(path.trim_end_matches('/'))
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("repo");
    let mut slug = slug_name(base);
    slug.truncate(40);
    if slug.is_empty() {
        slug = "repo".into();
    }
    // FNV-1a 32 bits : stable entre versions (contrairement à DefaultHasher).
    let mut h: u32 = 0x811c_9dc5;
    for b in path.as_bytes() {
        h ^= u32::from(*b);
        h = h.wrapping_mul(0x0100_0193);
    }
    format!("{slug}-{h:08x}")
}

fn repo_slot_dir(path: &str) -> PathBuf {
    repos_dir().join(repo_slot_id(path))
}

/// HOME dédié au CLI installé par DevForge (persistant dans le volume data).
pub fn managed_home() -> PathBuf {
    state_dir().join("home")
}

/// Binaire `agent` installé par DevForge.
///
/// `cursor-agent` d'abord : `agent` peut être écrasé par un autre CLI du
/// même nom (collision connue), `cursor-agent` pointe toujours vers Cursor.
pub fn managed_binary() -> PathBuf {
    let bin = managed_home().join(".local").join("bin");
    let preferred = bin.join("cursor-agent");
    if preferred.is_file() {
        return preferred;
    }
    bin.join("agent")
}

/// Dossier vide servi quand aucun checkout Git n'existe encore.
pub fn fallback_workspace() -> PathBuf {
    state_dir().join("workspace")
}

fn ensure_state_dir() -> Result<(), String> {
    std::fs::create_dir_all(state_dir()).map_err(|e| e.to_string())
}

pub async fn load_settings(pool: &PgPool) -> WorkerSettings {
    let row: Option<(i64, String, String, String, String, String)> = sqlx::query_as(
        r#"SELECT COALESCE(cursor_worker_enabled, 0),
                  COALESCE(cursor_worker_name, ''),
                  COALESCE(cursor_worker_api_key, ''),
                  COALESCE(cursor_worker_binary, ''),
                  COALESCE(cursor_worker_extra_dirs, ''),
                  COALESCE(cursor_worker_node, '')
           FROM instance_settings WHERE id = 1"#,
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    match row {
        Some((en, name, key, bin, extra, node)) => WorkerSettings {
            enabled: en != 0,
            name,
            api_key_sealed: key,
            binary: bin,
            extra_dirs: extra,
            node_id: node,
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

/// Nom annoncé : réglage explicite, sinon nom du nœud (slug), sinon hostname.
pub fn resolve_worker_name_for_node(settings: &WorkerSettings, node_name: &str) -> String {
    let n = settings.name.trim();
    if !n.is_empty() {
        return n.to_string();
    }
    let slug = slug_name(node_name);
    if !slug.is_empty() {
        return slug;
    }
    hostname_fallback()
}

/// `ZimaCube (NAS)` → `zimacube-nas`.
pub fn slug_name(raw: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in raw.trim().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else if !out.is_empty() && !dash {
            out.push('-');
            dash = true;
        }
    }
    out.trim_end_matches('-').chars().take(48).collect()
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

/// Clé effective : réglage DevForge, sinon `CURSOR_API_KEY` du serveur.
/// Retourne (clé, source) — source ∈ `settings` | `env`.
pub fn effective_api_key(settings: &WorkerSettings) -> Option<(String, &'static str)> {
    let stored = api_key_plain(settings);
    if !stored.trim().is_empty() {
        return Some((stored.trim().to_string(), "settings"));
    }
    std::env::var("CURSOR_API_KEY")
        .ok()
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
        .map(|k| (k, "env"))
}

/// Préfixes de clés d'autres fournisseurs (collées par erreur à la place
/// d'une clé Cursor).
const FOREIGN_KEY_PREFIXES: &[(&str, &str)] = &[
    ("xai-", "xAI"),
    ("sk-ant-", "Anthropic"),
    ("sk-or-", "OpenRouter"),
    ("sk-", "OpenAI"),
    ("gsk_", "Groq"),
    ("AIza", "Google"),
    ("ghp_", "GitHub"),
    ("gho_", "GitHub"),
    ("github_pat_", "GitHub"),
    ("hf_", "Hugging Face"),
];

/// Fournisseur reconnu si la clé n'est manifestement pas une clé Cursor.
pub fn foreign_key_provider(raw: &str) -> Option<&'static str> {
    let k = raw.trim();
    FOREIGN_KEY_PREFIXES
        .iter()
        .find(|(p, _)| k.starts_with(p))
        .map(|(_, name)| *name)
}

/// Forme minimale d'une clé utilisateur Cursor (anti faute de frappe).
pub fn validate_api_key(raw: &str) -> Result<String, String> {
    let k = raw.trim();
    if k.is_empty() {
        return Err("Clé API Cursor vide.".into());
    }
    if let Some(provider) = foreign_key_provider(k) {
        return Err(format!(
            "Ceci est une clé {provider}, pas une clé Cursor. Crée une clé sur cursor.com/dashboard → API Keys."
        ));
    }
    if k.len() < 16 || k.chars().any(char::is_whitespace) {
        return Err(
            "Clé API Cursor invalide (copie-la depuis cursor.com/dashboard → API Keys).".into(),
        );
    }
    Ok(k.to_string())
}

/// Le CLI a refusé la clé (logs du worker).
pub fn logs_show_invalid_key(logs: &str) -> bool {
    let l = logs.to_lowercase();
    l.contains("api key is invalid")
        || l.contains("invalid api key")
        || l.contains("api key was loaded from")
        || l.contains("unauthenticated")
}

/// Une variable `CURSOR_API_KEY` non vide existe côté serveur (jamais la valeur).
pub fn env_key_present() -> bool {
    std::env::var("CURSOR_API_KEY")
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

/// Efface les logs d'un worker arrêté (après changement de clé, pour ne
/// plus afficher l'erreur de l'ancienne clé).
pub fn clear_logs_if_stopped() {
    if is_running() {
        return;
    }
    let _ = std::fs::remove_file(out_path());
    let _ = std::fs::remove_file(err_path());
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

/// Résout le binaire `agent` (chemin custom, PATH, puis installation DevForge).
pub fn resolve_agent_binary(settings: &WorkerSettings) -> Option<PathBuf> {
    let custom = settings.binary.trim();
    if !custom.is_empty() {
        let p = PathBuf::from(custom);
        if p.is_file() {
            return Some(p);
        }
        return None;
    }
    which_agent().or_else(|| {
        let p = managed_binary();
        p.is_file().then_some(p)
    })
}

/// Installe le CLI Cursor localement (leader) dans [`managed_home`].
pub async fn install_cli_local() -> Result<String, String> {
    ensure_state_dir()?;
    std::fs::create_dir_all(managed_home()).map_err(|e| e.to_string())?;
    let script = install_script(&ScriptBase::Literal(state_dir().display().to_string()));
    let mut cmd = tokio::process::Command::new("sh");
    cmd.arg("-c")
        .arg(&script)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let out = tokio::time::timeout(std::time::Duration::from_secs(300), cmd.output())
        .await
        .map_err(|_| "Installation du CLI Cursor : délai dépassé (5 min).".to_string())?
        .map_err(|e| format!("Installation du CLI Cursor : {e}"))?;
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    if !out.status.success() {
        return Err(format!(
            "Installation du CLI Cursor échouée.\n{}",
            tail_lines(&text, 20)
        ));
    }
    Ok(text)
}

fn which_agent() -> Option<PathBuf> {
    #[cfg(windows)]
    let cmd = Command::new("where").arg("agent").output();
    #[cfg(not(windows))]
    let cmd = Command::new("sh").args(["-c", "command -v agent"]).output();
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
        let git_remote = if has_git { read_git_remote(p) } else { None };
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
        .args([
            "-C",
            &workdir.to_string_lossy(),
            "remote",
            "get-url",
            "origin",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    // Un remote `https://x-access-token:…@github.com/…` ne sort jamais en clair.
    (!s.is_empty()).then(|| devforge_shared::redact::redact_remote(&s))
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
///
/// La clé API n'est jamais passée en argument (visible dans `ps`) : elle est
/// fournie via `CURSOR_API_KEY` dans l'environnement du process.
pub fn build_worker_args(name: &str, workdirs: &[String]) -> Result<Vec<String>, String> {
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
    for dir in workdirs.iter().take(MAX_WORKER_DIRS) {
        args.push("--worker-dir".into());
        args.push(dir.clone());
    }
    args.push("--management-addr".into());
    args.push(MANAGEMENT_ADDR.into());
    args.push("start".into());
    Ok(args)
}

/// Arguments d'un worker dédié à UN dépôt.
///
/// Le CLI utilise le premier `--worker-dir` comme espace de travail de toute
/// session : un worker multi-dossiers exécute donc chaque agent dans le premier
/// dépôt, quel que soit le dépôt demandé. Un process par dépôt (même nom de
/// machine) laisse Cursor router chaque demande vers le bon checkout. Chaque
/// process a son propre `--data-dir` (verrou du CLI) et pas de sonde HTTP
/// (le port est réservé au worker principal).
pub fn build_repo_worker_args(name: &str, dir: &str, data_dir: &str) -> Vec<String> {
    let mut args = vec!["worker".to_string()];
    let name = name.trim();
    if !name.is_empty() {
        args.push("--name".into());
        args.push(name.to_string());
    }
    args.push("--worker-dir".into());
    args.push(dir.to_string());
    args.push("--data-dir".into());
    args.push(data_dir.to_string());
    args.push("start".into());
    args
}

/// Nom du dépôt servi (dernier segment du remote `origin`, sinon du dossier).
pub fn repo_label(remote: Option<&str>, path: &str) -> String {
    let from_remote = remote
        .map(|r| r.trim().trim_end_matches('/').trim_end_matches(".git"))
        .and_then(|r| r.rsplit(['/', ':']).next())
        .map(slug_name)
        .filter(|s| !s.is_empty());
    from_remote
        .or_else(|| {
            Path::new(path.trim_end_matches('/'))
                .file_name()
                .and_then(|s| s.to_str())
                .map(slug_name)
                .filter(|s| !s.is_empty())
        })
        .unwrap_or_else(|| "repo".into())
}

/// Un nom de machine Cursor par dépôt : `<nom>-<dépôt>`.
///
/// Le CLI mémorise l'identifiant du worker par nom affiché
/// (`workerIdsByDisplayName` dans son HOME) : des process qui partagent un
/// nom partagent donc le même workerId, et Cursor confie la session à
/// n'importe lequel d'entre eux. Un nom distinct par dépôt donne un workerId
/// distinct et une cible explicite (`worker=devforge-template-studio`).
pub fn repo_worker_names_from(base: &str, labels: &[String]) -> Vec<String> {
    let base = slug_name(base);
    let mut seen: Vec<String> = Vec::with_capacity(labels.len());
    for label in labels {
        let raw = if base.is_empty() {
            label.clone()
        } else {
            format!("{base}-{label}")
        };
        let mut name = slug_name(&raw);
        if name.is_empty() {
            name = "repo".into();
        }
        let mut candidate = name.clone();
        let mut n = 2;
        while seen.contains(&candidate) {
            candidate = format!("{name}-{n}");
            n += 1;
        }
        seen.push(candidate);
    }
    seen
}

/// Noms de machine des dépôts servis (lit le remote `origin` de chaque dossier).
pub fn repo_worker_names(base: &str, workdirs: &[String]) -> Vec<String> {
    let labels: Vec<String> = workdirs
        .iter()
        .map(|d| repo_label(read_git_remote(Path::new(d)).as_deref(), d))
        .collect();
    repo_worker_names_from(base, &labels)
}

/// Workdirs effectifs : repos éligibles, sinon un espace vide géré par DevForge
/// (le worker démarre quand même et les repos s'ajoutent au prochain relancement).
pub fn workdirs_or_fallback(paths: &[String]) -> Vec<String> {
    if !paths.is_empty() {
        return paths.iter().take(MAX_WORKER_DIRS).cloned().collect();
    }
    let ws = fallback_workspace();
    let _ = std::fs::create_dir_all(&ws);
    vec![ws.display().to_string()]
}

// ───────────────────────── Scripts nœud (executor) ─────────────────────────

/// Racine d'état du worker dans un script shell.
#[derive(Debug, Clone)]
pub enum ScriptBase {
    /// Chemin connu côté leader (quoté).
    Literal(String),
    /// Nœud distant : `${DEVFORGE_DATA_DIR:-/data}/cursor-worker` évalué sur place.
    NodeDataDir,
}

/// Quote POSIX (`'…'`).
pub fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

fn script_prelude(base: &ScriptBase) -> String {
    let d = match base {
        ScriptBase::Literal(p) => format!("D={}", shell_quote(p)),
        ScriptBase::NodeDataDir => {
            format!("D=\"${{DEVFORGE_DATA_DIR:-/data}}/{STATE_DIR_NAME}\"")
        }
    };
    format!(
        "{d}\nmkdir -p \"$D/home\" || exit 2\nexport HOME=\"$D/home\"\nexport PATH=\"$HOME/.local/bin:$PATH\"\nPIDF=\"$D/worker.pid\"\n"
    )
}

/// Installe le CLI si absent, puis affiche `DF_AGENT=` / `DF_VERSION=`.
pub fn install_script(base: &ScriptBase) -> String {
    format!(
        r#"{prelude}if ! command -v agent >/dev/null 2>&1; then
  command -v curl >/dev/null 2>&1 || {{ echo "curl absent sur ce nœud"; exit 3; }}
  curl -fsSL {url} | bash >"$D/install.log" 2>&1 || {{ tail -n 20 "$D/install.log"; exit 4; }}
fi
command -v agent >/dev/null 2>&1 || {{ echo "CLI agent introuvable après installation"; tail -n 20 "$D/install.log" 2>/dev/null; exit 5; }}
echo "DF_AGENT=$(command -v agent)"
echo "DF_VERSION=$(agent --version 2>/dev/null | head -n 1)"
"#,
        prelude = script_prelude(base),
        url = INSTALL_URL,
    )
}

/// Arrête le worker du nœud (pid file).
pub fn stop_script(base: &ScriptBase) -> String {
    format!(
        r#"{prelude}if [ -f "$PIDF" ]; then
  P=$(cat "$PIDF" 2>/dev/null)
  if [ -n "$P" ] && kill -0 "$P" 2>/dev/null; then
    kill -TERM "$P" 2>/dev/null; sleep 1
    kill -0 "$P" 2>/dev/null && kill -KILL "$P" 2>/dev/null
    echo "DF_STOPPED=$P"
  fi
  rm -f "$PIDF"
fi
for f in "$D"/repos/*/worker.pid; do
  [ -f "$f" ] || continue
  P=$(cat "$f" 2>/dev/null)
  if [ -n "$P" ] && kill -0 "$P" 2>/dev/null; then
    kill -TERM "$P" 2>/dev/null; sleep 1
    kill -0 "$P" 2>/dev/null && kill -KILL "$P" 2>/dev/null
  fi
  rm -f "$f"
done
echo "DF_RUNNING=0"
"#,
        prelude = script_prelude(base)
    )
}

/// Démarre le worker en arrière-plan sur le nœud et vérifie qu'il tient.
///
/// `candidates` : chemins projets ; seuls ceux avec `.git` sont servis
/// (sinon un espace vide). La clé est passée via l'environnement, jamais
/// écrite sur disque ni affichée.
pub fn start_script(base: &ScriptBase, name: &str, candidates: &[String], api_key: &str) -> String {
    let dirs: Vec<String> = candidates.iter().map(|c| shell_quote(c)).collect();
    format!(
        r#"{stop}set --
N=0
for d in {dirs}; do
  [ -n "$d" ] && [ -d "$d/.git" ] || continue
  [ "$N" -ge {max} ] && break
  set -- "$@" "$d"
  N=$((N+1))
  echo "DF_DIR=$d"
done
if [ "$N" -eq 0 ]; then
  mkdir -p "$D/workspace"
  set -- "$D/workspace"
fi
command -v agent >/dev/null 2>&1 || {{ echo "CLI agent absent"; exit 5; }}
SETSID=""
command -v setsid >/dev/null 2>&1 && SETSID="setsid"
K={key}
# Un nom de machine par dépôt (<nom>-<dépôt>) : le CLI associe le workerId au nom.
SEEN=" "
dfname() {{
  r=$(git -C "$1" remote get-url origin 2>/dev/null)
  r=${{r%/}}; r=${{r%.git}}; r=${{r##*/}}; r=${{r##*:}}
  [ -n "$r" ] || r=$(basename "$1")
  n=$(printf '%s-%s' {name} "$r" | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '-' | sed 's/^-*//; s/-*$//' | cut -c1-48)
  [ -n "$n" ] || n=repo
  c="$n"; i=2
  while case "$SEEN" in *" $c "*) true;; *) false;; esac; do c="$n-$i"; i=$((i+1)); done
  SEEN="$SEEN$c "
  DFN="$c"
}}
FIRST="$1"; shift
# Un process par dépôt : le CLI exécute chaque session dans son premier --worker-dir.
dfname "$FIRST" 2>/dev/null; echo "DF_NAME=$DFN"
CURSOR_API_KEY="$K" $SETSID nohup agent worker --name "$DFN" --worker-dir "$FIRST" --management-addr {mgmt} start </dev/null >"$D/worker.out" 2>"$D/worker.err" &
echo $! >"$PIDF"
I=1
for d in "$@"; do
  S="$D/repos/$I"
  mkdir -p "$S/data"
  dfname "$d" 2>/dev/null; echo "DF_NAME=$DFN"
  CURSOR_API_KEY="$K" $SETSID nohup agent worker --name "$DFN" --worker-dir "$d" --data-dir "$S/data" start </dev/null >"$S/worker.out" 2>"$S/worker.err" &
  echo $! >"$S/worker.pid"
  I=$((I+1))
done
sleep 4
P=$(cat "$PIDF")
if kill -0 "$P" 2>/dev/null; then
  echo "DF_RUNNING=1"
  echo "DF_PID=$P"
  UP=1
  for f in "$D"/repos/*/worker.pid; do
    [ -f "$f" ] && kill -0 "$(cat "$f" 2>/dev/null)" 2>/dev/null && UP=$((UP+1))
  done
  echo "DF_REPOS_UP=$UP"
else
  rm -f "$PIDF"
  for f in "$D"/repos/*/worker.pid; do
    [ -f "$f" ] && kill -TERM "$(cat "$f" 2>/dev/null)" 2>/dev/null
    rm -f "$f"
  done
  echo "DF_RUNNING=0"
  echo "DF_LOGS_BEGIN"
  tail -n 30 "$D/worker.err" 2>/dev/null
  tail -n 10 "$D/worker.out" 2>/dev/null
  exit 6
fi
"#,
        stop = stop_script(base).replace("echo \"DF_RUNNING=0\"\n", ""),
        dirs = if dirs.is_empty() {
            "''".to_string()
        } else {
            dirs.join(" ")
        },
        max = MAX_WORKER_DIRS,
        key = shell_quote(api_key),
        name = shell_quote(name),
        mgmt = MANAGEMENT_ADDR,
    )
}

/// État du worker sur le nœud (process, CLI, sonde `/readyz`, logs).
pub fn status_script(base: &ScriptBase) -> String {
    format!(
        r#"{prelude}if command -v agent >/dev/null 2>&1; then
  echo "DF_AGENT=$(command -v agent)"
  echo "DF_VERSION=$(agent --version 2>/dev/null | head -n 1)"
fi
P=$(cat "$PIDF" 2>/dev/null)
if [ -n "$P" ] && kill -0 "$P" 2>/dev/null; then
  echo "DF_RUNNING=1"
  echo "DF_PID=$P"
  if command -v curl >/dev/null 2>&1 && curl -fsS -m 3 http://{mgmt}/readyz >/dev/null 2>&1; then
    echo "DF_READY=1"
  else
    echo "DF_READY=0"
  fi
  UP=1
  for f in "$D"/repos/*/worker.pid; do
    [ -f "$f" ] && kill -0 "$(cat "$f" 2>/dev/null)" 2>/dev/null && UP=$((UP+1))
  done
  echo "DF_REPOS_UP=$UP"
else
  echo "DF_RUNNING=0"
fi
echo "DF_LOGS_BEGIN"
tail -n 20 "$D/worker.err" 2>/dev/null
tail -n 10 "$D/worker.out" 2>/dev/null
"#,
        prelude = script_prelude(base),
        mgmt = MANAGEMENT_ADDR,
    )
}

/// Sortie `DF_KEY=value` des scripts → (clés, dossiers servis, logs).
#[derive(Debug, Default, Clone, PartialEq)]
pub struct ScriptReport {
    pub agent: Option<String>,
    pub version: Option<String>,
    pub running: bool,
    pub pid: Option<u32>,
    pub ready: Option<bool>,
    pub dirs: Vec<String>,
    /// Process actifs (un par dépôt) après démarrage.
    pub repos_up: Option<u32>,
    /// Noms de machine Cursor (un par dépôt) annoncés au démarrage.
    pub names: Vec<String>,
    pub logs: String,
}

pub fn parse_script_output(out: &str) -> ScriptReport {
    let mut r = ScriptReport::default();
    let mut logs = Vec::new();
    let mut in_logs = false;
    for line in out.lines() {
        if in_logs {
            logs.push(line);
            continue;
        }
        if line.trim() == "DF_LOGS_BEGIN" {
            in_logs = true;
            continue;
        }
        let Some((k, v)) = line.split_once('=') else {
            logs.push(line);
            continue;
        };
        let v = v.trim();
        match k.trim() {
            "DF_AGENT" if !v.is_empty() => r.agent = Some(v.to_string()),
            "DF_VERSION" if !v.is_empty() => r.version = Some(v.to_string()),
            "DF_RUNNING" => r.running = v == "1",
            "DF_PID" => r.pid = v.parse().ok(),
            "DF_READY" => r.ready = Some(v == "1"),
            "DF_DIR" => r.dirs.push(v.to_string()),
            "DF_REPOS_UP" => r.repos_up = v.parse().ok(),
            "DF_NAME" if !v.is_empty() => r.names.push(v.to_string()),
            "DF_STOPPED" | "DF_AGENT" | "DF_VERSION" => {}
            _ => logs.push(line),
        }
    }
    r.logs = devforge_shared::redact::redact_urls_in_text(logs.join("\n").trim());
    r
}

pub fn tail_lines(s: &str, n: usize) -> String {
    let lines: Vec<&str> = s.lines().collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

/// Sonde `/readyz` du worker local (leader).
pub async fn probe_ready_local() -> bool {
    let url = format!("http://{MANAGEMENT_ADDR}/readyz");
    let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
    else {
        return false;
    };
    client
        .get(url)
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
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

/// Pid d'un fichier pid, s'il pointe vers un process vivant.
fn live_pid_at(path: &Path) -> Option<u32> {
    let raw = std::fs::read_to_string(path).ok()?;
    let pid: u32 = raw.trim().parse().ok()?;
    (pid > 0 && pid_is_alive(pid)).then_some(pid)
}

/// Arrête les workers dédiés aux dépôts secondaires (dossiers `repos/*`).
/// Renvoie les pids arrêtés.
fn stop_repo_workers() -> Vec<u32> {
    let mut stopped = Vec::new();
    let Ok(entries) = std::fs::read_dir(repos_dir()) else {
        return stopped;
    };
    for e in entries.flatten() {
        let pidf = e.path().join("worker.pid");
        if let Some(pid) = live_pid_at(&pidf) {
            if kill_pid(pid).is_ok() {
                stopped.push(pid);
            }
        }
        let _ = std::fs::remove_file(&pidf);
    }
    stopped
}

/// État par dépôt servi : le premier est le worker principal, les autres ont
/// chacun leur process.
pub fn repo_workers_state(base_name: &str, registered: &[String]) -> Vec<Value> {
    let names = repo_worker_names(base_name, registered);
    registered
        .iter()
        .enumerate()
        .map(|(i, path)| {
            let pid = if i == 0 {
                read_pid().filter(|p| pid_is_alive(*p))
            } else {
                live_pid_at(&repo_slot_dir(path).join("worker.pid"))
            };
            json!({
                "path": path,
                "name": names.get(i),
                "primary": i == 0,
                "running": pid.is_some(),
                "pid": pid,
            })
        })
        .collect()
}

pub fn stop() -> Result<Value, String> {
    let extra = stop_repo_workers();
    let Some(pid) = read_pid() else {
        let _ = std::fs::remove_file(pid_path());
        return Ok(json!({
            "ok": true,
            "running": false,
            "stopped_repo_workers": extra.len(),
            "message": "Aucun worker en cours",
        }));
    };
    if !pid_is_alive(pid) {
        let _ = std::fs::remove_file(pid_path());
        return Ok(json!({
            "ok": true,
            "running": false,
            "stopped_repo_workers": extra.len(),
            "message": "Process déjà arrêté",
        }));
    }
    kill_pid(pid)?;
    let _ = std::fs::remove_file(pid_path());
    Ok(json!({
        "ok": true,
        "running": false,
        "stopped_pid": pid,
        "stopped_repo_workers": extra.len(),
        "message": format!("Worker arrêté (pid {pid})"),
    }))
}

fn tail_file(path: &Path, max_lines: usize) -> Option<String> {
    let raw = std::fs::read_to_string(path).ok()?;
    let lines: Vec<&str> = raw.lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    (start < lines.len()).then(|| lines[start..].join("\n"))
}

pub fn read_logs_tail(max_lines: usize) -> String {
    let mut chunks = Vec::new();
    for path in [out_path(), err_path()] {
        if let Some(tail) = tail_file(&path, max_lines) {
            chunks.push(format!(
                "—— {} ——\n{tail}",
                path.file_name().and_then(|s| s.to_str()).unwrap_or("log"),
            ));
        }
    }
    // Dépôts secondaires arrêtés : dernière erreur, pour comprendre pourquoi.
    let registered = load_registered();
    for path in registered.iter().skip(1) {
        let dir = repo_slot_dir(path);
        if live_pid_at(&dir.join("worker.pid")).is_some() {
            continue;
        }
        if let Some(tail) = tail_file(&dir.join("worker.err"), 3) {
            chunks.push(format!("—— {path} (arrêté) ——\n{tail}"));
        }
    }
    devforge_shared::redact::redact_urls_in_text(&chunks.join("\n\n"))
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

/// Lance un process worker détaché (stdout/stderr vers fichiers) et le
/// récolte dans un thread pour éviter les zombies.
fn spawn_worker_process(
    bin: &Path,
    args: &[String],
    out: &Path,
    err: &Path,
    api_key: Option<&str>,
) -> Result<u32, String> {
    let out = std::fs::File::create(out).map_err(|e| e.to_string())?;
    let err = std::fs::File::create(err).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(bin);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::from(out))
        .stderr(Stdio::from(err));
    match api_key {
        Some(k) => {
            cmd.env("CURSOR_API_KEY", k);
        }
        None => {
            // Session de connexion : jamais une clé héritée de l'environnement.
            cmd.env_remove("CURSOR_API_KEY");
            cmd.env("HOME", managed_home());
        }
    }
    if bin.starts_with(managed_home()) {
        // Config / sessions du CLI dans le volume persistant.
        cmd.env("HOME", managed_home());
    }

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
    let _ = std::thread::Builder::new()
        .name("cursor-worker-reap".into())
        .spawn(move || {
            let mut child = child;
            let _ = child.wait();
        });
    Ok(pid)
}

/// Démarre avec un nom déjà résolu (nom du nœud par défaut).
///
/// Un process par dépôt : le premier dépôt garde le worker « principal »
/// (pid, logs, sonde `/readyz`), chaque dépôt suivant a le sien sous
/// `repos/<id>/`. Tous portent le même nom de machine : Cursor choisit le
/// process dont le dépôt correspond à la demande.
pub fn start_named(
    settings: &WorkerSettings,
    bin: &Path,
    name: &str,
    workdirs: &[String],
) -> Result<Value, String> {
    if is_running() {
        return Err("Worker déjà en cours — arrête-le avant de relancer.".into());
    }
    // Restes d'un démarrage précédent (worker principal mort, secondaires vivants).
    stop_repo_workers();
    // Clé API si enregistrée, sinon session `cursor-agent login` (HOME géré).
    let api_key = effective_api_key(settings).map(|(k, _)| k);
    if api_key.is_none() && !is_logged_in(bin) {
        return Err(
            "Ni clé API Cursor ni connexion Cursor : utilise « Se connecter avec Cursor » ou colle une clé."
                .into(),
        );
    }
    ensure_state_dir()?;
    let workdirs = workdirs_or_fallback(workdirs);
    let names = repo_worker_names(name, &workdirs);
    let args = build_worker_args(&names[0], &workdirs[..1])?;
    let pid = spawn_worker_process(bin, &args, &out_path(), &err_path(), api_key.as_deref())?;
    std::fs::write(pid_path(), pid.to_string()).map_err(|e| e.to_string())?;
    save_registered(&workdirs)?;

    let mut extra: Vec<(String, u32)> = Vec::new();
    let mut extra_errors: Vec<String> = Vec::new();
    for (dir, repo_name) in workdirs.iter().zip(names.iter()).skip(1) {
        let slot = repo_slot_dir(dir);
        let data = slot.join("data");
        if let Err(e) = std::fs::create_dir_all(&data) {
            extra_errors.push(format!("{dir} : {e}"));
            continue;
        }
        let args = build_repo_worker_args(repo_name, dir, &data.display().to_string());
        match spawn_worker_process(
            bin,
            &args,
            &slot.join("worker.out"),
            &slot.join("worker.err"),
            api_key.as_deref(),
        ) {
            Ok(p) => {
                let _ = std::fs::write(slot.join("worker.pid"), p.to_string());
                extra.push((dir.clone(), p));
            }
            Err(e) => extra_errors.push(format!("{dir} : {e}")),
        }
    }

    // Laisse les process s’initialiser un court instant.
    std::thread::sleep(std::time::Duration::from_millis(600));
    if !pid_is_alive(pid) {
        let logs = read_logs_tail(40);
        let _ = std::fs::remove_file(pid_path());
        stop_repo_workers();
        return Err(format!(
            "Le worker s’est arrêté immédiatement. Vérifie la clé API et le réseau sortant (api2.cursor.sh).\n{logs}"
        ));
    }
    for (dir, p) in &extra {
        if !pid_is_alive(*p) {
            let tail = tail_file(&repo_slot_dir(dir).join("worker.err"), 2).unwrap_or_default();
            extra_errors.push(devforge_shared::redact::redact_urls_in_text(&format!(
                "{dir} : arrêté au démarrage {tail}"
            )));
        }
    }
    let serving = workdirs.len() - extra_errors.len();

    Ok(json!({
        "ok": true,
        "running": true,
        "pid": pid,
        "name": name,
        "binary": bin.display().to_string(),
        "workdirs": workdirs,
        "workdirs_count": workdirs.len(),
        "machine_names": names,
        "processes": 1 + extra.len(),
        "repo_errors": extra_errors,
        "message": if extra_errors.is_empty() {
            format!(
                "Worker démarré : {serving} repo(s), une machine Cursor par dépôt ({name}-<dépôt>)"
            )
        } else {
            format!(
                "Worker « {name} » démarré : {serving}/{} repo(s) actifs",
                workdirs.len()
            )
        },
    }))
}

pub fn restart_named(
    settings: &WorkerSettings,
    bin: &Path,
    name: &str,
    workdirs: &[String],
) -> Result<Value, String> {
    let _ = stop();
    std::thread::sleep(std::time::Duration::from_millis(300));
    start_named(settings, bin, name, workdirs)
}

/// Statut du worker local (leader). `node_name` sert au nom par défaut.
pub async fn status_json(pool: &PgPool, node_name: &str) -> Result<Value, String> {
    let settings = load_settings(pool).await;
    let dirs = list_project_workdirs(pool).await?;
    let eligible = eligible_paths(&dirs, &settings.extra_dirs);
    let bin = resolve_agent_binary(&settings);
    let version = bin.as_ref().and_then(|p| agent_version(p));
    let running = is_running();
    let pid = read_pid().filter(|_| running);
    let ready = if running {
        Some(probe_ready_local().await)
    } else {
        None
    };
    let key = effective_api_key(&settings);
    let name = resolve_worker_name_for_node(&settings, node_name);
    let logs = if running || err_path().is_file() || out_path().is_file() {
        read_logs_tail(30)
    } else {
        String::new()
    };
    let key_invalid = key.is_some() && logs_show_invalid_key(&logs);
    let registered = load_registered();
    let repo_workers = repo_workers_state(&name, &registered);
    let repos_up = repo_workers
        .iter()
        .filter(|w| w["running"].as_bool() == Some(true))
        .count();
    // Session `cursor-agent login` (utilisée quand aucune clé n'est enregistrée).
    let logged_in = key.is_none() && bin.as_deref().is_some_and(is_logged_in);
    let key_unsupported = key
        .as_ref()
        .is_some_and(|(k, _)| key_unsupported_by_worker(k));

    Ok(json!({
        "ok": true,
        "running": running,
        "ready": ready,
        "pid": pid,
        "name": name,
        "cli_installed": bin.is_some(),
        "cli_managed": bin.as_ref().is_some_and(|p| p.starts_with(managed_home())),
        "cli_path": bin.as_ref().map(|p| p.display().to_string()),
        "cli_version": version,
        "api_key_set": key.is_some(),
        "api_key_source": key.as_ref().map(|(_, s)| *s),
        "api_key_masked": key.as_ref().map(|(k, _)| mask_key(k)),
        "enabled": settings.enabled,
        "settings": {
            "name": settings.name,
            "binary": settings.binary,
            "extra_dirs": settings.extra_dirs,
            "enabled": settings.enabled,
            "node_id": settings.node_id,
        },
        "workdirs": dirs,
        "eligible_count": eligible.len(),
        "eligible_paths": eligible,
        "registered_paths": registered,
        "repo_workers": repo_workers,
        "repos_up": if running { Some(repos_up) } else { None },
        "env_key_present": env_key_present(),
        "key_invalid": key_invalid,
        "key_unsupported": key_unsupported,
        "logged_in": logged_in,
        "auth": if key.is_some() { "key" } else if logged_in { "login" } else { "none" },
        "logs_tail": logs,
        "hint": if key_invalid && key_unsupported {
            GROK_KEY_HINT
        } else if key_invalid {
            INVALID_KEY_HINT
        } else {
            status_hint(bin.is_some(), key.is_some() || logged_in, running, ready)
        },
    }))
}

// ───────────────────────── Connexion Cursor (login) ─────────────────────────

fn login_out_path() -> PathBuf {
    state_dir().join("login.out")
}

fn login_pid_path() -> PathBuf {
    state_dir().join("login.pid")
}

/// Sortie de `cursor-agent status` → connecté ?
pub fn parse_logged_in(status_out: &str) -> bool {
    let l = strip_ansi(status_out).to_lowercase();
    if l.contains("not logged in") || l.contains("not authenticated") {
        return false;
    }
    l.contains("logged in") || l.contains("authenticated")
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for n in chars.by_ref() {
                    if n.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

/// URL de connexion affichée par `cursor-agent login` (NO_OPEN_BROWSER).
pub fn parse_login_url(out: &str) -> Option<String> {
    strip_ansi(out)
        .split_whitespace()
        .find(|w| w.starts_with("https://cursor.com/") || w.starts_with("https://www.cursor.com/"))
        .map(|w| w.trim_end_matches(['.', ',', ')']).to_string())
}

/// Session CLI valide dans le HOME géré (`cursor-agent status`, sans clé).
pub fn is_logged_in(bin: &Path) -> bool {
    let out = Command::new(bin)
        .arg("status")
        .env("HOME", managed_home())
        .env("NO_OPEN_BROWSER", "1")
        .env_remove("CURSOR_API_KEY")
        .stdin(Stdio::null())
        .output();
    match out {
        Ok(o) => parse_logged_in(&format!(
            "{}\n{}",
            String::from_utf8_lossy(&o.stdout),
            String::from_utf8_lossy(&o.stderr)
        )),
        Err(_) => false,
    }
}

fn login_pending_pid() -> Option<u32> {
    let raw = std::fs::read_to_string(login_pid_path()).ok()?;
    let pid: u32 = raw.trim().parse().ok()?;
    pid_is_alive(pid).then_some(pid)
}

/// Lance `cursor-agent login` (sans navigateur) et renvoie l'URL à ouvrir.
/// Le process attend la validation dans le navigateur puis enregistre la
/// session dans [`managed_home`].
pub fn login_start(bin: &Path) -> Result<String, String> {
    ensure_state_dir()?;
    std::fs::create_dir_all(managed_home()).map_err(|e| e.to_string())?;
    if let Some(pid) = login_pending_pid() {
        let _ = kill_pid(pid);
    }
    let out = std::fs::File::create(login_out_path()).map_err(|e| e.to_string())?;
    let err = out.try_clone().map_err(|e| e.to_string())?;
    let child = Command::new(bin)
        .arg("login")
        .env("HOME", managed_home())
        .env("NO_OPEN_BROWSER", "1")
        .env_remove("CURSOR_API_KEY")
        .stdin(Stdio::null())
        .stdout(Stdio::from(out))
        .stderr(Stdio::from(err))
        .spawn()
        .map_err(|e| format!("Échec `cursor-agent login` : {e}"))?;
    let pid = child.id();
    std::fs::write(login_pid_path(), pid.to_string()).map_err(|e| e.to_string())?;
    let _ = std::thread::Builder::new()
        .name("cursor-login-reap".into())
        .spawn(move || {
            let mut child = child;
            let _ = child.wait();
        });
    for _ in 0..40 {
        std::thread::sleep(std::time::Duration::from_millis(250));
        let raw = std::fs::read_to_string(login_out_path()).unwrap_or_default();
        if let Some(url) = parse_login_url(&raw) {
            return Ok(url);
        }
        if !pid_is_alive(pid) {
            return Err(format!(
                "`cursor-agent login` s'est arrêté.\n{}",
                tail_lines(&strip_ansi(&raw), 10)
            ));
        }
    }
    Err("`cursor-agent login` n'a pas donné d'URL de connexion (10 s).".into())
}

/// État de la connexion : (en attente, URL, connecté).
pub fn login_state(bin: Option<&Path>) -> Value {
    let pending = login_pending_pid().is_some();
    let raw = std::fs::read_to_string(login_out_path()).unwrap_or_default();
    let logged_in = bin.is_some_and(is_logged_in);
    json!({
        "pending": pending && !logged_in,
        "url": if pending { parse_login_url(&raw) } else { None },
        "logged_in": logged_in,
    })
}

/// Les clés `grok_` (nouvelles clés à permissions) ne sont pas encore
/// acceptées par la validation du worker côté Cursor (bug connu, oct. 2026).
pub fn key_unsupported_by_worker(key: &str) -> bool {
    key.trim().starts_with("grok_")
}

/// Clé `grok_` refusée par le worker.
pub const GROK_KEY_HINT: &str =
    "Les clés grok_ ne sont pas encore acceptées par le worker Cursor : utilise « Se connecter avec Cursor ».";

/// Message affiché quand Cursor a refusé la clé.
pub const INVALID_KEY_HINT: &str =
    "Cursor a refusé la clé API. Utilise « Se connecter avec Cursor » ou colle une autre clé Cursor.";

/// Phrase d'état unique (sans commande à taper).
pub fn status_hint(cli: bool, key: bool, running: bool, ready: Option<bool>) -> &'static str {
    if !key {
        "Il manque ta clé API Cursor : clique « Installer le worker Cursor »."
    } else if !cli {
        "Le CLI Cursor sera installé automatiquement par « Installer le worker Cursor »."
    } else if !running {
        "Worker arrêté. « Installer le worker Cursor » le (ré)installe et le démarre."
    } else if ready == Some(false) {
        "Worker démarré, connexion à Cursor en cours."
    } else {
        "Worker connecté : une machine par dépôt. Dans Cursor (My Machines) ou Grok Bot, choisis <nom>-<dépôt> (ex. worker=<nom>-mon-depot)."
    }
}

/// Au boot : si auto-start activé et worker sur le leader, lance le worker
/// après un délai (le cas « nœud distant » est géré par les routes).
pub fn spawn_autostart(pool: PgPool, node_name: String) {
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(20)).await;
        let settings = load_settings(&pool).await;
        if !settings.enabled || !is_leader_target(&settings.node_id) {
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
        let Some(bin) = resolve_agent_binary(&settings) else {
            tracing::warn!("cursor-worker autostart: CLI absent");
            return;
        };
        let name = resolve_worker_name_for_node(&settings, &node_name);
        match start_named(&settings, &bin, &name, &paths) {
            Ok(v) => tracing::info!(name = ?v.get("name"), "cursor-worker autostart ok"),
            Err(e) => tracing::warn!(error = %tail_lines(&e, 3), "cursor-worker autostart"),
        }
    });
}

/// `''`, `default` ou `local` = leader (ce serveur).
pub fn is_leader_target(node_id: &str) -> bool {
    matches!(node_id.trim(), "" | "default" | "local")
}

#[cfg(test)]
#[path = "cursor_worker_tests.rs"]
mod tests;
