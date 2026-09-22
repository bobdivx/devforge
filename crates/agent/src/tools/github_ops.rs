use async_trait::async_trait;
use devforge_mcp::McpFacade;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use std::sync::Arc;

/// High-level tool pour créer une correction (branche + fichiers modifiés + PR).
pub struct CreateGitHubFixTool {
    pub mcp: Arc<McpFacade>,
}

#[async_trait]
impl Tool for CreateGitHubFixTool {
    fn name(&self) -> &str {
        "create_github_fix"
    }
    fn description(&self) -> &str {
        "Crée une branche de correction, applique des fichiers, et ouvre une PR GitHub.\n\
         ⚠️ UNIQUEMENT après validation explicite de l'utilisateur (après preview locale).\n\
         Pour le travail courant : write_project_file mode=local + start_local_preview.\n\
         Ne pas appeler sur « go » / « oui » / « améliore le site » — ce n'est PAS une validation PR.\n\
         \n\
         Paramètres :\n\
         - owner, repo : dépôt GitHub cible\n\
         - base_branch : branche de base (défaut: main)\n\
         - fix_branch : nom de la branche de correction (ex: fix/package-json-deps)\n\
         - files : array d'objets {path: string, content: string} — fichiers à créer/modifier\n\
         - commit_message : message de commit\n\
         - pr_title : titre de la PR\n\
         - pr_body : description de la PR (problème + solution)\n\
         \n\
         Exemple d'utilisation pour corriger package.json :\n\
         {\n\
           \"owner\": \"bobdivx\",\n\
           \"repo\": \"popcorn-web\",\n\
           \"fix_branch\": \"fix/astro-tailwind-dependency\",\n\
           \"files\": [{\"path\": \"package.json\", \"content\": \"...\"}],\n\
           \"commit_message\": \"fix: remplacer astro par @astrojs/tailwind\",\n\
           \"pr_title\": \"Fix: Corriger la dépendance Tailwind pour Astro\",\n\
           \"pr_body\": \"Le build échouait car `astro` n'est pas le bon package...\\n\\nCorrection: `@astrojs/tailwind`\"\n\
         }"
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "owner": {"type": "string", "description": "Owner du dépôt GitHub"},
                "repo": {"type": "string", "description": "Nom du dépôt GitHub"},
                "base_branch": {"type": "string", "description": "Branche de base (défaut: main)"},
                "fix_branch": {"type": "string", "description": "Nom de la branche de correction"},
                "files": {
                    "type": "array",
                    "description": "Fichiers à créer/modifier",
                    "items": {
                        "type": "object",
                        "properties": {
                            "path": {"type": "string"},
                            "content": {"type": "string"}
                        },
                        "required": ["path", "content"]
                    }
                },
                "commit_message": {"type": "string", "description": "Message de commit"},
                "pr_title": {"type": "string", "description": "Titre de la PR"},
                "pr_body": {"type": "string", "description": "Description de la PR"}
            },
            "required": ["owner", "repo", "fix_branch", "files", "commit_message", "pr_title", "pr_body"]
        })
    }

    async fn execute(&self, arguments: Value) -> Result<Value> {
        let owner = arguments
            .get("owner")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let repo = arguments
            .get("repo")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let base_branch = arguments
            .get("base_branch")
            .and_then(|v| v.as_str())
            .unwrap_or("main")
            .trim();
        let fix_branch = arguments
            .get("fix_branch")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let commit_message = arguments
            .get("commit_message")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let pr_title = arguments
            .get("pr_title")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let pr_body = arguments
            .get("pr_body")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let files = arguments.get("files").and_then(|v| v.as_array());

        if owner.is_empty()
            || repo.is_empty()
            || fix_branch.is_empty()
            || commit_message.is_empty()
            || pr_title.is_empty()
            || pr_body.is_empty()
        {
            return Ok(json!({
                "ok": false,
                "error": "owner, repo, fix_branch, commit_message, pr_title, pr_body requis"
            }));
        }

        let Some(files_arr) = files else {
            return Ok(json!({"ok": false, "error": "files requis (array)"}));
        };

        if files_arr.is_empty() {
            return Ok(json!({
                "ok": false,
                "error": "Au moins un fichier requis dans files"
            }));
        }

        // Vérifier que le serveur MCP GitHub est disponible
        let servers = self.mcp.clients.list().await;
        let github_server = servers
            .iter()
            .find(|s| s.id.to_lowercase().contains("github") || s.name.to_lowercase().contains("github"));

        let Some(server) = github_server else {
            return Ok(json!({
                "ok": false,
                "error": "Serveur MCP GitHub non configuré. Demande à l'utilisateur de configurer le MCP GitHub dans Settings → MCP.",
                "hint": "L'agent ne peut pas créer de PR sans accès GitHub via MCP."
            }));
        };

        let server_id = &server.id;

        // Étape 1 : Créer la branche
        let create_branch_result = self
            .mcp
            .clients
            .call_remote_tool(
                server_id,
                "create_branch",
                json!({
                    "owner": owner,
                    "repo": repo,
                    "branch": fix_branch,
                    "from_branch": base_branch
                }),
            )
            .await;

        if let Err(e) = create_branch_result {
            return Ok(json!({
                "ok": false,
                "error": format!("Échec création branche : {e}"),
                "step": "create_branch"
            }));
        }

        // Étape 2 : Modifier les fichiers
        let mut file_results = Vec::new();
        for file_obj in files_arr {
            let path = file_obj
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let content = file_obj
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();

            if path.is_empty() || content.is_empty() {
                file_results.push(json!({
                    "path": path,
                    "ok": false,
                    "error": "path et content requis"
                }));
                continue;
            }

            let update_result = self
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
                        "message": commit_message,
                        "branch": fix_branch
                    }),
                )
                .await;

            let (additions, deletions, unified_diff) =
                super::project_files::line_diff_stats(path, "", content);
            match update_result {
                Ok(res) => file_results.push(json!({
                    "path": path,
                    "ok": true,
                    "result": res,
                    "additions": additions,
                    "deletions": deletions,
                    "unified_diff": unified_diff
                })),
                Err(e) => file_results.push(json!({
                    "path": path,
                    "ok": false,
                    "error": e.to_string(),
                    "additions": additions,
                    "deletions": deletions,
                    "unified_diff": unified_diff
                })),
            }
        }

        let all_files_ok = file_results
            .iter()
            .all(|r| r.get("ok").and_then(|v| v.as_bool()).unwrap_or(false));

        let combined_diff = combined_file_diffs(&file_results);
        if !all_files_ok {
            return Ok(json!({
                "ok": false,
                "error": "Certains fichiers n'ont pas pu être modifiés",
                "step": "update_files",
                "files": file_results,
                "unified_diff": combined_diff
            }));
        }

        // Étape 3 : Créer la PR
        let create_pr_result = self
            .mcp
            .clients
            .call_remote_tool(
                server_id,
                "create_pull_request",
                json!({
                    "owner": owner,
                    "repo": repo,
                    "title": pr_title,
                    "body": pr_body,
                    "head": fix_branch,
                    "base": base_branch
                }),
            )
            .await;

        match create_pr_result {
            Ok(pr_data) => Ok(json!({
                "ok": true,
                "branch": fix_branch,
                "files": file_results,
                "unified_diff": combined_diff,
                "pull_request": pr_data,
                "message": format!("✓ Branche {fix_branch} créée, {} fichier(s) modifié(s), PR ouverte", files_arr.len())
            })),
            Err(e) => Ok(json!({
                "ok": false,
                "error": format!("Échec création PR : {e}"),
                "step": "create_pull_request",
                "branch": fix_branch,
                "files": file_results,
                "unified_diff": combined_diff
            })),
        }
    }
}

fn combined_file_diffs(files: &[Value]) -> String {
    files
        .iter()
        .filter_map(|f| f.get("unified_diff").and_then(|v| v.as_str()))
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// Tool pour lire le contenu d'un fichier sur GitHub (simplifie l'accès via MCP).
pub struct ReadGitHubFileTool {
    pub mcp: Arc<McpFacade>,
}

#[async_trait]
impl Tool for ReadGitHubFileTool {
    fn name(&self) -> &str {
        "read_github_file"
    }
    fn description(&self) -> &str {
        "Lit le contenu d'un fichier sur GitHub via MCP. \
         Paramètres : owner, repo, path, ref (optionnel, défaut: HEAD)."
    }
    fn parameters(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "owner": {"type": "string"},
                "repo": {"type": "string"},
                "path": {"type": "string", "description": "Chemin du fichier (ex: package.json)"},
                "ref": {"type": "string", "description": "Branche/tag/SHA (défaut: HEAD)"}
            },
            "required": ["owner", "repo", "path"]
        })
    }

    async fn execute(&self, arguments: Value) -> Result<Value> {
        let owner = arguments
            .get("owner")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let repo = arguments
            .get("repo")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let path = arguments
            .get("path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        let ref_opt = arguments.get("ref").and_then(|v| v.as_str());

        if owner.is_empty() || repo.is_empty() || path.is_empty() {
            return Ok(json!({
                "ok": false,
                "error": "owner, repo, path requis"
            }));
        }

        let servers = self.mcp.clients.list().await;
        let github_server = servers
            .iter()
            .find(|s| s.id.to_lowercase().contains("github") || s.name.to_lowercase().contains("github"));

        let Some(server) = github_server else {
            return Ok(json!({
                "ok": false,
                "error": "Serveur MCP GitHub non configuré"
            }));
        };

        let mut args = json!({"owner": owner, "repo": repo, "path": path});
        if let Some(r) = ref_opt {
            args["ref"] = json!(r);
        }

        match self
            .mcp
            .clients
            .call_remote_tool(&server.id, "get_file_contents", args)
            .await
        {
            Ok(result) => Ok(json!({"ok": true, "file": result})),
            Err(e) => Ok(json!({"ok": false, "error": e.to_string()})),
        }
    }
}
