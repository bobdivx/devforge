# DevForge

DevForge est une plateforme **self-hosted** qui combine :

- **PaaS** — déployer des apps, gérer domaines, variables d’environnement, runners, backups
- **Builder** — des agents IA scaffoldent un projet, éditent le code et prévisualisent les changements dans le navigateur

Pas d’Electron : tout passe par le web. Un nœud **leader** tient le control plane (SQLite) ; des **workers** ajoutent de la capacité de compute.

## Démarrer

| Tu veux… | Page |
|----------|------|
| Installer une instance | [[Installation]] |
| Passer le wizard | [[Premier-demarrage]] |
| Ajouter des machines | [[Cluster]] |
| Déployer une app | [[Projets]] · [[Deploiement]] |
| Comprendre le produit | [[Architecture]] · [[Interface]] |

Images Docker : `bobdivx/devforge` (Docker Hub) et `ghcr.io/bobdivx/devforge`.  
Binaires Linux / Windows : [GitHub Releases](https://github.com/bobdivx/devforge/releases).

## Navigation produit

**Globale** (admin) : Apps · Runners · Cluster · MCP · Tokens · Compte · Settings  
**Projet** : Overview · Workspace · Deployments · Git · Actions · Agents · Domains · Database · Env · Backups · Settings

Les agents ne sont **pas** une app globale : ils vivent dans le projet.

## Hors v1 cluster

- Haute dispo du control plane (Turso / libSQL)
- Overlay WireGuard entre nœuds

Ces sujets restent documentés comme **suite**, pas comme prérequis.

Code : [bobdivx/devforge](https://github.com/bobdivx/devforge) · archive legacy : [devforge-alpha](https://github.com/bobdivx/devforge-alpha) (extraction uniquement).
