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
├── README.md, LICENSE, SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md
├── CLAUDE.md, AGENTS.md  # entrypoints AI
└── …
```

### Doit rester à la racine

- `backend/`, `frontend/`, `docs/`, `docker/`, `scripts/`, `.github/`
- `package.json` / `package-lock.json` (workspaces)
- `docker-compose*.yml`
- Docs GitHub / AI : `README.md`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CLAUDE.md`, `AGENTS.md`

### Ne pas remettre à la racine

- Sources Laravel → `backend/`
- UI Astro → `frontend/`
- Artefacts build → `backend/public/…` (gitignore `dist/`, `public/`)
- Changelog / backlog / nightly compose → `docs/`

## Runtime

Dans le conteneur, Laravel reste `/var/www/html` via le mount `./backend`.

- URL produit / build : `/devforge` → `backend/public/devforge`
- API / namespaces PHP : `/api/devforge/v1`, `App\…\DevForge` (inchangés)

## Commandes

```bash
# UI
npm run test:frontend
npm run build:frontend
cd frontend && npm run dev

# Assets Laravel (Vite)
npm run dev:laravel
npm run build:laravel

# Laravel (host)
cd backend && composer install
cd backend && php artisan …

# Laravel (Docker)
docker compose -f docker-compose.dev.yml up -d
docker exec coolify php artisan test --compact
```

## Packaging DevForge

Les manifests (`scripts/devforge-package.paths`, …) listent des chemins **déploiement**
(`app/`, `routes/`, `public/devforge`) — pas `backend/…`.
Le resolver mappe vers `backend/` dans le monorepo ; le tar de rollout
restitue le layout conteneur `/var/www/html`.
