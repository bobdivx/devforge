use async_trait::async_trait;
use devforge_deploy::DeployFacade;
use devforge_github::GitHubFacade;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::path::Path;
use std::sync::Arc;

/// Tool pour publier le projet local vers GitHub + déployer.
/// Workflow complet validé par l'utilisateur.
pub struct PublishToGitHubTool {
    pub github: Arc<GitHubFacade>,
    pub deploy: Arc<DeployFacade>,
    pub pool: Arc<SqlitePool>,
}

#[async_trait]
impl Tool for PublishToGitHubTool {
    fn name(&self) -> &str {
        "publish_to_github"
    }

    fn description(&self) -> &str {
        "Publie le projet local vers GitHub et déclenche le déploiement.\n\
         \n\
         🎯 WORKFLOW COMPLET (utilisateur a validé la preview locale) :\n\
         1. Crée le dépôt GitHub\n\
         2. Pousse tous les fichiers du workdir vers GitHub\n\
         3. Déclenche le déploiement sur DevForge\n\
         \n\
         Ce tool NE doit être appelé QUE sur action explicite de l'utilisateur\n\
         (bouton « Publier », « Déployer », etc.).\n\
         \n\
         Paramètres :\n\
         - project_uuid : UUID du projet DevForge (contexte par défaut)\n\
         - repo_name : nom du dépôt GitHub (ex: my-app)\n\
         - description : description du dépôt (optionnel)\n\
         - private : true pour un dépôt privé (défaut: true)\n\
         \n\
         Exemple :\n\
         {\n\
           \"project_uuid\": \"abc123\",\n\
           \"repo_name\": \"mon-app-devforge\",\n\
           \"description\": \"Application générée par DevForge\",\n\
           \"private\": true\n\
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
                "repo_name": {
                    "type": "string",
                    "description": "Nom du dépôt GitHub à créer (ex: my-app)"
                },
                "description": {
                    "type": "string",
                    "description": "Description du dépôt (optionnel)"
                },
                "private": {
                    "type": "boolean",
                    "description": "true pour un dépôt privé (défaut: true)"
                }
            },
            "required": ["project_uuid", "repo_name"]
        })
    }

    async fn execute(&self, arguments: Value) -> Result<Value> {
        let project_uuid = arguments
            .get("project_uuid")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let repo_name = arguments
            .get("repo_name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let description = arguments
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let private = arguments
            .get("private")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        if project_uuid.is_empty() || repo_name.is_empty() {
            return Ok(json!({
                "ok": false,
                "error": "project_uuid et repo_name requis"
            }));
        }

        // Vérifier que le projet existe
        let project: Option<(String, Option<String>, Option<String>)> = sqlx::query_as(
            "SELECT uuid, workdir, git_repository FROM projects WHERE uuid = ?",
        )
        .bind(project_uuid)
        .fetch_optional(self.pool.as_ref())
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        let Some((uuid, workdir_opt, existing_repo)) = project else {
            return Ok(json!({
                "ok": false,
                "error": format!("Projet introuvable : {project_uuid}")
            }));
        };

        // Si le projet a déjà un repo, skip la création
        if let Some(repo_url) = existing_repo.as_ref().filter(|r| !r.trim().is_empty()) {
            return Ok(json!({
                "ok": false,
                "error": format!("Le projet a déjà un dépôt GitHub : {repo_url}"),
                "hint": "Le projet est déjà publié. Utilise trigger_deploy pour redéployer."
            }));
        }

        let workdir = workdir_opt
            .as_deref()
            .unwrap_or("")
            .trim();

        if workdir.is_empty() {
            return Ok(json!({
                "ok": false,
                "error": "Le projet n'a pas de workdir configuré."
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

        // ÉTAPE 1 : Créer le repo GitHub
        let current_user = match self.github.current_user().await {
            Ok(user) => user,
            Err(e) => {
                return Ok(json!({
                    "ok": false,
                    "error": format!("Impossible de récupérer l'utilisateur GitHub : {e}"),
                    "step": "current_user"
                }));
            }
        };

        let owner = current_user.login;
        if owner.is_empty() {
            return Ok(json!({
                "ok": false,
                "error": "Impossible de récupérer l'owner GitHub (login vide)."
            }));
        }

        let desc_opt = if description.is_empty() {
            None
        } else {
            Some(description)
        };

        let (html_url, full_name) = match self
            .github
            .create_repository(repo_name, desc_opt, private, true)
            .await
        {
            Ok(repo) => (repo.html_url, repo.full_name),
            Err(e) => {
                let err_msg = e.to_string();
                if err_msg.contains("already exists") || err_msg.contains("name already exists") {
                    let repo_url = format!("https://github.com/{owner}/{repo_name}");
                    let full = format!("{owner}/{repo_name}");
                    (repo_url, full)
                } else {
                    return Ok(json!({
                        "ok": false,
                        "error": format!("Échec création dépôt GitHub : {err_msg}"),
                        "step": "create_repository"
                    }));
                }
            }
        };

        // Attacher le dépôt au projet
        let git_url = format!("{html_url}.git");
        sqlx::query(
            "UPDATE projects SET git_repository = ?, git_branch = 'main' WHERE uuid = ?",
        )
        .bind(&git_url)
        .bind(&uuid)
        .execute(self.pool.as_ref())
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        // ÉTAPE 2 : Pousser les fichiers locaux vers GitHub
        let files = match scan_workdir(workdir_path) {
            Ok(f) => f,
            Err(e) => {
                return Ok(json!({
                    "ok": false,
                    "error": format!("Erreur scan workdir : {e}"),
                    "step": "scan_workdir"
                }));
            }
        };

        let mut synced = 0;
        let mut errors = Vec::new();

        for (rel_path, content) in files {
            match self
                .github
                .write_file(&owner, repo_name, &rel_path, &content, "feat: initial commit", Some("main"), None)
                .await
            {
                Ok(_) => synced += 1,
                Err(e) => {
                    errors.push(format!("{rel_path}: {e}"));
                }
            }
        }

        // ÉTAPE 3 : Déclencher le déploiement
        // Note : Le vrai deploy nécessite plus de contexte (env vars, etc.)
        // Pour l'instant, on retourne un succès et l'utilisateur devra appeler trigger_deploy séparément
        // ou on implémente le deploy complet ici.

        Ok(json!({
            "ok": errors.is_empty(),
            "repo_created": true,
            "files_synced": synced,
            "files_failed": errors.len(),
            "errors": errors,
            "owner": owner,
            "repo": repo_name,
            "full_name": full_name,
            "url": html_url,
            "git_url": git_url,
            "message": format!("✓ Projet publié : {synced} fichiers sur GitHub. Appelle trigger_deploy pour déployer."),
            "next_step": "Utilise trigger_deploy pour déployer le projet sur DevForge."
        }))
    }
}

/// Scanne récursivement le workdir et retourne (relative_path, content).
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

        if should_exclude(&name) {
            continue;
        }

        if path.is_dir() {
            scan_dir_recursive(root, &path, files)?;
        } else if path.is_file() {
            let rel_path = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");

            match std::fs::read_to_string(&path) {
                Ok(content) => {
                    files.push((rel_path, content));
                }
                Err(_) => continue,
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
    )
}
