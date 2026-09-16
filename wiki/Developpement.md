# Développement

Monorepo greenfield v2. Archive PHP : `bobdivx/devforge-alpha` — **extraction / réécriture** seulement, pas de copier-coller.

## Stack imposée

- Front : **Astro + Preact** (`apps/web`) — pas de React
- Server : Rust Axum (`apps/server`)
- Modules : `crates/*`

## Quick start

```bash
npm install
npm run dev
# front http://127.0.0.1:8080  ·  API http://127.0.0.1:8000
# cargo-watch relance le server (apps/server + crates)
```

Optionnel : `apps/server/.env` (voir `apps/server/.env.example`).  
`DATABASE_URL` défaut : `sqlite:devforge.db?mode=rwc` à la **racine** du monorepo.

## Tests

```bash
cargo test --workspace
npm run check:forbidden
npm run build -w apps/web
```

CI : `.github/workflows/ci.yml`. Release : push `main` / tags `v*` → images + binaires.

## Layout

```
apps/web          Astro + Preact + Tailwind 4
apps/server       HTTP /api/v1 + SSE
crates/           shared, agent, deploy, github, cluster, mcp, env, …
docs/             notes internes d’implémentation
wiki/             source du wiki GitHub
```

## Conventions

- Pas de marques plateforme héritées dans le source
- UI : toasts / LiveStatus, shell type PandaOS
- Agents dans le projet, pas une section globale
- Cluster : UX only, pas d’env de rôle
