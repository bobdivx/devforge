# Équipe et multi-tenant

## Isolation

Chaque utilisateur a un **workspace** (`teams`) :

- projects / env / agents / backups → `workspace_uuid`
- pas de visibilité croisée

## Ressources d’instance (admin)

Partagées par tous les workspaces :

- Domaine wildcard
- Docker / SSH / nœuds cluster
- Storage S3
- Token GitHub d’instance (optionnel)
- LLM

## Forfaits

Champ `teams.plan` : `free` | `pro`.

- Admin d’instance : `pro` (accès infra)
- Users : `free` par défaut

Quotas billing : à brancher ; le champ existe.

## Admin panel

`/app/admin` (`instance_admin`) : workspaces, forfaits, liens de config instance.

## Équipe UI

`/app/team` : membres + invitations (toast).
