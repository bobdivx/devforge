# DevForge auto-hébergé (plugin Cursor et Grok Bot)

Connecte ton agent au serveur MCP de ta propre instance DevForge. L’URL MCP de l’instance
(`DEVFORGE_MCP_URL`, par exemple `https://devforge.exemple/api/v1/mcp`) est demandée une
fois à l’installation. Connexion OAuth avec ton compte DevForge, aucune clé à copier.

- `mcp.json` : serveur `devforge` → `${DEVFORGE_MCP_URL}` (déclarée dans `.cursor-plugin/plugin.json`) ;
- `skills/devforge/SKILL.md` : quand et comment utiliser les outils DevForge ;
- `rules/devforge-safety.mdc` : accord explicite avant tout déploiement, écriture de dépôt ou de secret ;
- `assets/logo.svg` : logo carré avec fond.

Test : « List my DevForge projects and the status of the latest deployment ».
Détails : [../README.md](../README.md).

## Licence

Ce dossier (`cursor-plugin/devforge-self-hosted/`) est publié sous licence MIT (voir
[LICENSE](LICENSE)). **La licence MIT ne couvre que ce dossier.** Le reste du dépôt
`bobdivx/devforge` n’est pas concerné et garde sa licence propre.
