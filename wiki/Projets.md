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
| `gpu_nvidia` | `1` → `docker run --gpus all` au prochain déploiement (CUDA / NVENC) |
| `gpu_dri` | `1` → `docker run --device /dev/dri` (VAAPI / Quick Sync) |

## Groupes

Un **groupe** relie plusieurs projets (plusieurs repos) du même workspace. Chaque membre a un **rôle** unique (`web`, `client`, `server`, `api`, ou un slug libre).

À l'accueil, le groupe est une tuile. Les projets hors groupe restent des tuiles. La fiche groupe (`/app/groups/view`) ajoute des membres, change le rôle, et coche NVIDIA et `/dev/dri`.

Contrainte : tous les membres partagent le même `server_id`. Le réseau Docker et les alias DNS sont locaux au nœud.

Au déploiement (nixpacks, Dockerfile, static) :

- réseau `dfg-{slug}` en plus du réseau Traefik
- alias DNS = rôle, donc `http://server:8080` depuis les autres apps du groupe
- variables calculées, non écrites dans l'onglet Env : `DF_GROUP`, `DF_ROLE`, `DF_{ROLE}_URL`, `DF_{ROLE}_PUBLIC_URL` si l'app a une URL publique

Exemple : le client reçoit `DF_SERVER_URL=http://server:8080`. Un redéploiement applique le réseau, les variables et le GPU. Le chemin docker compose ne les pose pas.

## Isolation

Projets, env, agents, backups sont scopés `workspace_uuid`. Un user ne voit pas le workspace d’un autre. Infra partagée (wildcard, Docker, GitHub instance) : voir [[Equipe]].

## Onglets

- **Overview** — statut, URLs, santé, **nœud d’hébergement**, **groupe** (rôle, lien)
- **Workspace** — chat + preview atelier / prod
- **Deployments** — historique, logs, repair
- **Git** — statut, diff, discard local
- **Actions** — GitHub Actions du repo
- **Agents** — Ops / Deploy / Reviewer / custom
- **Domains** — FQDN + ACME
- **Database** — lien Turso (cloud, indépendant du nœud). Pas de Postgres provisionné. SQLite dans le conteneur = locale au nœud, perdue au redéploy.
- **Env** — secrets, import `.env`
- **Backups** — snapshots projet
- **Settings** — nœud, pack, commandes, GPU (NVIDIA et `/dev/dri`), danger zone
