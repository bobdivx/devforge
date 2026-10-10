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

`server_id` choisit **un** nœud. Leader / `default` = executor local (Docker socket) ou SSH Settings. Autres ids = HTTP exec vers le worker. **Pas de réplica** : la forge ne tourne pas en double. Voir [[Cluster]].

## Logs et repair

- `GET /api/v1/deployments/{uuid}/logs`
- `POST .../request-repair` — playbook agent (corriger puis redéployer)

Statuts projet typiques : `draft` → `deploying` → `live` / `failed`.

## Branches (prod et dev)

**Paramètres → Branches** :

- **Production** : choisis la branche dans la liste GitHub (avec recherche). Une confirmation propose de redéployer tout de suite ou au prochain déploiement.
- **Dev** (désactivée par défaut) : choisis une autre branche. DevForge la déploie dans un conteneur séparé (`df-dv…`), distinct de la prod et de l’aperçu du brouillon.
  - URL : `app.zone.tld` → `dev-app.zone.tld` (un seul niveau, couvert par le certificat de la zone) ; domaine apex `example.com` → `dev.example.com`.
  - Reprend les variables d’environnement et la protection SSO de la prod. Pas de ports publiés ni de dossiers montés de la prod.
  - Redéployée à chaque push sur sa branche si l’auto-deploy du projet est actif.
  - Désactiver supprime le conteneur dev, son image et son entrée DNS. La prod n’est pas touchée.
  - Non disponible pour les projets docker compose.

Les déploiements sont étiquetés **Prod** / **Dev** dans l’historique (web et Android).

