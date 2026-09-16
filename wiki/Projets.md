# Projets

Un projet DevForge = une application : repo Git, workdir, pack de build, domaine, env, agents, nœud (`server_id`).

## Créer

1. **Importer GitHub** — wizard : repo → branche → détection framework → build / runtime
2. **Scaffold / builder** — titre + prompt → `POST /api/v1/projects/scaffold` → agent Deploy démarre tout seul
3. **Manuel** — `POST /api/v1/projects`

Détection (`crates/detect`) : Laravel, Next, Astro, Compose, Dockerfile, static, etc.

## Champs utiles

| Champ | Sens |
|-------|------|
| `workdir` | Racine locale / nœud pour tests et atelier |
| `test_command` | Commande de tests (pas de scan magique de chemins) |
| `server_id` | Nœud cluster (`default` = leader). Visible partout (accueil, liste, overview, Cluster). **Un nœud par forge**, pas de réplica. Réglable à la création et dans Settings.
| `build_pack` | `nixpacks` (défaut), `dockerfile`, `dockercompose`, `static` |
| `git_repository` · `git_branch` | Source de deploy |
| `auto_deploy` | Push / poll → deploy. Voir [[Auto-deploy]] |

## Isolation

Projets, env, agents, backups sont scopés `workspace_uuid`. Un user ne voit pas le workspace d’un autre. Infra partagée (wildcard, Docker, GitHub instance) : voir [[Equipe]].

## Onglets

- **Overview** — statut, URLs, santé, **nœud d’hébergement**
- **Workspace** — chat + preview atelier / prod
- **Deployments** — historique, logs, repair
- **Git** — statut, diff, discard local
- **Actions** — GitHub Actions du repo
- **Agents** — Ops / Deploy / Reviewer / custom
- **Domains** — FQDN + ACME
- **Database** — lien Turso (cloud, indépendant du nœud). Pas de Postgres provisionné. SQLite dans le conteneur = locale au nœud, perdue au redéploy.
- **Env** — secrets, import `.env`
- **Backups** — snapshots projet
- **Settings** — nœud, pack, commandes, danger zone
