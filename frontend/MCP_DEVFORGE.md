# MCP DevForge — checklist NAS

Endpoint: `POST /mcp/devforge` (Sanctum team token). Distinct from read-only `/mcp`.

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
2. MCP `tools/list` on `/mcp/devforge` → `get_application`, `get_deployment_logs`, `fix_application_host_permissions`, `update_application_git_branch`, `control_resource`.
3. MCP `get_deployment_logs` then `fix_application_host_permissions` on a test app (write ability required for mutate).
4. `control_resource` with `action=stop` must fail (v1 deploy-only).
