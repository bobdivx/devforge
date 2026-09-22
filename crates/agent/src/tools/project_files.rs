use async_trait::async_trait;
use devforge_github::GitHubFacade;
use devforge_mcp::McpFacade;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::path::{Path, PathBuf};
use std::sync::Arc;

const SKIP_DIR_NAMES: &[&str] = &[
    ".git",
    "node_modules",
    "dist",
    "build",
    "target",
    ".astro",
    ".next",
    ".vercel",
    ".cache",
    "vendor",
    "__pycache__",
];
const MAX_LIST_FILES: usize = 200;
const MAX_READ_BYTES: usize = 150_000;

/// Tool pour écrire des fichiers dans le workdir du projet (local) ou sur GitHub.
pub struct WriteProjectFileTool {
    pub github: Arc<GitHubFacade>,
    pub mcp: Arc<McpFacade>,
    pub pool: Arc<PgPool>,
}

#[async_trait]
impl Tool for WriteProjectFileTool {
    fn name(&self) -> &str {
        "write_project_file"
    }

    fn description(&self) -> &str {
        "Écrit un fichier dans le projet DevForge (workdir local ou GitHub selon le mode).\n\
         \n\
         Paramètres :\n\
         - project_uuid : UUID du projet DevForge (contexte par défaut)\n\
         - path : chemin du fichier (ex: src/index.js, package.json)\n\
         - content : contenu du fichier à écrire\n\
         - mode : 'local' (PRÉFÉRÉ, défaut) ou 'github' — local écrit dans workdir, github pousse via API\n\
         - commit_message : message de commit (pour mode github, défaut: auto-généré)\n\
         - branch : branche cible (pour mode github, défaut: main)\n\
         \n\
         Mode 'local' (PRÉFÉRÉ, défaut) :\n\
         - Écrit le fichier directement dans le workdir du projet\n\
         - Crée les répertoires parents si nécessaire\n\
         - Rapide, pas de commit/push immédiat\n\
         - Permet de grouper plusieurs fichiers avant commit/push manuel\n\
         \n\
         Mode 'github' :\n\
         - Écrit via GitHub API HTTP (ou MCP en fallback)\n\
         - Crée un commit automatiquement\n\
         - Nécessite que le projet ait un git_repository configuré\n\
         - Fonctionne avec le token GitHub instance (pas besoin de MCP GitHub)\n\
         \n\
         Exemple (local - PRÉFÉRÉ) :\n\
         {\n\
           \"project_uuid\": \"abc123\",\n\
           \"path\": \"src/App.jsx\",\n\
           \"content\": \"export default function App() { return <h1>Hello</h1>; }\",\n\
           \"mode\": \"local\"\n\
         }\n\
         \n\
         Exemple (github) :\n\
         {\n\
           \"project_uuid\": \"abc123\",\n\
           \"path\": \"package.json\",\n\
           \"content\": \"{...}\",\n\
           \"mode\": \"github\",\n\
           \"commit_message\": \"feat: add package.json\"\n\
         }"
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_uuid": {
                    "type": "string",
                    "description": "UUID du projet DevForge (injecté automatiquement si dans le contexte)"
                },
                "path": {
                    "type": "string",
                    "description": "Chemin du fichier relatif au projet (ex: src/index.js)"
                },
                "content": {
                    "type": "string",
                    "description": "Contenu du fichier à écrire"
                },
                "mode": {
                    "type": "string",
                    "enum": ["local", "github"],
                    "description": "Mode d'écriture : 'local' (workdir) ou 'github' (via MCP, avec commit)"
                },
                "commit_message": {
                    "type": "string",
                    "description": "Message de commit (mode github uniquement, défaut: auto-généré)"
                },
                "branch": {
                    "type": "string",
                    "description": "Branche cible (mode github, défaut: main)"
                }
            },
            "required": ["project_uuid", "path", "content"]
        })
    }

    async fn execute(&self, arguments: Value) -> Result<Value> {
        // Note : project_uuid est automatiquement injecté par inject_tool_defaults
        // depuis le contexte d'agent (issue #1 corrigée).
        let project_uuid = arguments
            .get("project_uuid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let path = arguments
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let content = arguments
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let mode = arguments
            .get("mode")
            .and_then(|v| v.as_str())
            .unwrap_or("local")
            .trim();
        let commit_message = arguments.get("commit_message").and_then(|v| v.as_str());
        let branch = arguments
            .get("branch")
            .and_then(|v| v.as_str())
            .unwrap_or("main");

        if project_uuid.is_empty() || path.is_empty() {
            return Ok(json!({
                "ok": false,
                "error": "project_uuid et path requis. Le project_uuid aurait dû être injecté automatiquement depuis le contexte."
            }));
        }

        // Valider le path (pas de .. ni chemins absolus)
        if path.contains("..") || path.starts_with('/') {
            return Ok(json!({
                "ok": false,
                "error": "Chemin invalide : pas de '..' ni chemins absolus autorisés"
            }));
        }

        // Récupérer le projet
        let project: Option<(String, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT uuid, workdir, git_repository FROM projects WHERE uuid = $1",
        )
        .bind(project_uuid)
        .fetch_optional(self.pool.as_ref())
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        let Some((uuid, workdir_opt, git_repo_opt)) = project else {
            return Ok(json!({
                "ok": false,
                "error": format!("Projet introuvable : {project_uuid}")
            }));
        };

        match mode {
            "github" => {
                self.write_via_github(
                    &uuid,
                    git_repo_opt,
                    path,
                    content,
                    commit_message,
                    branch,
                )
                .await
            }
            "local" | _ => self.write_local(&uuid, workdir_opt, path, content).await,
        }
    }
}

impl WriteProjectFileTool {
    async fn write_local(
        &self,
        project_uuid: &str,
        workdir_opt: Option<String>,
        path: &str,
        content: &str,
    ) -> Result<Value> {
        let mut workdir_raw = workdir_opt.as_deref().unwrap_or("").trim().to_string();

        if workdir_raw.is_empty() {
            workdir_raw = format!("/data/devforge/applications/{project_uuid}");
            let _ = sqlx::query(
                "UPDATE projects SET workdir = $1, updated_at = to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') WHERE uuid = $2",
            )
            .bind(&workdir_raw)
            .bind(project_uuid)
            .execute(self.pool.as_ref())
            .await;
        }

        // Résoudre le workdir (comme dans devforge_deploy::resolve_project_workdir)
        let workdir = devforge_deploy::resolve_project_workdir(&workdir_raw, project_uuid);
        let workdir_path = std::path::Path::new(&workdir);

        // Créer le workdir s'il n'existe pas
        if !workdir_path.exists() {
            std::fs::create_dir_all(workdir_path).map_err(|e| {
                devforge_shared::DevForgeError::Message(format!(
                    "Impossible de créer le workdir {workdir} : {e}"
                ))
            })?;
        }

        let file_path = workdir_path.join(path);

        // Créer les répertoires parents
        if let Some(parent) = file_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                devforge_shared::DevForgeError::Message(format!(
                    "Impossible de créer le répertoire parent {} : {e}",
                    parent.display()
                ))
            })?;
        }

        let previous = if file_path.is_file() {
            std::fs::read_to_string(&file_path).ok()
        } else {
            None
        };
        let created = previous.is_none();

        // Écrire le fichier
        std::fs::write(&file_path, content).map_err(|e| {
            devforge_shared::DevForgeError::Message(format!(
                "Impossible d'écrire le fichier {} : {e}",
                file_path.display()
            ))
        })?;

        let old = previous.as_deref().unwrap_or("");
        let (additions, deletions, unified_diff) = line_diff_stats(path, old, content);

        Ok(json!({
            "ok": true,
            "mode": "local",
            "path": path,
            "workdir": workdir,
            "full_path": file_path.display().to_string(),
            "bytes": content.len(),
            "created": created,
            "previous_content": previous,
            "additions": additions,
            "deletions": deletions,
            "unified_diff": unified_diff,
            "message": format!("✓ Fichier écrit localement : {path}")
        }))
    }

    async fn write_via_github(
        &self,
        _project_uuid: &str,
        git_repo_opt: Option<String>,
        path: &str,
        content: &str,
        commit_message: Option<&str>,
        branch: &str,
    ) -> Result<Value> {
        let git_repo = git_repo_opt
            .as_deref()
            .unwrap_or("")
            .trim();

        if git_repo.is_empty() {
            return Ok(json!({
                "ok": false,
                "error": "Le projet n'a pas de dépôt GitHub configuré.",
                "hint": "Utilise create_github_repo d'abord, ou utilise mode='local'."
            }));
        }

        // Parser owner/repo depuis l'URL GitHub
        let (owner, repo) = match crate::parse_github_repo(git_repo) {
            Some((o, r)) => (o, r),
            None => {
                return Ok(json!({
                    "ok": false,
                    "error": format!("Impossible de parser l'URL GitHub : {git_repo}")
                }));
            }
        };

        // Message de commit par défaut
        let message = commit_message.unwrap_or_else(|| {
            if path.contains('/') {
                "feat: add file"
            } else {
                "feat: add root file"
            }
        });

        // Essayer d'abord avec GitHubFacade (HTTP PAT)
        let github_mode = self.github.mode();
        if github_mode == "http" {
            // Récupérer le SHA existant si le fichier existe déjà
            let existing_file = self
                .github
                .get_file(&owner, &repo, path, Some(branch))
                .await
                .ok()
                .flatten();

            let sha_opt = existing_file.as_ref().map(|f| f.sha.as_str());

            match self
                .github
                .write_file(&owner, &repo, path, content, message, Some(branch), sha_opt)
                .await
            {
                Ok(file) => {
                    let previous = existing_file
                        .as_ref()
                        .map(|f| f.content.as_str())
                        .unwrap_or("");
                    let (additions, deletions, unified_diff) =
                        line_diff_stats(path, previous, content);
                    return Ok(json!({
                        "ok": true,
                        "mode": "github",
                        "path": path,
                        "owner": owner,
                        "repo": repo,
                        "branch": branch,
                        "commit_message": message,
                        "sha": file.sha,
                        "commit_sha": file.commit_sha,
                        "html_url": file.html_url,
                        "created": previous.is_empty(),
                        "additions": additions,
                        "deletions": deletions,
                        "unified_diff": unified_diff,
                        "message": format!("✓ Fichier écrit sur GitHub : {owner}/{repo}/{path}")
                    }));
                }
                Err(e) => {
                    return Ok(json!({
                        "ok": false,
                        "error": format!("Échec écriture GitHub : {e}"),
                        "step": "write_file"
                    }));
                }
            }
        }

        // Fallback MCP si GitHub HTTP n'est pas configuré
        let servers = self.mcp.clients.list().await;
        let github_server = servers.iter().find(|s| {
            s.id.to_lowercase().contains("github") || s.name.to_lowercase().contains("github")
        });

        let Some(server) = github_server else {
            return Ok(json!({
                "ok": false,
                "error": "GitHub non configuré. Configure un token GitHub dans Settings ou connecte le MCP GitHub.",
                "hint": "L'agent ne peut pas écrire sur GitHub sans accès."
            }));
        };

        let server_id = &server.id;

        // Appeler create_or_update_file via MCP GitHub
        let result = self
            .mcp
            .clients
            .call_remote_tool(
                server_id,
                "create_or_update_file",
                json!({
                    "owner": owner,
                    "repo": repo,
                    "path": path,
                    "content": content,
                    "message": message,
                    "branch": branch
                }),
            )
            .await;

        match result {
            Ok(file_data) => {
                let (additions, deletions, unified_diff) = line_diff_stats(path, "", content);
                Ok(json!({
                    "ok": true,
                    "mode": "github",
                    "path": path,
                    "owner": owner,
                    "repo": repo,
                    "branch": branch,
                    "commit_message": message,
                    "result": file_data,
                    "created": true,
                    "additions": additions,
                    "deletions": deletions,
                    "unified_diff": unified_diff,
                    "message": format!("✓ Fichier écrit sur GitHub : {owner}/{repo}/{path}")
                }))
            }
            Err(e) => Ok(json!({
                "ok": false,
                "error": format!("Échec écriture GitHub : {e}"),
                "step": "create_or_update_file"
            })),
        }
    }
}

/// Lit un fichier du workdir local (pas GitHub).
pub struct ReadProjectFileTool {
    pub pool: Arc<PgPool>,
}

#[async_trait]
impl Tool for ReadProjectFileTool {
    fn name(&self) -> &str {
        "read_project_file"
    }

    fn description(&self) -> &str {
        "Lit un fichier dans le workdir LOCAL du projet (dossier de l'app).\n\
         Préfère cet outil à read_github_file pour travailler sur les fichiers en cours.\n\
         \n\
         Paramètres : project_uuid (injecté), path (relatif, ex: src/pages/index.astro)."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_uuid": {
                    "type": "string",
                    "description": "UUID du projet (injecté automatiquement)"
                },
                "path": {
                    "type": "string",
                    "description": "Chemin relatif dans le workdir"
                }
            },
            "required": ["project_uuid", "path"]
        })
    }

    async fn execute(&self, arguments: Value) -> Result<Value> {
        let project_uuid = arguments
            .get("project_uuid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let path = arguments
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();

        let resolved = match resolve_workdir_file(&self.pool, project_uuid, path).await {
            Ok(v) => v,
            Err(err) => return Ok(err),
        };

        if !resolved.file_path.is_file() {
            return Ok(json!({
                "ok": false,
                "error": format!("Fichier introuvable : {path}"),
                "workdir": resolved.workdir
            }));
        }

        let bytes = std::fs::read(&resolved.file_path).map_err(|e| {
            devforge_shared::DevForgeError::Message(format!("Lecture impossible : {e}"))
        })?;

        if bytes.contains(&0) {
            return Ok(json!({
                "ok": false,
                "error": "Fichier binaire — lecture texte refusée",
                "path": path,
                "bytes": bytes.len()
            }));
        }

        if bytes.len() > MAX_READ_BYTES {
            let preview = String::from_utf8_lossy(&bytes[..MAX_READ_BYTES]).into_owned();
            return Ok(json!({
                "ok": true,
                "path": path,
                "truncated": true,
                "bytes": bytes.len(),
                "content": preview,
                "message": format!("Fichier tronqué à {MAX_READ_BYTES} octets")
            }));
        }

        let content = String::from_utf8_lossy(&bytes).into_owned();
        Ok(json!({
            "ok": true,
            "path": path,
            "bytes": bytes.len(),
            "content": content
        }))
    }
}

/// Liste les fichiers du workdir local.
pub struct ListProjectFilesTool {
    pub pool: Arc<PgPool>,
}

#[async_trait]
impl Tool for ListProjectFilesTool {
    fn name(&self) -> &str {
        "list_project_files"
    }

    fn description(&self) -> &str {
        "Liste les fichiers du workdir LOCAL du projet (ignore node_modules, .git, dist…).\n\
         Utile pour comprendre la structure avant de modifier.\n\
         \n\
         Paramètres : project_uuid (injecté), path optionnel (sous-dossier relatif)."
    }

    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "project_uuid": {
                    "type": "string",
                    "description": "UUID du projet (injecté automatiquement)"
                },
                "path": {
                    "type": "string",
                    "description": "Sous-dossier relatif (défaut: racine du workdir)"
                }
            },
            "required": ["project_uuid"]
        })
    }

    async fn execute(&self, arguments: Value) -> Result<Value> {
        let project_uuid = arguments
            .get("project_uuid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let rel = arguments
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();

        let resolved = match resolve_workdir_file(&self.pool, project_uuid, rel).await {
            Ok(v) => v,
            Err(err) => return Ok(err),
        };

        if !resolved.file_path.exists() {
            return Ok(json!({
                "ok": false,
                "error": format!("Chemin introuvable : {}", if rel.is_empty() { resolved.workdir.clone() } else { rel.to_string() })
            }));
        }

        let mut files = Vec::new();
        collect_files(&resolved.file_path, &resolved.file_path, &mut files);
        let truncated = files.len() > MAX_LIST_FILES;
        files.truncate(MAX_LIST_FILES);

        Ok(json!({
            "ok": true,
            "workdir": resolved.workdir,
            "path": rel,
            "count": files.len(),
            "truncated": truncated,
            "files": files
        }))
    }
}

struct ResolvedWorkdirFile {
    workdir: String,
    file_path: PathBuf,
}

async fn resolve_workdir_file(
    pool: &PgPool,
    project_uuid: &str,
    rel: &str,
) -> std::result::Result<ResolvedWorkdirFile, Value> {
    if project_uuid.is_empty() {
        return Err(json!({
            "ok": false,
            "error": "project_uuid requis"
        }));
    }
    if rel.contains("..") || rel.starts_with('/') {
        return Err(json!({
            "ok": false,
            "error": "Chemin invalide : pas de '..' ni chemins absolus"
        }));
    }

    let project: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT uuid, workdir FROM projects WHERE uuid = $1")
            .bind(project_uuid)
            .fetch_optional(pool)
            .await
            .map_err(|e| json!({"ok": false, "error": e.to_string()}))?;

    let Some((uuid, workdir_opt)) = project else {
        return Err(json!({
            "ok": false,
            "error": format!("Projet introuvable : {project_uuid}")
        }));
    };

    let workdir_raw = workdir_opt.as_deref().unwrap_or("").trim();
    if workdir_raw.is_empty() {
        return Err(json!({
            "ok": false,
            "error": "Le projet n'a pas de workdir configuré."
        }));
    }

    let workdir = devforge_deploy::resolve_project_workdir(workdir_raw, &uuid);
    let file_path = if rel.is_empty() {
        PathBuf::from(&workdir)
    } else {
        Path::new(&workdir).join(rel)
    };

    Ok(ResolvedWorkdirFile { workdir, file_path })
}

fn collect_files(root: &Path, current: &Path, out: &mut Vec<String>) {
    if out.len() >= MAX_LIST_FILES {
        return;
    }
    let Ok(entries) = std::fs::read_dir(current) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        if out.len() >= MAX_LIST_FILES {
            break;
        }
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if SKIP_DIR_NAMES.contains(&name_str.as_ref()) || name_str.starts_with('.') {
            continue;
        }
        let path = entry.path();
        if path.is_dir() {
            collect_files(root, &path, out);
        } else if path.is_file() {
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            out.push(rel);
        }
    }
}

/// Diff ligne-à-ligne simple (LCS) pour l’UI chat — style Cursor.
pub(crate) fn line_diff_stats(path: &str, old: &str, new: &str) -> (usize, usize, String) {
    let a: Vec<&str> = if old.is_empty() {
        Vec::new()
    } else {
        old.lines().collect()
    };
    let b: Vec<&str> = new.lines().collect();
    if a.is_empty() && b.is_empty() {
        return (0, 0, String::new());
    }
    // Garde-fou perf : gros fichiers → aperçu +/− sans LCS complet
    if a.len() > 1500 || b.len() > 1500 {
        let mut out = format!("--- a/{path}\n+++ b/{path}\n");
        let show_old = a.len().min(80);
        let show_new = b.len().min(120);
        for line in a.iter().take(show_old) {
            out.push('-');
            out.push_str(line);
            out.push('\n');
        }
        if a.len() > show_old {
            out.push_str(&format!("… {} lignes retirées non affichées\n", a.len() - show_old));
        }
        for line in b.iter().take(show_new) {
            out.push('+');
            out.push_str(line);
            out.push('\n');
        }
        if b.len() > show_new {
            out.push_str(&format!("… {} lignes ajoutées non affichées\n", b.len() - show_new));
        }
        return (b.len(), a.len(), out);
    }
    if a.is_empty() {
        let mut out = format!("--- /dev/null\n+++ b/{path}\n");
        for line in &b {
            out.push('+');
            out.push_str(line);
            out.push('\n');
        }
        return (b.len(), 0, out);
    }
    if a == b {
        return (0, 0, String::new());
    }

    let n = a.len();
    let m = b.len();
    let mut dp = vec![vec![0usize; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            dp[i][j] = if a[i] == b[j] {
                dp[i + 1][j + 1] + 1
            } else {
                dp[i + 1][j].max(dp[i][j + 1])
            };
        }
    }

    let mut additions = 0usize;
    let mut deletions = 0usize;
    let mut body = String::new();
    let mut i = 0usize;
    let mut j = 0usize;
    while i < n || j < m {
        if i < n && j < m && a[i] == b[j] {
            body.push(' ');
            body.push_str(a[i]);
            body.push('\n');
            i += 1;
            j += 1;
        } else if j < m && (i == n || dp[i][j + 1] >= dp[i + 1][j]) {
            body.push('+');
            body.push_str(b[j]);
            body.push('\n');
            additions += 1;
            j += 1;
        } else if i < n {
            body.push('-');
            body.push_str(a[i]);
            body.push('\n');
            deletions += 1;
            i += 1;
        }
    }

    let patch = format!("--- a/{path}\n+++ b/{path}\n@@\n{body}");
    (additions, deletions, patch)
}
