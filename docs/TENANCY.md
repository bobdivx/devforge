# Multi-tenant : isolation & ressources partagées

## Rôles

| Rôle | Qui | Quoi |
|------|-----|------|
| `instance_admin` | **Premier compte** | Configure l’instance (domaine, GitHub, SSH). Wizard onboarding. |
| `user` | Comptes suivants | Workspace **isolé**, forfait `free` par défaut. |

## Isolation

Chaque utilisateur a son **workspace** (table `teams`) :
- projects / env / agents / backups → scopés `workspace_uuid`
- Pas de visibilité croisée entre workspaces

## Ressources partagées (instance)

Gérées par l’admin, utilisées par tous :
- Domaine wildcard apps
- Serveurs SSH / Docker
- Backend storage S3
- Credentials GitHub App / token instance (optionnel)

## Forfaits (à brancher billing)

| Plan | Intention |
|------|-----------|
| `free` | Limites soft (projets, builds, storage) — à définir |
| `pro` | Quotas élevés / features avancées |

Champ DB : `teams.plan` (`free` \| `pro`).  
L’admin instance démarre en `pro` (accès infra). Les users en `free`.

## Auth UI

- `/login` — connexion + lien inscription
- `/register` — même flux (mode register)
- Premier user → setup admin + wizard
- Users suivants → compte + workspace free → `/app`
- `/app/admin` — panneau opérateur (`instance_admin` uniquement) : clients, forfaits free/pro, liens config instance

