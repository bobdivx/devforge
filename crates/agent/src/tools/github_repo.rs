use async_trait::async_trait;
use devforge_github::GitHubFacade;
use devforge_mcp::McpFacade;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::sync::Arc;

/// Tool pour créer un dépôt GitHub et l'attacher au projet DevForge.
pub struct CreateGitHubRepoTool {
    pub github: Arc<GitHubFacade>,
    pub mcp: Arc<McpFacade>,
    pub pool: Arc<PgPool>,
}

#[async_trait]
impl Tool for CreateGitHubRepoTool {
    fn name(&self) -> &str {
        "create_github_repo"
    }

    fn description(&self) -> &str {
        "Crée un nouveau dépôt GitHub (ou utilise un existant) et l'attache au projet DevForge.\n\
         \n\
         Paramètres :\n\
         - project_uuid : UUID du projet DevForge (contexte par défaut)\n\
         - repo_name : nom du dépôt GitHub (ex: my-app)\n\
         - description : description du dépôt (optionnel)\n\
         - private : true pour un dépôt privé, false pour public (défaut: true)\n\
         - auto_init : true pour initialiser avec README (défaut: true)\n\
         \n\
         Workflow :\n\
         1. Vérifie que GitHub est configuré (token HTTP PAT ou MCP)\n\
         2. Récupère le user GitHub courant (owner)\n\
         3. Crée le dépôt via GitHub API HTTP (ou MCP en fallback)\n\
         4. Attache le dépôt au projet DevForge (git_repository, git_branch=main)\n\
         5. Retourne owner, repo, url\n\
         \n\
         NOTE : Fonctionne avec le token GitHub instance configuré dans Settings.\n\
         Le MCP GitHub n'est plus requis.\n\
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
                },
                "auto_init": {
                    "type": "boolean",
                    "description": "true pour initialiser avec README (défaut: true)"
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
        let auto_init = arguments
            .get("auto_init")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);

        // Note : project_uuid est automatiquement injecté par inject_tool_defaults
        // depuis le contexte d'agent. Même si le LLM hallucine ou omet cette valeur,
        // elle sera forcée au bon UUID avant d'arriver ici (issue #1 corrigée).
        if project_uuid.is_empty() || repo_name.is_empty() {
            return Ok(json!({
                "ok": false,
                "error": "project_uuid et repo_name requis. Le project_uuid aurait dû être injecté automatiquement depuis le contexte."
            }));
        }

        // Vérifier que le projet existe
        let project: Option<(String, Option<String>)> = sqlx::query_as(
            "SELECT uuid, git_repository FROM projects WHERE uuid = $1",
        )
        .bind(project_uuid)
        .fetch_optional(self.pool.as_ref())
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        let Some((uuid, existing_repo)) = project else {
            return Ok(json!({
                "ok": false,
                "error": format!("Projet introuvable : {project_uuid}")
            }));
        };

        // Si le projet a déjà un repo, vérifier s'il existe
        if let Some(repo_url) = existing_repo.as_ref().filter(|r| !r.trim().is_empty()) {
            return Ok(json!({
                "ok": false,
                "error": format!("Le projet a déjà un dépôt GitHub : {repo_url}"),
                "hint": "Utilise write_project_file pour écrire des fichiers dans le dépôt existant."
            }));
        }

        // Essayer d'abord avec GitHubFacade (HTTP PAT)
        let github_mode = self.github.mode();
        let (owner, html_url, full_name) = if github_mode == "http" {
            // Récupérer le user courant
            let current_user = match self.github.current_user().await {
                Ok(user) => user,
                Err(e) => {
                    return Ok(json!({
                        "ok": false,
                        "error": format!("Impossible de récupérer l'utilisateur GitHub courant : {e}"),
                        "hint": "Vérifie que le token GitHub est configuré dans Settings."
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

            // Créer le repo via HTTP
            let desc_opt = if description.is_empty() {
                None
            } else {
                Some(description)
            };

            match self
                .github
                .create_repository(repo_name, desc_opt, private, auto_init)
                .await
            {
                Ok(repo) => (owner, repo.html_url, repo.full_name),
                Err(e) => {
                    let err_msg = e.to_string();
                    // Si le repo existe déjà, construire son URL
                    if err_msg.contains("already exists")
                        || err_msg.contains("name already exists")
                        || err_msg.contains("422")
                    {
                        let repo_url = format!("https://github.com/{owner}/{repo_name}");
                        let full = format!("{owner}/{repo_name}");
                        (owner, repo_url, full)
                    } else {
                        return Ok(json!({
                            "ok": false,
                            "error": format!("Échec création dépôt GitHub : {err_msg}"),
                            "step": "create_repository"
                        }));
                    }
                }
            }
        } else {
            // Fallback MCP si GitHub HTTP n'est pas configuré
            let servers = self.mcp.clients.list().await;
            let github_server = servers.iter().find(|s| {
                s.id.to_lowercase().contains("github") || s.name.to_lowercase().contains("github")
            });

            let Some(server) = github_server else {
                return Err(devforge_shared::DevForgeError::missing_github());
            };

            let server_id = &server.id;

            // Récupérer le user via MCP
            let current_user_result = self
                .mcp
                .clients
                .call_remote_tool(server_id, "get_me", json!({}))
                .await;

            let owner = match current_user_result {
                Ok(user_data) => user_data
                    .get("login")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_string(),
                Err(e) => {
                    let err_str = e.to_string();
                    if err_str.contains("auth") || err_str.contains("401") || err_str.contains("403") {
                        return Err(devforge_shared::DevForgeError::mcp_auth_failed("Github", &err_str));
                    }
                    return Ok(json!({
                        "ok": false,
                        "error": format!("Impossible de récupérer l'utilisateur GitHub courant : {err_str}"),
                        "hint": "Vérifie que le token GitHub MCP est valide."
                    }));
                }
            };

            if owner.is_empty() {
                return Ok(json!({
                    "ok": false,
                    "error": "Impossible de récupérer l'owner GitHub (login vide)."
                }));
            }

            // Créer le repo via MCP
            let mut create_args = json!({
                "name": repo_name,
                "private": private,
                "auto_init": auto_init
            });

            if !description.is_empty() {
                create_args["description"] = json!(description);
            }

            let create_result = self
                .mcp
                .clients
                .call_remote_tool(server_id, "create_repository", create_args)
                .await;

            match create_result {
                Ok(repo_data) => {
                    let url = repo_data
                        .get("html_url")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let full = repo_data
                        .get("full_name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    (owner, url, full)
                }
                Err(e) => {
                    let err_msg = e.to_string();
                    // Si le repo existe déjà, récupérer son URL
                    if err_msg.contains("already exists")
                        || err_msg.contains("name already exists")
                        || err_msg.contains("422")
                    {
                        let repo_url = format!("https://github.com/{owner}/{repo_name}");
                        let full_name = format!("{owner}/{repo_name}");
                        (owner, repo_url, full_name)
                    } else {
                        return Ok(json!({
                            "ok": false,
                            "error": format!("Échec création dépôt GitHub : {err_msg}"),
                            "step": "create_repository"
                        }));
                    }
                }
            }
        };

        if html_url.is_empty() {
            return Ok(json!({
                "ok": false,
                "error": "URL du dépôt GitHub vide après création."
            }));
        }

        // Attacher le dépôt au projet DevForge
        let git_url = format!("{html_url}.git");
        sqlx::query(
            "UPDATE projects SET git_repository = $1, git_branch = 'main' WHERE uuid = $2",
        )
        .bind(&git_url)
        .bind(&uuid)
        .execute(self.pool.as_ref())
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        Ok(json!({
            "ok": true,
            "owner": owner,
            "repo": repo_name,
            "full_name": full_name,
            "url": html_url,
            "git_url": git_url,
            "private": private,
            "message": format!("✓ Dépôt {full_name} créé et attaché au projet DevForge")
        }))
    }
}
