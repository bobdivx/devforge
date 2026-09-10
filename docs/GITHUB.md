# GitHub — connexion instance

## Aujourd’hui (v2)

Connexion via **Personal Access Token** (PAT) stocké dans `instance_settings.github_token`.

1. Admin → **Settings** → coller un token (`ghp_…` ou fine-grained)
2. Le server vérifie `GET /user`, hot-reload le client HTTP (sans restart)
3. **Projects** → importer un repo + branche

APIs :

| Route | Rôle |
|-------|------|
| `GET /api/v1/github/status` | connecté + user |
| `POST /api/v1/github/connect` | `{ "token": "…" }` (admin) |
| `DELETE /api/v1/github/connect` | déconnecter |
| `GET /api/v1/github/repos` | liste repos |
| `GET /api/v1/github/{owner}/{repo}/branches` | branches |

## Deploy

`POST /api/v1/projects/{uuid}/deployments` lance un vrai pipeline :

1. `git clone` / fetch + checkout (token instance injecté si privé)
2. Build selon `build_pack` (`nixpacks` → fallback Dockerfile, `dockerfile`, `dockercompose`, `static`)
3. `docker run` avec port projet + `.env` exporté

Logs dans le déploiement. Workdir Windows local : `DEVFORGE_DATA_DIR` (défaut `data/applications/{uuid}`).

Webhook : `POST /api/v1/webhooks/github` (event `push`, optionnel `DEVFORGE_GITHUB_WEBHOOK_SECRET`).


## Legacy (alpha)

L’ancien DevForge utilisait surtout une **GitHub App** (JWT + installation token, webhooks, `GET /installation/repositories`). Cible v2 prochaine étape — pas encore porté.
