# Cluster

Un **leader** (control plane + SQLite) et des **workers** (compute). L’identifiant de nœud `id` est le `server_id` des projets : tu choisis sur quelle machine tourne une app.

Enrôlement **100 % UX**. Pas de variables d’environnement pour le rôle ou le join.

## Rôles

| Rôle | Rôle |
|------|------|
| Leader | UI complète, API, SQLite, invitations, dispatch exec |
| Worker | Heartbeat + `/internal/exec`, page `/app/node` uniquement |

Le leader s’enregistre tout seul (`id = default`).

## Ajouter un nœud depuis le leader

Page **Cluster** (`/app/cluster`, admin d’instance) :

1. **Invitation** — génère URL + token (TTL par défaut en heures, minimum 1 h). À coller sur l’autre machine (login setup ou onboarding).
2. **Ajouter via SSH** — host, user (`root`), port. DevForge pousse un script de bootstrap (image Docker + fichier pending-join). La clé SSH de **Settings → Serveur** est utilisée. Docker doit exister sur la cible.

Les nœuds en cours d’enrôlement apparaissent en statut **joining**. Un second join avec le même nom / URL / SSH **réutilise** le placeholder (pas de doublon).

Tu ne peux pas supprimer le leader. Le drain ne s’applique qu’aux workers (plus de nouveaux jobs via `ClusterAwareExecutor`).

Les tuiles affichent CPU, nombre d’apps, last_seen. Fiche nœud :

- **Infos** — rename, métriques (CPU / RAM / disque / Docker), drain worker, CTA sauvegarde leader (`/app/settings?tab=backup`)
- **Apps** — liste des projets (`server_id`) + réassignation (le prochain deploy va sur la cible ; les conteneurs déjà lancés restent)
- **Diagnostic** — `uptime` / `free` / `df` / `docker ps` via exec

Si le **leader** tombe : pas d’élection v1. L’UI/API disparaissent. Les apps Docker déjà lancées sur les workers continuent. Relance la **même** machine avec `/data`.

## Rejoindre depuis une machine neuve

Voir [[Premier-demarrage]]. Formulaire : URL du leader, token, nom optionnel.

Côté API locale : `POST /api/v1/cluster/local` `{ leader_url, token, name? }`.

Après succès : rôle persisté dans SQLite (`cluster_local`), heartbeat démarré, UI worker.

## Dispatch

`ClusterAwareExecutor` :

- `server_id` vide / `default` / `*` → executor local (ou SSH Settings)
- autre id → `POST {advertise_url}/internal/exec` sur le worker, authentifié par le secret de nœud

## Tokens

- Token d’invitation : secret à usage de join, stocké **hashé** (SHA-256)
- Secret de nœud : heartbeat + exec interne
- Revocation : Cluster → invitations, ou expiration

Rate-limit join : 20 tentatives / IP / minute.

## Hors v1

- Réplicas HA du control plane (Turso)
- Mesh WireGuard entre nœuds

Le crate `crates/cluster` + tables SQLite `cluster_*` portent le v1.

## API

| Méthode | Route | Auth |
|---------|--------|------|
| GET/POST | `/api/v1/cluster/nodes` | admin |
| PATCH | `/api/v1/cluster/nodes/{id}` | admin — `{ name?, drained? }` |
| DELETE | `/api/v1/cluster/nodes/{id}?reassign_to=` | admin |
| GET | `/api/v1/cluster/nodes/{id}/projects` | admin |
| POST | `/api/v1/cluster/nodes/{id}/reassign` | admin — `{ target_node_id, project_uuid? \| all }` |
| GET | `/api/v1/cluster/nodes/{id}/logs` | admin |
| GET/POST | `/api/v1/cluster/invites` | admin |
| DELETE | `/api/v1/cluster/invites/{id}` | admin |
| POST | `/api/v1/cluster/join` | token d’invitation |
| POST | `/api/v1/cluster/heartbeat` | secret nœud (+ métriques) |
| GET/POST | `/api/v1/cluster/local` | ouvert si 0 users, sinon admin |
