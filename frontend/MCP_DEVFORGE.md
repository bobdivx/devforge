# MCP DevForge — checklist NAS

Endpoint: `POST /mcp/devforge` (Sanctum team token). Distinct from read-only `/mcp` (Coolify).

DevForge MCP **v0.2** exposes Coolify reads + AgentToolkit core/GitHub (40+ tools). Agent-only tools (missions, todos, memory, delegation) stay out of MCP.

## Activation

1. Deploy Coolify with this change set; rebuild DevForge UI if chat Actions changed.
2. Env:
   - `DEVFORGE_AGENTS_ENABLED=true`
   - `DEVFORGE_AGENTS_AUTO_FALLBACK=true`
   - `DEVFORGE_MCP_ENABLED=true`
3. Enable instance MCP (`is_mcp_server_enabled` via UI or `POST /api/v1/mcp/enable`).
4. Create a Sanctum token for the team with abilities `read` + `write`.

## Smoke

1. Chat: « corrige le déploiement maintenant » → carte Actions with real tool steps (not prose JSON).
2. MCP `tools/list` on `/mcp/devforge` → includes `get_infrastructure_overview`, `list_resources`, `get_deployment_logs`, `check_docker_image_update`, `control_resource`, `exec_command`, `list_github_apps`, …
3. MCP `get_deployment_logs` then `fix_application_host_permissions` on a test app (write ability required for mutate).
4. `control_resource` supports `start` / `stop` / `restart` / `deploy` on applications, databases, and services.
5. `check_docker_image_update` with `image=nginx:1.25` or une app `dockerimage`.
