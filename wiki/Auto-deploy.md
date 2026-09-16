# Auto-deploy

Deux filets, complémentaires.

## Webhook GitHub (temps réel)

`POST /api/v1/webhooks/github` — event `push`.

1. Vérifie HMAC si `DEVFORGE_GITHUB_WEBHOOK_SECRET` est défini
2. Matche `git_repository` + `git_branch`
3. Lance un déploiement pour chaque projet `auto_deploy=1`

### Configurer le hook (manuel)

Sur le repo GitHub : Settings → Webhooks → Add webhook

- Payload URL : `https://<instance>/api/v1/webhooks/github`
- Content type : `application/json`
- Secret : même valeur que `DEVFORGE_GITHUB_WEBHOOK_SECRET`
- Events : **Just the push event**

`DEVFORGE_ALLOW_INSECURE_WEBHOOK=1` : lab uniquement (pas de signature).

## Ensure automatique

Au démarrage, périodiquement, et à l’activation du toggle, DevForge tente `POST /repos/{owner}/{repo}/hooks` vers `{instance_url}/api/v1/webhooks/github`.

Prérequis : PAT avec `admin:repo_hook` + **URL d’instance** renseignée (Settings → Général).

## Poller

Toutes les ~90 s (`DEVFORGE_AUTO_DEPLOY_POLL_SECS`) : compare le SHA déployé vs la branche GitHub pour les projets `auto_deploy=1`. Si retard → deploy.

Le poller rattrape un webhook manqué ; le webhook reste le chemin rapide.
