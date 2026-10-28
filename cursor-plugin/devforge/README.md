# DevForge (plugin Cursor et Grok Bot)

Connecte ton agent à DevForge (https://web.jeser.app) via MCP : projets, déploiements,
journaux, variables d’environnement et atelier de code. Connexion OAuth avec ton compte
DevForge, aucune clé à copier.

- `mcp.json` : serveur `devforge` → `https://web.jeser.app/api/v1/mcp` (URL seule, aucun secret) ;
- `skills/devforge/SKILL.md` : quand et comment utiliser les outils DevForge ;
- `rules/devforge-safety.mdc` : accord explicite avant tout déploiement, écriture de dépôt ou de secret ;
- `assets/logo.svg` : logo carré avec fond.

Utilisation : installer le plugin, cliquer **Connect** sur le serveur `devforge`, approuver
sur la page de consentement DevForge. Test : « List my DevForge projects and the status of
the latest deployment ». Détails : [../README.md](../README.md).

## Licence

Ce dossier (`cursor-plugin/devforge/`) est publié sous licence MIT (voir [LICENSE](LICENSE)).
**La licence MIT ne couvre que ce dossier.** Le reste du dépôt `bobdivx/devforge`
(serveur, interface, applications) n’est pas concerné et garde sa licence propre.
