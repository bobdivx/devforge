# DevForge MCP

Plugin pour le serveur MCP de l’instance publique **https://web.jeser.app**.

`jeser.app` est la vitrine. L’API et le MCP sont sur `web.jeser.app`.

Endpoint : `https://web.jeser.app/api/v1/mcp`

OAuth 2.1 / PKCE, sans client secret. Le bouton Connect ouvre `/oauth/consent/` sur l’instance. Les jetons se révoquent dans Compte → Tokens. Un jeton `dfat_…` peut remplacer OAuth (`Authorization: Bearer`).

## Clients

- Cursor : `mcp.json` (et `.cursor-plugin/plugin.json`). Marketplace : importer `https://github.com/bobdivx/devforge`, plugin `devforge-mcp`.
- Grok Build : `.grok-plugin/plugin.json` + `.mcp.json`.
- Claude : `.claude-plugin/plugin.json` + `.mcp.json`.
- Registre MCP : `server.json` (`app.jeser/devforge`).

Autre instance : remplacer l’URL dans `mcp.json` / `.mcp.json`.
