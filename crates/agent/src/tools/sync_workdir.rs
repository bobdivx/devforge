use async_trait::async_trait;
use devforge_github::GitHubFacade;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::path::Path;
use std::sync::Arc;

/// Tool pour synchroniser récursivement le workdir local vers GitHub.
/// Alternative robuste à 20× write_project_file.
pub struct SyncWorkdirToGitHubTool {
    pub github: Arc<GitHubFacade>,
    pub pool: Arc<SqlitePool>,
}

#[async_trait]
impl Tool for SyncWorkdirToGitHubTool {
    fn name(&self) -> &str {
        "sync_workdir_to_github"
    }

    fn description(&self) -> &str {
        "Synchronise récursivement le workdir local du projet vers GitHub.\n\
         \n\
         **PRÉFÉRÉ** pour scaffold avec template déjà appliqué : pousse tous les fichiers en un seul appel.\n\
         \n\
         Paramètres :\n\
         - project_uuid : UUID du projet DevForge (contexte par défaut)\n\
         - commit_message : message de commit (défaut: 'feat: initial commit')\n\
         - branch : branche cible (défaut: main)\n\
         \n\
         Workflow :\n\
         1. Vérifie que le projet a git_repository configuré\n\
         2. Scanne récursivement le workdir local\n\
         3. Pousse chaque fichier (sauf .git, node_modules, etc.) vers GitHub\n\
         4. Retourne la liste des fichiers synchronisés\n\
         \n\
         Exclusions automatiques : .git, node_modules, .next, dist, build, target, vendor, .DS_Store\n\
         \n\
         Exemple :\n\
         {\n\
           \"project_uuid\": \"abc123\",\n\
           \"commit_message\": \"feat: initial scaffold from template\"\n\
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
                "commit_message": {
                    "type": "string",
                    "description": "Message de commit (défaut: 'feat: initial commit')"
                },
                "branch": {
                    "type": "string",
                    "description": "Branche cible (défaut: main)"
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
        let commit_message = arguments
            .get("commit_message")
            .and_then(|v| v.as_str())
            .unwrap_or("feat: initial commit");
        let branch = arguments
            .get("branch")
            .and_then(|v| v.as_str())
            .unwrap_or("main");

        if project_uuid.is_empty() {
            return Ok(json!({
                "ok": false,
                "error": "project_uuid requis (devrait être injecté automatiquement)"
            }));
        }

        // Récupérer le projet
        let project: Option<(String, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT uuid, workdir, git_repository FROM projects WHERE uuid = ?",
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

        let workdir = workdir_opt
            .as_deref()
            .unwrap_or("")
            .trim();
        let git_repo = git_repo_opt
            .as_deref()
            .unwrap_or("")
            .trim();

        if workdir.is_empty() {
            return Ok(json!({
                "ok": false,
                "error": "Le projet n'a pas de workdir configuré."
            }));
        }

        if git_repo.is_empty() {
            return Ok(json!({
                "ok": false,
                "error": "Le projet n'a pas de git_repository configuré.",
                "hint": "Utilise create_github_repo d'abord."
            }));
        }

        // Résoudre le workdir
        let workdir = devforge_deploy::resolve_project_workdir(workdir, &uuid);
        let workdir_path = Path::new(&workdir);

        if !workdir_path.exists() {
            return Ok(json!({
                "ok": false,
                "error": format!("Workdir introuvable : {workdir}")
            }));
        }

        // Vérifier GitHub mode
        if self.github.mode() != "http" {
            return Ok(json!({
                "ok": false,
                "error": "GitHub non configuré (mode http requis).",
                "hint": "Configure un token GitHub dans Settings."
            }));
        }

        // Parser owner/repo
        let (owner, repo) = match crate::parse_github_repo(git_repo) {
            Some((o, r)) => (o, r),
            None => {
                return Ok(json!({
                    "ok": false,
                    "error": format!("Impossible de parser l'URL GitHub : {git_repo}")
                }));
            }
        };

        // Scanner récursivement le workdir
        let files = match scan_workdir(workdir_path) {
            Ok(f) => f,
            Err(e) => {
                return Ok(json!({
                    "ok": false,
                    "error": format!("Erreur scan workdir : {e}")
                }));
            }
        };

        if files.is_empty() {
            return Ok(json!({
                "ok": true,
                "files_synced": 0,
                "message": "Workdir vide, rien à synchroniser."
            }));
        }

        // Pousser chaque fichier vers GitHub
        let mut synced = Vec::new();
        let mut errors = Vec::new();

        for (rel_path, content) in files {
            // Récupérer le SHA existant si le fichier existe déjà
            let existing_file = self
                .github
                .get_file(&owner, &repo, &rel_path, Some(branch))
                .await
                .ok()
                .flatten();

            let sha_opt = existing_file.as_ref().map(|f| f.sha.as_str());

            match self
                .github
                .write_file(&owner, &repo, &rel_path, &content, commit_message, Some(branch), sha_opt)
                .await
            {
                Ok(file) => {
                    synced.push(json!({
                        "path": rel_path,
                        "sha": file.sha,
                        "bytes": content.len()
                    }));
                }
                Err(e) => {
                    errors.push(json!({
                        "path": rel_path,
                        "error": e.to_string()
                    }));
                }
            }
        }

        Ok(json!({
            "ok": errors.is_empty(),
            "files_synced": synced.len(),
            "files_failed": errors.len(),
            "synced": synced,
            "errors": errors,
            "owner": owner,
            "repo": repo,
            "branch": branch,
            "message": format!("✓ Synchronisation : {}/{} fichiers pushés sur GitHub", synced.len(), synced.len() + errors.len())
        }))
    }
}

/// Scanne récursivement le workdir et retourne (relative_path, content).
/// Exclut .git, node_modules, etc.
fn scan_workdir(root: &Path) -> Result<Vec<(String, String)>> {
    let mut files = Vec::new();
    scan_dir_recursive(root, root, &mut files)?;
    Ok(files)
}

fn scan_dir_recursive(
    root: &Path,
    current: &Path,
    files: &mut Vec<(String, String)>,
) -> Result<()> {
    let entries = std::fs::read_dir(current).map_err(|e| {
        devforge_shared::DevForgeError::Message(format!(
            "Erreur lecture dir {} : {e}",
            current.display()
        ))
    })?;

    for entry in entries {
        let entry = entry.map_err(|e| {
            devforge_shared::DevForgeError::Message(format!("Erreur entry : {e}"))
        })?;
        let path = entry.path();
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();

        // Exclusions
        if should_exclude(&name) {
            continue;
        }

        if path.is_dir() {
            scan_dir_recursive(root, &path, files)?;
        } else if path.is_file() {
            // Chemin relatif depuis root
            let rel_path = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");

            // Lire le contenu
            match std::fs::read_to_string(&path) {
                Ok(content) => {
                    files.push((rel_path, content));
                }
                Err(_) => {
                    // Ignorer les fichiers binaires / non-UTF8
                    continue;
                }
            }
        }
    }

    Ok(())
}

fn should_exclude(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | "node_modules"
            | ".next"
            | "dist"
            | "build"
            | "target"
            | "vendor"
            | ".DS_Store"
            | ".env"
            | ".env.local"
            | "coverage"
            | ".nyc_output"
            | "__pycache__"
            | "*.pyc"
            | ".pytest_cache"
            | ".vscode"
            | ".idea"
    )
}
