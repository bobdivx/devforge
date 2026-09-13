//! Parse deploy failure logs and generate human-readable French error summaries.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeployError {
    pub summary: String,
    pub hint: Option<String>,
}

/// Parse deploy logs and extract human-readable error summary + hint (FR).
pub fn parse_deploy_error_fr(logs: &str) -> Option<DeployError> {
    let logs_lower = logs.to_lowercase();

    // vite/astro/npm not found
    if logs_lower.contains("vite: not found")
        || logs_lower.contains("vite: command not found")
        || logs_lower.contains("astro: not found")
        || logs_lower.contains("astro: command not found")
    {
        return Some(DeployError {
            summary: "Commande de build introuvable (vite/astro manquant)".into(),
            hint: Some(
                "Vérifiez package.json : les dépendances 'vite' ou 'astro' sont-elles listées ? \
                 Vérifiez aussi le script 'build' dans package.json."
                    .into(),
            ),
        });
    }

    // npm ci lock mismatch
    if logs_lower.contains("npm ci")
        && logs_lower.contains("package")
        && (logs_lower.contains("sync") || logs_lower.contains("lock"))
    {
        return Some(DeployError {
            summary: "Désynchronisation entre package.json et package-lock.json".into(),
            hint: Some(
                "Exécutez 'npm install' localement pour mettre à jour package-lock.json, \
                 puis commitez le fichier."
                    .into(),
            ),
        });
    }

    // Dockerfile RUN exit code != 0
    if (logs_lower.contains("dockerfile") || logs_lower.contains("docker build"))
        && (logs_lower.contains("error") && logs_lower.contains("run")
            || logs_lower.contains("the command") && logs_lower.contains("returned a non-zero code")
            || logs_lower.contains("exited with code"))
    {
        return Some(DeployError {
            summary: "Échec d'une commande RUN dans le Dockerfile".into(),
            hint: Some(
                "Vérifiez les logs du build Docker ci-dessus pour identifier la commande \
                 qui a échoué. Testez le build localement avec 'docker build .'."
                    .into(),
            ),
        });
    }

    // OOM (out of memory)
    if logs_lower.contains("out of memory")
        || logs_lower.contains("oom")
        || logs_lower.contains("killed")
            && (logs_lower.contains("memory") || logs_lower.contains("mem"))
    {
        return Some(DeployError {
            summary: "Mémoire insuffisante pendant le build".into(),
            hint: Some(
                "Le build a été tué par manque de RAM. Options : \
                 réduire la taille du build (e.g. PUPPETEER_SKIP_DOWNLOAD=1), \
                 ou augmenter la RAM du serveur."
                    .into(),
            ),
        });
    }

    // Healthcheck timeout
    if (logs_lower.contains("healthcheck") || logs_lower.contains("health check"))
        && (logs_lower.contains("timeout")
            || logs_lower.contains("failed")
            || logs_lower.contains("unhealthy"))
    {
        return Some(DeployError {
            summary: "Healthcheck timeout : l'application ne démarre pas correctement".into(),
            hint: Some(
                "L'application build correctement mais ne répond pas sur le port attendu. \
                 Vérifiez les logs du conteneur (docker logs) pour voir pourquoi il ne démarre pas."
                    .into(),
            ),
        });
    }

    // Port binding conflict
    if logs_lower.contains("port") && logs_lower.contains("already")
        || logs_lower.contains("address already in use")
        || logs_lower.contains("bind: address already in use")
    {
        return Some(DeployError {
            summary: "Conflit de port : le port est déjà utilisé".into(),
            hint: Some(
                "Un autre conteneur ou processus utilise déjà ce port. \
                 Vérifiez avec 'docker ps' ou changez le port du projet."
                    .into(),
            ),
        });
    }

    // Generic npm/build failure
    if logs_lower.contains("npm err!")
        || logs_lower.contains("error command failed")
        || (logs_lower.contains("npm") && logs_lower.contains("exit") && logs_lower.contains("1"))
    {
        return Some(DeployError {
            summary: "Échec du build npm".into(),
            hint: Some(
                "Une erreur s'est produite pendant 'npm install' ou 'npm run build'. \
                 Consultez les logs ci-dessous pour plus de détails."
                    .into(),
            ),
        });
    }

    // Generic Docker failure
    if logs_lower.contains("docker") && logs_lower.contains("error")
        || logs_lower.contains("failed to build")
    {
        return Some(DeployError {
            summary: "Échec du build Docker".into(),
            hint: Some(
                "Le build Docker a échoué. Consultez les logs pour identifier \
                 la commande ou l'image qui pose problème."
                    .into(),
            ),
        });
    }

    // Git sync failure
    if (logs_lower.contains("git") && logs_lower.contains("error"))
        || logs_lower.contains("fatal: not a git repository")
        || logs_lower.contains("could not resolve host")
    {
        return Some(DeployError {
            summary: "Échec de synchronisation Git".into(),
            hint: Some(
                "Impossible de cloner ou mettre à jour le dépôt. \
                 Vérifiez l'URL du repo et les permissions d'accès."
                    .into(),
            ),
        });
    }

    // Generic failure (catch-all)
    if logs_lower.contains("[devforge] deploy failed") {
        return Some(DeployError {
            summary: "Échec du déploiement".into(),
            hint: Some("Consultez les logs bruts pour plus de détails.".into()),
        });
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_vite_not_found() {
        let logs = r#"
[nixpacks-docker] exit=127
sh: 1: vite: not found
[devforge] deploy FAILED
        "#;
        let err = parse_deploy_error_fr(logs).unwrap();
        assert!(err.summary.contains("vite"));
        assert!(err.hint.is_some());
    }

    #[test]
    fn parse_npm_lock_mismatch() {
        let logs = r#"
npm ERR! `npm ci` can only install packages when your package.json and package-lock.json are in sync.
npm ERR! Please update your lock file with `npm install` before continuing.
        "#;
        let err = parse_deploy_error_fr(logs).unwrap();
        assert!(err.summary.to_lowercase().contains("synchronisation"));
        assert!(err.hint.as_ref().unwrap().contains("npm install"));
    }

    #[test]
    fn parse_oom() {
        let logs = "[build] The command was killed due to out of memory";
        let err = parse_deploy_error_fr(logs).unwrap();
        assert!(err.summary.contains("Mémoire insuffisante"));
    }

    #[test]
    fn parse_healthcheck_timeout() {
        let logs = "[docker] container healthcheck failed: timeout after 30s";
        let err = parse_deploy_error_fr(logs).unwrap();
        assert!(err.summary.contains("Healthcheck timeout"));
    }

    #[test]
    fn returns_none_for_success_logs() {
        let logs = "[devforge] deploy OK\nContainer is running";
        let err = parse_deploy_error_fr(logs);
        assert!(err.is_none());
    }
}
