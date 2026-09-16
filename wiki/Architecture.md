# Architecture

## Principes

1. Le **server** Axum expose `/api/v1` — le front ne parle qu’à ça
2. **Cargo workspace** : crates séparables derrière traits
3. Registry d’**outils** agent petits et testables
4. CI `check-forbidden-names` : pas de marques plateforme héritées

## Stack

```
apps/web      Astro + Preact + Tailwind 4
apps/server   Axum + Tokio + SQLx (SQLite)
crates/*      agent, deploy, github, env, mcp, cluster, …
```

DB défaut : `sqlite:devforge.db?mode=rwc`. Turso/libSQL = option HA plus tard (même SQL).

## Runtime agent

```
UI → POST /api/v1/agent/chat
  → AgentRunner
  → ToolRegistry
  → crates/deploy | github | env | mcp | …
  → JSON ou SSE
```

## Cluster

Leader SQLite + workers HTTP exec. `node.id` = `server_id`. Détail : [[Cluster]].

## Crates (état)

| Crate | Rôle |
|-------|------|
| `shared` | Erreurs, Tool, DTOs |
| `agent` | Runner + tools |
| `deploy` | Git, nixpacks/Docker, executor local/SSH |
| `env` | Env projet |
| `ports` | Mapping ports |
| `domain` | FQDN + certbot |
| `proxy` | Labels Traefik |
| `wireguard` | `wg-quick` (hors cluster v1) |
| `auth` | Users, sessions |
| `storage` / `backup` | S3 + jobs |
| `detect` | Frameworks |
| `llm` | Providers OpenAI-compat |
| `update` | Self-update |
| `mcp` | Serveur + client |
| `cluster` | Nœuds, invites, exec HTTP |
| `database` | Provision Postgres — **non implémenté** (erreur explicite) |
| `runner` | GitHub runners |
| `cron` | Crons projet |

Health : `GET /api/v1/health` → `backends.{executor,github,storage,database,llm,update,cluster}` + `version`.

## Contrats tests projet

`workdir` + `test_command` + `server_id`. `run_application_tests` ne scanne pas le disque au hasard.
