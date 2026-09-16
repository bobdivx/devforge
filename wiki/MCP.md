# MCP

DevForge est **serveur MCP** (ses tools agent) et **client MCP** (serveurs distants pour les agents).

## Serveur (tools DevForge)

`GET /api/v1/mcp/tools` — schéma MCP des tools locaux.  
JSON-RPC : `POST /api/v1/mcp`.

Les agents DevForge consomment déjà ce registry en interne.

## Client (serveurs distants)

Page **MCP** (`/app/mcp`) :

- Catalogue (Turso, Slack, GitHub, …)
- `GET/POST /api/v1/mcp/servers`
- Tools distants : `GET /api/v1/mcp/servers/{id}/tools`
- OAuth : start / callback / disconnect + `client-metadata.json`

Outils agent : `mcp_list_servers`, `mcp_list_remote_tools`, `mcp_call_tool`.

Sans MCP GitHub, `create_github_repo` échoue avec un hint vers Settings → MCP.

## OAuth MCP

Redirect : `/api/v1/mcp/oauth/callback`. Configure l’URL d’instance avant de lancer un flow.
