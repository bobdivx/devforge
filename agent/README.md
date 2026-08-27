# devforge-agent

Runtime agents DevForge (Rig). Conteneur `devforge-agent` dans le compose.

- `GET /health` — 200 dès que `AGENT_LISTEN` est joignable (pas de LLM requis)
- `POST /v1/chat` `{"prompt":"...","preamble":"...","provider":"...","base_url":"...","api_key":"...","model":"...","mcp_url":"...","mcp_token":"..."}`

Env sidecar : `AGENT_LISTEN` uniquement (défaut `0.0.0.0:8090`).
Le LLM (provider, base_url, api_key, model) est envoyé par requête depuis les providers UX DevForge.
MCP HTTP : `http://api:8080/mcp/devforge` (override `mcp_url` / `AGENT_MCP_URL`, token Sanctum `mcp_token`).
Laravel parle à `AGENT_URL=http://agent:8090`. Les outils restent côté PHP (AgentToolkit / MCP server). Vide `AGENT_URL` = ancien chemin PHP.
