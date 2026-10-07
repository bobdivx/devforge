//! Brouillon d'une app = changements du workdir local pas encore sur GitHub.
//!
//! Base de comparaison : `merge-base(HEAD, origin/<branche>)` (ou HEAD sans remote) — inclut donc
//! les fichiers modifiés, ajoutés, supprimés ET les commits locaux non poussés. Les fichiers
//! « bruit » (`.devforge-*`, sorties de build, `.env`) ne comptent pas et ne sont jamais poussés.
//!
//! Tout passe par `git` en local (le workdir vit sur la machine du serveur). Les opérations
//! destructrices (supprimer le brouillon, annuler un fichier) font d'abord une sauvegarde
//! restaurable 7 jours sous `<DEVFORGE_DATA_DIR>/draft-backups/<projet>/<horodatage>/`.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

pub const BACKUP_DAYS: i64 = 7;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DraftFile {
    pub path: String,
    /// `added` | `modified` | `deleted` | `renamed`
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct DraftStatus {
    pub available: bool,
    pub reason: Option<String>,
    pub dirty: bool,
    pub files: Vec<DraftFile>,
    /// Fichiers bruit ignorés dans le décompte (aperçu, build, `.env`…).
    pub junk_count: usize,
    pub branch: String,
    pub head: Option<String>,
    pub base: Option<String>,
    /// Commits locaux pas encore sur GitHub.
    pub ahead: u32,
    /// Commits GitHub pas encore dans le workdir.
    pub behind: u32,
    pub has_remote: bool,
    /// Dernière modification d'un fichier du brouillon (RFC 3339).
    pub updated_at: Option<String>,
}

#[derive(Debug)]
pub struct DraftError(pub String);

impl std::fmt::Display for DraftError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

type R<T> = Result<T, DraftError>;

fn err(s: impl Into<String>) -> DraftError {
    DraftError(s.into())
}

/* ---------------- Bruit ---------------- */

const JUNK_DIRS: &[&str] = &[
    "node_modules", "dist", "build", ".astro", ".next", ".nuxt", ".output", ".svelte-kit", ".vercel",
    ".turbo", ".cache", ".parcel-cache", "coverage", ".nyc_output", "target", "__pycache__", ".pytest_cache",
];

/// Fichiers internes, sorties de build et secrets : jamais comptés, jamais poussés.
pub fn is_junk(path: &str) -> bool {
    let path = path.trim_start_matches("./");
    let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
    let Some(name) = parts.last() else { return true };
    if parts
        .iter()
        .any(|p| *p == ".devforge" || p.starts_with(".devforge-") || p.starts_with(".devforge_") || p.starts_with(".devforge."))
    {
        return true;
    }
    if parts[..parts.len() - 1].iter().any(|p| JUNK_DIRS.contains(p)) {
        return true;
    }
    if *name == ".DS_Store" || name.ends_with(".log") || name.ends_with(".pyc") {
        return true;
    }
    if *name == ".env" || (name.starts_with(".env.") && *name != ".env.example" && *name != ".env.sample") {
        return true;
    }
    false
}

/// Motifs ajoutés à `.git/info/exclude` (local, jamais poussé).
const LOCAL_EXCLUDES: &[&str] = &[".devforge", ".devforge-*", ".devforge.*", ".devforge_*", ".env", ".env.*", "!.env.example", "*.log", ".DS_Store"];

/* ---------------- git ---------------- */

fn git(workdir: &Path, args: &[&str]) -> R<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(workdir)
        .args(["-c", "core.quotepath=off", "-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=20"])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|e| err(format!("git introuvable : {e}")))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        let mut msg = String::from_utf8_lossy(&out.stderr).trim().to_string();
        if msg.is_empty() {
            msg = String::from_utf8_lossy(&out.stdout).trim().to_string();
        }
        Err(err(msg))
    }
}

fn git_ok(workdir: &Path, args: &[&str]) -> bool {
    git(workdir, args).is_ok()
}

/// Retire un jeton éventuel des messages (URL `https://x-access-token:…@`).
pub fn redact(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find("https://") {
        out.push_str(&rest[..i + 8]);
        rest = &rest[i + 8..];
        let end = rest.find(|c: char| c.is_whitespace() || c == '\'' || c == '"').unwrap_or(rest.len());
        if let Some(at) = rest[..end].find('@') {
            out.push_str("***@");
            rest = &rest[at + 1..];
        }
    }
    out.push_str(rest);
    out
}

/// URL de push/fetch avec jeton (jamais écrite dans `.git/config`).
pub fn token_url(repo: &str, token: Option<&str>) -> String {
    let repo = repo.trim().trim_end_matches('/').trim_end_matches(".git");
    let https = if repo.starts_with("https://") || repo.starts_with("http://") {
        format!("{repo}.git")
    } else if let Some(path) = repo.strip_prefix("git@github.com:") {
        format!("https://github.com/{path}.git")
    } else if repo.contains("github.com/") {
        format!("https://{}.git", repo.trim_start_matches("https://"))
    } else {
        format!("https://github.com/{repo}.git")
    };
    match token.map(str::trim).filter(|t| !t.is_empty()) {
        Some(t) => https.replacen("https://", &format!("https://x-access-token:{t}@"), 1),
        None => https,
    }
}

fn remote_ref(branch: &str) -> String {
    format!("refs/remotes/origin/{branch}")
}

fn has_remote_ref(workdir: &Path, branch: &str) -> bool {
    git_ok(workdir, &["rev-parse", "--verify", "--quiet", &remote_ref(branch)])
}

/// Met à jour `origin/<branche>` depuis GitHub (best effort).
pub fn fetch(workdir: &Path, branch: &str, url: Option<&str>) -> R<()> {
    let refspec = format!("+refs/heads/{branch}:{}", remote_ref(branch));
    let remote = url.unwrap_or("origin");
    git(workdir, &["fetch", "--quiet", "--no-tags", remote, &refspec]).map(|_| ()).map_err(|e| err(redact(&e.0)))
}

fn base_commit(workdir: &Path, branch: &str) -> Option<String> {
    if has_remote_ref(workdir, branch) {
        if let Ok(mb) = git(workdir, &["merge-base", "HEAD", &remote_ref(branch)]) {
            return Some(mb.trim().to_string());
        }
    }
    git(workdir, &["rev-parse", "HEAD"]).ok().map(|s| s.trim().to_string())
}

fn split_nul(s: &str) -> Vec<String> {
    s.split('\0').filter(|p| !p.is_empty()).map(str::to_string).collect()
}

/// Fichiers du brouillon (bruit compris), par rapport à `base`.
fn raw_files(workdir: &Path, base: Option<&str>) -> R<Vec<DraftFile>> {
    let mut files = Vec::new();
    if let Some(base) = base {
        let out = git(workdir, &["diff", "--name-status", "-z", "-M", base])?;
        let toks = split_nul(&out);
        let mut i = 0;
        while i < toks.len() {
            let code = toks[i].clone();
            let letter = code.chars().next().unwrap_or('M');
            if letter == 'R' || letter == 'C' {
                if i + 2 >= toks.len() {
                    break;
                }
                let old = toks.get(i + 1).cloned().unwrap_or_default();
                let new = toks.get(i + 2).cloned().unwrap_or_default();
                files.push(DraftFile { path: new, status: "renamed".into(), old_path: Some(old) });
                i += 3;
            } else {
                let path = toks.get(i + 1).cloned().unwrap_or_default();
                let status = match letter {
                    'A' => "added",
                    'D' => "deleted",
                    _ => "modified",
                };
                files.push(DraftFile { path, status: status.into(), old_path: None });
                i += 2;
            }
        }
    }
    let untracked = git(workdir, &["ls-files", "--others", "--exclude-standard", "-z"])?;
    for path in split_nul(&untracked) {
        if !files.iter().any(|f| f.path == path) {
            files.push(DraftFile { path, status: "added".into(), old_path: None });
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

fn count(workdir: &Path, range: &str) -> u32 {
    git(workdir, &["rev-list", "--count", range]).ok().and_then(|s| s.trim().parse().ok()).unwrap_or(0)
}

fn mtime_rfc3339(workdir: &Path, files: &[DraftFile]) -> Option<String> {
    files
        .iter()
        .filter_map(|f| std::fs::metadata(workdir.join(&f.path)).ok()?.modified().ok())
        .max()
        .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
}

/// État du brouillon. `fetch_url` : rafraîchit d'abord `origin/<branche>` (lent, réseau).
pub fn status(workdir: &Path, branch: &str, fetch_url: Option<&str>) -> DraftStatus {
    let mut st = DraftStatus { branch: branch.to_string(), ..Default::default() };
    if !workdir.is_dir() {
        st.reason = Some("Le dossier de travail de l'app est introuvable sur ce serveur.".into());
        return st;
    }
    if !git_ok(workdir, &["rev-parse", "--git-dir"]) {
        st.reason = Some("Le dossier de travail n'est pas un dépôt git.".into());
        return st;
    }
    if let Some(url) = fetch_url {
        let _ = fetch(workdir, branch, Some(url));
    }
    st.available = true;
    // Fichiers internes DevForge jamais comptés ni proposés à git (local, rien n'est poussé).
    ensure_local_excludes(workdir);
    st.has_remote = has_remote_ref(workdir, branch);
    st.head = git(workdir, &["rev-parse", "--short=12", "HEAD"]).ok().map(|s| s.trim().to_string());
    let base = base_commit(workdir, branch);
    st.base = base.as_ref().map(|b| b.chars().take(12).collect());
    match raw_files(workdir, base.as_deref()) {
        Ok(all) => {
            let (junk, files): (Vec<_>, Vec<_>) = all.into_iter().partition(|f| is_junk(&f.path));
            st.junk_count = junk.len();
            st.updated_at = mtime_rfc3339(workdir, &files);
            st.files = files;
        }
        Err(e) => {
            st.available = false;
            st.reason = Some(e.0);
            return st;
        }
    }
    if st.has_remote {
        let r = remote_ref(branch);
        st.ahead = count(workdir, &format!("{r}..HEAD"));
        st.behind = count(workdir, &format!("HEAD..{r}"));
    }
    st.dirty = !st.files.is_empty();
    st
}

/* ---------------- Diff ---------------- */

const MAX_NEW_FILE_BYTES: u64 = 200_000;

/// Patch d'un fichier ajouté non suivi par git (toutes les lignes en `+`).
fn synthesize_added_patch(workdir: &Path, path: &str) -> Option<String> {
    let full = workdir.join(path);
    let meta = std::fs::metadata(&full).ok()?;
    if meta.len() > MAX_NEW_FILE_BYTES {
        return Some(format!("@@ nouveau fichier ({} Ko, trop gros pour l'aperçu) @@", meta.len() / 1024));
    }
    let bytes = std::fs::read(&full).ok()?;
    let Ok(text) = String::from_utf8(bytes) else {
        return Some("@@ fichier binaire @@".into());
    };
    let lines: Vec<&str> = text.lines().collect();
    let mut out = format!("@@ -0,0 +1,{} @@", lines.len());
    for l in lines {
        out.push_str("\n+");
        out.push_str(l);
    }
    Some(out)
}

/// Diff du brouillon : `(chemin, statut, patch, ajouts, suppressions)` par fichier (bruit exclu).
pub fn diff(workdir: &Path, branch: &str, only: Option<&str>) -> R<Vec<serde_json::Value>> {
    let st = status(workdir, branch, None);
    if !st.available {
        return Err(err(st.reason.unwrap_or_default()));
    }
    let base = base_commit(workdir, branch);
    let files: Vec<&DraftFile> = st.files.iter().filter(|f| only.map_or(true, |p| f.path == p)).collect();
    if only.is_some() && files.is_empty() {
        return Err(err("Ce fichier ne fait pas partie du brouillon."));
    }
    let mut out = Vec::new();
    for f in files {
        let untracked = base
            .as_deref()
            .map(|b| !git_ok(workdir, &["cat-file", "-e", &format!("{b}:{}", f.old_path.as_deref().unwrap_or(&f.path))]))
            .unwrap_or(true)
            && f.status == "added";
        let patch = if untracked {
            synthesize_added_patch(workdir, &f.path)
        } else {
            let mut args = vec!["diff", "--no-color", "-M"];
            if let Some(b) = base.as_deref() {
                args.push(b);
            }
            args.push("--");
            if let Some(old) = f.old_path.as_deref() {
                args.push(old);
            }
            args.push(&f.path);
            git(workdir, &args).ok().map(|raw| {
                raw.lines()
                    .skip_while(|l| !l.starts_with("@@") && !l.starts_with("Binary"))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
        };
        let patch = patch.unwrap_or_default();
        let additions = patch.lines().filter(|l| l.starts_with('+') && !l.starts_with("+++")).count();
        let deletions = patch.lines().filter(|l| l.starts_with('-') && !l.starts_with("---")).count();
        out.push(serde_json::json!({
            "path": f.path,
            "status": f.status,
            "old_path": f.old_path,
            "additions": additions,
            "deletions": deletions,
            "patch": if patch.is_empty() { serde_json::Value::Null } else { serde_json::json!(patch) },
        }));
    }
    Ok(out)
}

/* ---------------- Message de commit ---------------- */

/// Message proposé à partir des fichiers (modifiable avant de valider).
pub fn suggested_message(files: &[DraftFile]) -> String {
    if files.is_empty() {
        return String::new();
    }
    let added = files.iter().filter(|f| f.status == "added").count();
    let deleted = files.iter().filter(|f| f.status == "deleted").count();
    let verb = if added == files.len() {
        "feat: ajoute"
    } else if deleted == files.len() {
        "chore: supprime"
    } else {
        "feat: met à jour"
    };
    let names: Vec<&str> = files
        .iter()
        .take(3)
        .map(|f| f.path.rsplit('/').next().unwrap_or(&f.path))
        .collect();
    let more = files.len().saturating_sub(3);
    let tail = if more > 0 { format!(" (+{more})") } else { String::new() };
    format!("{verb} {}{tail}", names.join(", "))
}

/* ---------------- Valider (commit + push) ---------------- */

#[derive(Debug, Serialize)]
pub struct Validated {
    pub sha: String,
    pub files: usize,
    pub branch: String,
}

fn ensure_local_excludes(workdir: &Path) {
    let Ok(git_dir) = git(workdir, &["rev-parse", "--git-dir"]) else { return };
    let git_dir = workdir.join(git_dir.trim());
    let path = git_dir.join("info").join("exclude");
    let current = std::fs::read_to_string(&path).unwrap_or_default();
    let missing: Vec<&str> = LOCAL_EXCLUDES.iter().copied().filter(|p| !current.lines().any(|l| l.trim() == *p)).collect();
    if missing.is_empty() {
        return;
    }
    let _ = std::fs::create_dir_all(git_dir.join("info"));
    let mut next = current;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str("# DevForge : fichiers internes jamais poussés\n");
    for p in missing {
        next.push_str(p);
        next.push('\n');
    }
    let _ = std::fs::write(&path, next);
}

fn git_dir(workdir: &Path) -> R<PathBuf> {
    Ok(workdir.join(git(workdir, &["rev-parse", "--git-dir"])?.trim()))
}

/// Commit des fichiers du brouillon (bruit exclu) puis push sur `<branche>`.
pub fn validate(workdir: &Path, branch: &str, push_url: &str, message: &str, author: (&str, &str)) -> R<Validated> {
    let message = message.trim();
    if message.is_empty() {
        return Err(err("Le message de validation est vide."));
    }
    let st = status(workdir, branch, Some(push_url));
    if !st.available {
        return Err(err(st.reason.unwrap_or_default()));
    }
    if !st.dirty {
        return Err(err("Rien à valider : le brouillon est vide."));
    }
    if st.behind > 0 {
        return Err(err(format!(
            "GitHub a {} commit{} que le brouillon n'a pas. Mets d'abord à jour depuis GitHub, puis valide.",
            st.behind,
            if st.behind > 1 { "s" } else { "" }
        )));
    }
    ensure_local_excludes(workdir);
    let gd = git_dir(workdir)?;
    let mut spec = Vec::new();
    for f in &st.files {
        spec.extend_from_slice(f.path.as_bytes());
        spec.push(0);
        if let Some(old) = &f.old_path {
            spec.extend_from_slice(old.as_bytes());
            spec.push(0);
        }
    }
    let spec_path = gd.join("devforge-pathspec");
    let msg_path = gd.join("devforge-commit-msg");
    std::fs::write(&spec_path, spec).map_err(|e| err(e.to_string()))?;
    std::fs::write(&msg_path, format!("{message}\n")).map_err(|e| err(e.to_string()))?;
    // Index propre : seuls les fichiers du brouillon (jamais le bruit déjà indexé par erreur).
    let _ = git(workdir, &["reset", "--quiet"]);
    let spec_arg = format!("--pathspec-from-file={}", spec_path.display());
    git(workdir, &["add", "-A", &spec_arg, "--pathspec-file-nul"])?;
    let staged = !git_ok(workdir, &["diff", "--cached", "--quiet"]);
    if staged {
        let name = format!("user.name={}", author.0);
        let email = format!("user.email={}", author.1);
        let msg_arg = msg_path.display().to_string();
        git(workdir, &["-c", &name, "-c", &email, "commit", "--quiet", "--no-verify", "-F", &msg_arg])?;
    }
    let _ = std::fs::remove_file(&spec_path);
    let _ = std::fs::remove_file(&msg_path);
    let dest = format!("HEAD:refs/heads/{branch}");
    git(workdir, &["push", "--quiet", push_url, &dest]).map_err(|e| {
        let m = redact(&e.0);
        if m.contains("non-fast-forward") || m.contains("rejected") || m.contains("fetch first") {
            err("GitHub a avancé pendant ce temps. Mets à jour depuis GitHub, puis valide à nouveau.")
        } else {
            err(format!("Envoi sur GitHub impossible : {m}"))
        }
    })?;
    let _ = git(workdir, &["update-ref", &remote_ref(branch), "HEAD"]);
    let sha = git(workdir, &["rev-parse", "--short=12", "HEAD"])?.trim().to_string();
    Ok(Validated { sha, files: st.files.len(), branch: branch.to_string() })
}

/* ---------------- Sauvegardes ---------------- */

#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq)]
pub struct Backup {
    pub id: String,
    pub created_at: String,
    /// `discard` | `revert-file`
    pub reason: String,
    pub files: Vec<String>,
    pub deleted: Vec<String>,
    pub head: Option<String>,
}

pub fn backups_root(data_dir: &Path, project_uuid: &str) -> PathBuf {
    data_dir.join("draft-backups").join(project_uuid)
}

fn safe_rel(path: &str) -> bool {
    !path.is_empty() && !path.starts_with('/') && !path.split('/').any(|c| c == "..")
}

/// Sauvegarde les fichiers du brouillon (ou un seul) avant une opération destructrice.
pub fn backup(workdir: &Path, root: &Path, files: &[DraftFile], reason: &str) -> R<Backup> {
    let now = chrono::Utc::now();
    let id = now.format("%Y%m%dT%H%M%S%3fZ").to_string();
    let dir = root.join(&id);
    std::fs::create_dir_all(&dir).map_err(|e| err(format!("Sauvegarde impossible : {e}")))?;
    let mut keep = Vec::new();
    let mut deleted = Vec::new();
    for f in files.iter().filter(|f| safe_rel(&f.path)) {
        if workdir.join(&f.path).is_file() {
            keep.push(f.path.clone());
        } else {
            deleted.push(f.path.clone());
        }
        if let Some(old) = f.old_path.as_ref().filter(|o| safe_rel(o)) {
            deleted.push(old.clone());
        }
    }
    if !keep.is_empty() {
        let list = dir.join("files.list");
        let mut buf = Vec::new();
        for p in &keep {
            buf.extend_from_slice(p.as_bytes());
            buf.push(0);
        }
        std::fs::write(&list, buf).map_err(|e| err(e.to_string()))?;
        let out = Command::new("tar")
            .arg("-czf")
            .arg(dir.join("files.tar.gz"))
            .arg("-C")
            .arg(workdir)
            .arg("--null")
            .arg("-T")
            .arg(&list)
            .output()
            .map_err(|e| err(format!("tar introuvable : {e}")))?;
        if !out.status.success() {
            let _ = std::fs::remove_dir_all(&dir);
            return Err(err(format!("Sauvegarde impossible : {}", String::from_utf8_lossy(&out.stderr).trim())));
        }
    }
    let b = Backup {
        id,
        created_at: now.to_rfc3339(),
        reason: reason.to_string(),
        files: keep,
        deleted,
        head: git(workdir, &["rev-parse", "HEAD"]).ok().map(|s| s.trim().to_string()),
    };
    std::fs::write(dir.join("manifest.json"), serde_json::to_vec_pretty(&b).unwrap_or_default())
        .map_err(|e| err(e.to_string()))?;
    Ok(b)
}

/// Sauvegardes de moins de 7 jours, les plus récentes d'abord (les plus vieilles sont supprimées).
pub fn list_backups(root: &Path) -> Vec<Backup> {
    let Ok(entries) = std::fs::read_dir(root) else { return Vec::new() };
    let cutoff = chrono::Utc::now() - chrono::Duration::days(BACKUP_DAYS);
    let mut out = Vec::new();
    for e in entries.flatten() {
        let dir = e.path();
        let Some(b) = std::fs::read(dir.join("manifest.json"))
            .ok()
            .and_then(|raw| serde_json::from_slice::<Backup>(&raw).ok())
        else {
            continue;
        };
        let created = chrono::DateTime::parse_from_rfc3339(&b.created_at).map(|d| d.with_timezone(&chrono::Utc));
        if created.map(|c| c < cutoff).unwrap_or(true) {
            let _ = std::fs::remove_dir_all(&dir);
            continue;
        }
        out.push(b);
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    out
}

/// Remet les fichiers d'une sauvegarde dans le workdir (écrase les versions actuelles).
pub fn restore(workdir: &Path, root: &Path, id: &str) -> R<Backup> {
    if id.is_empty() || id.contains('/') || id.contains("..") {
        return Err(err("Sauvegarde invalide."));
    }
    let dir = root.join(id);
    let b: Backup = std::fs::read(dir.join("manifest.json"))
        .ok()
        .and_then(|raw| serde_json::from_slice(&raw).ok())
        .ok_or_else(|| err("Sauvegarde introuvable (plus de 7 jours ?)."))?;
    let tar = dir.join("files.tar.gz");
    if tar.is_file() {
        let out = Command::new("tar")
            .arg("-xzf")
            .arg(&tar)
            .arg("-C")
            .arg(workdir)
            .output()
            .map_err(|e| err(format!("tar introuvable : {e}")))?;
        if !out.status.success() {
            return Err(err(format!("Restauration impossible : {}", String::from_utf8_lossy(&out.stderr).trim())));
        }
    }
    for p in b.deleted.iter().filter(|p| safe_rel(p)) {
        let _ = std::fs::remove_file(workdir.join(p));
    }
    let _ = std::fs::remove_dir_all(&dir);
    Ok(b)
}

/* ---------------- Supprimer / annuler ---------------- */

fn clean_excludes() -> Vec<String> {
    let mut v: Vec<String> = vec![".devforge".into(), ".devforge-*".into(), ".devforge.*".into(), ".devforge_*".into(), ".env".into(), ".env.*".into()];
    v.extend(JUNK_DIRS.iter().map(|d| d.to_string()));
    v
}

/// Remet le workdir à l'état de GitHub (`origin/<branche>`), en gardant dépendances et fichiers internes.
pub fn discard(workdir: &Path, branch: &str, fetch_url: Option<&str>) -> R<String> {
    if let Some(url) = fetch_url {
        let _ = fetch(workdir, branch, Some(url));
    }
    let target = if has_remote_ref(workdir, branch) { remote_ref(branch) } else { "HEAD".to_string() };
    git(workdir, &["reset", "--quiet", "--hard", &target])?;
    let mut args: Vec<String> = vec!["clean".into(), "-fdq".into()];
    for e in clean_excludes() {
        args.push("-e".into());
        args.push(e);
    }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    git(workdir, &refs)?;
    Ok(git(workdir, &["rev-parse", "--short=12", "HEAD"])?.trim().to_string())
}

/// Remet un seul fichier comme sur GitHub (ou le retire s'il est nouveau).
pub fn revert_file(workdir: &Path, branch: &str, file: &DraftFile) -> R<()> {
    if !safe_rel(&file.path) {
        return Err(err("Chemin invalide."));
    }
    let base = base_commit(workdir, branch);
    let in_base = |p: &str| base.as_deref().map(|b| git_ok(workdir, &["cat-file", "-e", &format!("{b}:{p}")])).unwrap_or(false);
    if let Some(old) = file.old_path.as_deref() {
        if in_base(old) {
            git(workdir, &["checkout", base.as_deref().unwrap_or("HEAD"), "--", old])?;
        }
    }
    if in_base(&file.path) {
        git(workdir, &["checkout", base.as_deref().unwrap_or("HEAD"), "--", &file.path])?;
    } else {
        let _ = git(workdir, &["rm", "--quiet", "--cached", "--ignore-unmatch", "--", &file.path]);
        let full = workdir.join(&file.path);
        if full.is_file() {
            std::fs::remove_file(&full).map_err(|e| err(e.to_string()))?;
        }
    }
    Ok(())
}

/* ---------------- Mettre à jour depuis GitHub ---------------- */

#[derive(Debug, Serialize, PartialEq)]
pub struct Updated {
    pub merged: u32,
    pub head: String,
}

/// Avance le workdir jusqu'à GitHub si c'est sans risque (pas de commit local, pas de fichier en commun).
pub fn update_from_github(workdir: &Path, branch: &str, fetch_url: Option<&str>, author: (&str, &str)) -> R<Updated> {
    if let Some(url) = fetch_url {
        fetch(workdir, branch, Some(url)).map_err(|e| err(format!("GitHub injoignable : {}", e.0)))?;
    }
    if !has_remote_ref(workdir, branch) {
        return Err(err("Pas de branche GitHub à suivre pour cette app."));
    }
    let r = remote_ref(branch);
    let behind = count(workdir, &format!("HEAD..{r}"));
    let head = || git(workdir, &["rev-parse", "--short=12", "HEAD"]).map(|s| s.trim().to_string());
    if behind == 0 {
        return Ok(Updated { merged: 0, head: head()? });
    }
    let ahead = count(workdir, &format!("{r}..HEAD"));
    if ahead > 0 {
        return Err(err(format!(
            "Le brouillon a {ahead} commit{} local et GitHub a avancé de son côté. Valide d'abord le brouillon, ou demande à Braise de fusionner.",
            if ahead > 1 { "s" } else { "" }
        )));
    }
    let incoming = split_nul(&git(workdir, &["diff", "--name-only", "-z", "HEAD", &r])?);
    let st = status(workdir, branch, None);
    let overlap: Vec<&String> = incoming.iter().filter(|p| st.files.iter().any(|f| &f.path == *p)).collect();
    if !overlap.is_empty() {
        let list = overlap.iter().take(5).map(|s| s.as_str()).collect::<Vec<_>>().join(", ");
        return Err(err(format!(
            "GitHub et le brouillon ont modifié les mêmes fichiers ({list}). Valide ou supprime d'abord le brouillon pour ces fichiers."
        )));
    }
    let name = format!("user.name={}", author.0);
    let email = format!("user.email={}", author.1);
    git(workdir, &["-c", &name, "-c", &email, "merge", "--quiet", "--ff-only", "--autostash", &r])?;
    Ok(Updated { merged: behind, head: head()? })
}

#[cfg(test)]
#[path = "draft_tests.rs"]
mod tests;
