# Architecture DevForge v2

## Principes

1. **Server** (`apps/server`) expose une surface HTTP versionnée `/api/v1` — le front ne parle qu’à ça.
2. **Cargo workspace** — modules séparables (`crates/*`).
3. **Registry d’outils** — petits handlers testables.
4. **Pas de marques plateforme héritées** dans le code — CI `check-forbidden-names`.

## Stack

- `apps/web` — Astro + Preact + Tailwind 4
- `apps/server` — Axum + Tokio + SQLx (**SQLite local** par défaut ; Turso/libSQL optionnel plus tard)
- Crates : `shared`, `agent`, `deploy`, `github`, `database`, `mcp`, `env`, `ports`, `domain`, `proxy`, `wireguard`, `storage`, `backup`, `cluster`

## Cluster

Un **leader** (cette instance) + des **workers**. `node.id` = `server_id` des projets.

- Page `/app/cluster` (admin) : nœuds, invitations (jeton `dfjoin_…` + URL du leader renseignée sur le worker), drain, métriques, diagnostic, réassignation d’apps, **mise à jour DevForge des workers**. SSH optionnel. Failover control plane : snapshot SQLite sur les workers (~30 s) ; si le leader tombe, élection d’un intérim jusqu’au retour.
- Rôle persisté dans SQLite (`cluster_local`) — pas de variables d’environnement pour joindre.
- Worker : heartbeat (~15 s, stale 45 s) + métriques + `POST /internal/exec`. Drain = plus de nouveaux jobs. UI worker `/app/node`.
- Turso synchrone / mesh WireGuard : plus tard (HA stricte, overlay).

## Modèle agents

Les agents **ne sont pas** une section globale. Voir [AGENTS-MODEL.md](AGENTS-MODEL.md).

- Création project → seed agents `required` (Ops, Deploy, Reviewer)
- Utilisateur peut ajouter `custom`
- Sous-agents `subagent` spawnés pour une tâche (parent requis)
- Chat toujours scoped `project_uuid`

## MCP

- **Serveur** (`crates/mcp::McpServerFacade`) : publie les tools agent en schéma MCP.
- **Client** (`McpClientRegistry`) : enregistre des MCP distants, liste/appelle leurs tools.
- Outils agent : `mcp_list_servers`, `mcp_list_remote_tools`, `mcp_call_tool`.

## Env projects

- Table `project_env_vars` + `crates/env`.
- CRUD env sous `/api/v1/projects/{uuid}/env` (routes du **server**).
- Secrets jamais renvoyés en clair aux tools agent (`********`).

## Runtime agent

```
UI → POST /api/v1/agent/chat
  → AgentRunner
  → ToolRegistry
  → crates/deploy|github|database|mcp|env
  → JSON ou SSE
```

## Contrats tests projet

Chaque projet déclare `workdir` + `test_command` + `server_id`.  
`run_application_tests` n’utilise **pas** de scan magique de chemins.
