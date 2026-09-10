# DevForge

Plateforme de déploiement moderne, avec agents IA, GitHub et GitHub Actions.

> **Greenfield v2** — monorepo Rust + Astro. Legacy archivé : [`bobdivx/devforge-alpha`](https://github.com/bobdivx/devforge-alpha).

## Structure

```
apps/
  web/          # Astro + Preact + Tailwind 4
  server/       # Axum — HTTP /api/v1 + SSE
crates/
  shared/ agent/ deploy/ github/ database/ mcp/ env/
  ports/ domain/ proxy/ wireguard/
```

## Quick start

```bash
# Server HTTP (SQLite local) — apps/server, binaire devforge-server
cargo run -p devforge-server
# → http://0.0.0.0:8000  (routes sous /api/v1)

# Frontend
cd apps/web && npm install && npm run dev
# → http://localhost:8080  (API reste :8000 ; apps déployées type Astro souvent :4321)
```

Variables :

- `DATABASE_URL` — défaut `sqlite:devforge.db?mode=rwc`
- `HOST` / `PORT` — bind du **server** (défaut `0.0.0.0:8000`)
- `PUBLIC_SERVER_URL` — base HTTP du front vers le server (défaut `http://127.0.0.1:8000/api/v1`)

## Tests

```bash
cargo test --workspace
npm run check:forbidden
npm run build -w apps/web
```

## Modules

Voir [docs/MODULES.md](docs/MODULES.md) — inventaire crates (ports, domain, proxy, wireguard, deploy, github versions, etc.).


**Global** : Accueil · Projects · Agent · Team · Settings  
**Projet** : Overview · Deployments · Domains · Env · Settings · Agent

## MCP & Env

- **MCP serveur** : `GET /api/v1/mcp/tools` — tools DevForge exposés aux clients MCP.
- **MCP client** : `GET/POST /api/v1/mcp/servers` — brancher d’autres MCP ; tools agent `mcp_*`.
- **Env apps** : `GET/POST /api/v1/projects/{uuid}/env` — secrets masqués dans les réponses agent.

## Archive alpha

Voir [docs/alpha.md](docs/alpha.md).
