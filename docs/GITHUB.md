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
2. Build selon `build_pack` :
   - **`nixpacks`** (défaut) — builder Docker `ghcr.io/railwayapp/nixpacks` (pas de CLI host). Override : `DEVFORGE_NIXPACKS_IMAGE`. Sur ZimaOS / conteneur DevForge : `--volumes-from` pour partager `/data`. Fallback : Dockerfile projet, sinon Node inline.
   - **`dockerfile`** / **`dockercompose`** / **`static`**
3. `docker run` avec port projet + `.env` exporté

Build-time env transmis à nixpacks (filtre) : `PUPPETEER_*`, `NODE_*`, `NPM_*`, `YARN_*`, `PNPM_*`, `CI`, `NODE_OPTIONS`. `PUPPETEER_SKIP_DOWNLOAD=1` est injecté par défaut pour éviter l’échec Chrome pendant `npm ci`.

**Browser automation (Puppeteer / Playwright)** : ce n’est pas un plugin DevForge. Si l’app a besoin de Chrome au runtime, fournis un `Dockerfile` (ou `nixpacks.toml` avec les paquets apt/nix) dans le repo. Le skip download ne fait que débloquer l’install.

Logs dans le déploiement. Workdir Windows local : `DEVFORGE_DATA_DIR` (défaut `data/applications/{uuid}`).

Webhook : `POST /api/v1/webhooks/github` (event `push`, optionnel `DEVFORGE_GITHUB_WEBHOOK_SECRET`).


## Legacy (alpha)

L’ancien DevForge utilisait surtout une **GitHub App** (JWT + installation token, webhooks, `GET /installation/repositories`). Cible v2 prochaine étape — pas encore porté.
