# AGENTS

DevForge v2 greenfield — self-hosted PaaS + builder.

- Front : Astro + Preact only (`apps/web`)
- Server : Rust Axum (`apps/server`)
- Modules : `crates/*` (incl. `mcp`, `env`)
- Archive : `bobdivx/devforge-alpha` — extraction only
- Never introduce legacy platform brand names in source

## Product direction

DevForge is a **self-hosted web platform** combining:
- **PaaS** : Deploy apps, manage runners, domains, env vars, backups
- **Builder** : AI agents scaffold projects, edit code, preview changes (web-based, not Electron)

Keep PandaOS-inspired shell (home card grid, slim nav). The workspace combines chat + preview for productive agent interaction.
