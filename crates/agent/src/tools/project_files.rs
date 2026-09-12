use async_trait::async_trait;
use devforge_github::GitHubFacade;
use devforge_mcp::McpFacade;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::sync::Arc;

/// Tool pour écrire des fichiers dans le workdir du projet (local) ou sur GitHub.
pub struct WriteProjectFileTool {
    pub github: Arc<GitHubFacade>,
    pub mcp: Arc<McpFacade>,
    pub pool: Arc<SqlitePool>,
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
        let workdir = workdir_opt
            .as_deref()
            .unwrap_or("")
            .trim();

        if workdir.is_empty() {
            return Ok(json!({
                "ok": false,
                "error": "Le projet n'a pas de workdir configuré.",
                "hint": "Configure le workdir du projet ou utilise mode='github' pour écrire via Git."
            }));
        }

        // Résoudre le workdir (comme dans devforge_deploy::resolve_project_workdir)
        let workdir = devforge_deploy::resolve_project_workdir(workdir, project_uuid);
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

        // Écrire le fichier
        std::fs::write(&file_path, content).map_err(|e| {
            devforge_shared::DevForgeError::Message(format!(
                "Impossible d'écrire le fichier {} : {e}",
                file_path.display()
            ))
        })?;

        Ok(json!({
            "ok": true,
            "mode": "local",
            "path": path,
            "workdir": workdir,
            "full_path": file_path.display().to_string(),
            "bytes": content.len(),
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
            Ok(file_data) => Ok(json!({
                "ok": true,
                "mode": "github",
                "path": path,
                "owner": owner,
                "repo": repo,
                "branch": branch,
                "commit_message": message,
                "result": file_data,
                "message": format!("✓ Fichier écrit sur GitHub : {owner}/{repo}/{path}")
            })),
            Err(e) => Ok(json!({
                "ok": false,
                "error": format!("Échec écriture GitHub : {e}"),
                "step": "create_or_update_file"
            })),
        }
    }
}
