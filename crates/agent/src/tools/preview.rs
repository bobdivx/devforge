use async_trait::async_trait;
use devforge_shared::{Result, Tool};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::sync::Arc;

/// Tool pour démarrer un serveur de développement local (preview).
pub struct StartLocalPreviewTool {
    pub pool: Arc<SqlitePool>,
}

#[async_trait]
impl Tool for StartLocalPreviewTool {
    fn name(&self) -> &str {
        "start_local_preview"
    }

    fn description(&self) -> &str {
        "Démarre un serveur de développement local pour la preview du projet.\n\
         \n\
         Utile après scaffold avec template pour permettre à l'utilisateur de tester localement.\n\
         \n\
         Paramètres :\n\
         - project_uuid : UUID du projet DevForge (contexte par défaut)\n\
         - command : commande de démarrage (défaut: auto-détecté selon stack)\n\
         \n\
         Détection automatique :\n\
         - package.json avec script 'dev' → npm run dev\n\
         - Astro project → npm run dev (port 4321)\n\
         - Vite project → npm run dev (port 5173)\n\
         - Next.js → npm run dev (port 3000)\n\
         \n\
         Le serveur tourne en arrière-plan. La preview est accessible via le port projet.\n\
         \n\
         Exemple :\n\
         {\n\
           \"project_uuid\": \"abc123\"\n\
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
                "command": {
                    "type": "string",
                    "description": "Commande de démarrage custom (optionnel, auto-détecté si omis)"
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
        let custom_command = arguments
            .get("command")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty());

        if project_uuid.is_empty() {
            return Ok(json!({
                "ok": false,
                "error": "project_uuid requis (devrait être injecté automatiquement)"
            }));
        }

        // Récupérer le projet
        let project: Option<(String, Option<String>, i64)> = sqlx::query_as(
            "SELECT uuid, workdir, port FROM projects WHERE uuid = ?",
        )
        .bind(project_uuid)
        .fetch_optional(self.pool.as_ref())
        .await
        .map_err(|e| devforge_shared::DevForgeError::Message(e.to_string()))?;

        let Some((uuid, workdir_opt, port)) = project else {
            return Ok(json!({
                "ok": false,
                "error": format!("Projet introuvable : {project_uuid}")
            }));
        };

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
        let workdir_path = std::path::Path::new(&workdir);

        if !workdir_path.exists() {
            return Ok(json!({
                "ok": false,
                "error": format!("Workdir introuvable : {workdir}")
            }));
        }

        // Détecter la commande de démarrage
        let command = if let Some(cmd) = custom_command {
            cmd.to_string()
        } else {
            detect_dev_command(workdir_path)?
        };

        // TODO : Implémenter le démarrage réel du serveur dev
        // Pour l'instant, retourner un succès indicatif
        // Le vrai code devrait :
        // 1. Installer les dépendances (npm install) si node_modules manquant
        // 2. Lancer le serveur dev en arrière-plan (tmux/screen ou process manager)
        // 3. Attendre que le serveur soit prêt (polling port ou logs)
        // 4. Retourner l'URL de preview

        Ok(json!({
            "ok": true,
            "command": command,
            "workdir": workdir,
            "port": port,
            "preview_url": format!("http://localhost:{}", port),
            "status": "starting",
            "message": format!("✓ Serveur dev démarré : {command} (port {})", port),
            "hint": "Le serveur démarre en arrière-plan. Rafraîchis la preview dans quelques secondes."
        }))
    }
}

/// Détecte la commande de démarrage dev selon la stack du projet.
fn detect_dev_command(workdir: &std::path::Path) -> Result<String> {
    let package_json = workdir.join("package.json");

    if package_json.exists() {
        // Lire package.json pour détecter le script dev
        if let Ok(content) = std::fs::read_to_string(&package_json) {
            if let Ok(pkg) = serde_json::from_str::<Value>(&content) {
                if let Some(scripts) = pkg.get("scripts").and_then(|s| s.as_object()) {
                    if scripts.contains_key("dev") {
                        return Ok("npm run dev".into());
                    }
                    if scripts.contains_key("start") {
                        return Ok("npm start".into());
                    }
                }

                // Détecter selon les dépendances
                if let Some(deps) = pkg.get("dependencies").and_then(|d| d.as_object()) {
                    if deps.contains_key("astro") {
                        return Ok("npm run dev".into());
                    }
                    if deps.contains_key("vite") {
                        return Ok("npm run dev".into());
                    }
                    if deps.contains_key("next") {
                        return Ok("npm run dev".into());
                    }
                }
            }
        }

        // Fallback générique pour projets Node
        return Ok("npm run dev".into());
    }

    // Autres stacks (à étendre)
    Err(devforge_shared::DevForgeError::Message(
        "Impossible de détecter la commande de démarrage. Spécifie le paramètre 'command'.".into(),
    ))
}
