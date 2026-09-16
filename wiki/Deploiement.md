# Déploiement

Pipeline réel : git → build → `docker run` + labels Traefik + env projet.

Déclenché par :

- bouton Deploy / `POST /api/v1/projects/{uuid}/deployments`
- outil agent `trigger_deploy` (même logique)
- webhook GitHub + poller si `auto_deploy` — [[Auto-deploy]]

## Étapes

1. `git clone` / fetch + checkout (token instance injecté si repo privé)
2. Build selon `build_pack` :
   - **nixpacks** (défaut) — image `ghcr.io/railwayapp/nixpacks` (override `DEVFORGE_NIXPACKS_IMAGE`). Sur ZimaOS / conteneur DevForge : `--volumes-from` pour `/data`. Fallback : Dockerfile projet, sinon Node inline
   - **dockerfile** / **dockercompose** / **static**
3. `docker run` : port projet, `.env` exporté, labels Traefik, réseau `DEVFORGE_DOCKER_NETWORK`

Workdir Windows / data : `DEVFORGE_DATA_DIR` (défaut `data/applications/{uuid}`).

## Env de build

Transmis (filtre) : `PUPPETEER_*`, `NODE_*`, `NPM_*`, `YARN_*`, `PNPM_*`, `CI`, `NODE_OPTIONS`.  
`PUPPETEER_SKIP_DOWNLOAD=1` est injecté pour éviter l’échec Chrome pendant `npm ci`.

Chrome **runtime** (Puppeteer / Playwright) : fournis un `Dockerfile` ou `nixpacks.toml`. Ce n’est pas un plugin DevForge.

## Nœud

`server_id` choisit le worker. Leader / `default` = executor local (Docker socket) ou SSH Settings. Autres ids = HTTP exec vers le worker. Voir [[Cluster]].

## Logs et repair

- `GET /api/v1/deployments/{uuid}/logs`
- `POST .../request-repair` — playbook agent (corriger puis redéployer)

Statuts projet typiques : `draft` → `deploying` → `live` / `failed`.
