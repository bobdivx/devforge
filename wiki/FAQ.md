# FAQ

## DevForge remplace-t-il Vercel / Netlify ?

C’est un **PaaS self-hosted** (Docker, domaines, env, backups) **plus** un builder web (agents + atelier). Tu héberges le control plane.

## Faut-il Kubernetes / k3s ?

Non. v1 = un leader SQLite + workers DevForge (process / Docker). Pas de k8s.

## Comment ajouter une deuxième machine ?

Leader : Cluster → **Inviter un nœud** → copier le code. Nouvelle install DevForge → **Rejoindre un cluster** → coller le code. SSH reste une option avancée. [[Cluster]]

## Les workers ont-ils l’UI complète ?

Non. Page `/app/node` seulement. L’UI produit est sur le leader.

## Où est la base ?

SQLite fichier (`/data/devforge.db` en Docker). Turso n’est pas requis en v1.

## Faut-il WireGuard ?

Pas pour le cluster v1. Le crate `wireguard` existe pour des réseaux d’apps, ce n’est pas le mesh nœuds.

## Comment les apps sont-elles buildées ?

Nixpacks par défaut, sinon Dockerfile / Compose / static. [[Deploiement]]

## L’agent peut-il pousser sur GitHub tout seul ?

Oui s’il a PAT / MCP GitHub. Scaffold : create repo → write files → deploy.

## Inscription ouverte ?

Non par défaut (`DEVFORGE_ALLOW_REGISTER=0`).

## Où est la doc interne (implémentation) ?

`docs/` dans le dépôt (architecture crates, incidents, slices builder). Ce wiki est le **manuel produit**.
