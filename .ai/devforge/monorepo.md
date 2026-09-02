# Monorepo : `backend/` + `frontend/`

## Layout

```
/
├── backend/              # Laravel (app, artisan, composer, public, vite…)
├── frontend/             # Astro + Preact (sources UI DevForge)
├── docs/                 # CHANGELOG, TECH_STACK, backlog, other, changelogs
├── docker/               # images / s6 / nginx
├── docker-compose*.yml
├── scripts/
├── package.json          # workspaces npm (frontend) + scripts Vite Laravel
├── README.md, LICENSE
├── SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, CLAUDE.md, AGENTS.md  # stubs → docs/
├── docs/                 # docs projet (GRAFT, CLAUDE, SECURITY, …)
│   ├── CLAUDE.md, AGENTS.md, …
│   └── GRAFT_*.md
└── …
```

### Doit rester à la racine

- `backend/`, `frontend/`, `docs/`, `docker/`, `scripts/`, `.github/`
- `package.json` / `package-lock.json` (workspaces)
- `docker-compose*.yml`
- Docs GitHub / AI : stubs à la racine → contenu dans `docs/` (`SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CLAUDE.md`, `AGENTS.md`)
- Stack Demeter (Pinokio / GPU) : repo dédié [bobdivx/demeter-lab](https://github.com/bobdivx/demeter-lab) — voir `scripts/DEMETER.md`

### Ne pas remettre à la racine

- Sources Laravel → `backend/`
- UI Astro → `frontend/`
- Artefacts build → `backend/public/…` (gitignore `dist/`, `public/`)
- Changelog / backlog / nightly compose → `docs/`

## Runtime

- **Standalone (prod NAS)** : `docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d`
  - Services : `proxy`, `api`, `web`, `postgres`, `redis`, `realtime` (conteneurs `devforge-*`)
  - Déploiement : `.\scripts\nas-fix-devforge.ps1 -EnableAgents` (`DEPLOY_MODE=images`)
  - Cutover : `docs/devforge-nas-cutover.md`
- **Dev local** : `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`
- **Overlay legacy** : `DEPLOY_MODE=overlay` patch encore le conteneur `coolify`
- Dans le conteneur API, Laravel reste `/var/www/html`
- SPA prod image : base `/` ; overlay : base `/devforge`

## Commandes

```bash
# UI
npm run test:frontend
npm run build:frontend
cd frontend && npm run dev

# Stack DevForge prod
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d --build

# Stack DevForge dev
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

## Packaging DevForge

Les manifests (`scripts/devforge-package.paths`, …) listent des chemins **déploiement**
(`app/`, `routes/`, `public/devforge`) — pas `backend/…`.
Le resolver mappe vers `backend/` dans le monorepo ; le tar de rollout
restitue le layout conteneur `/var/www/html`.
