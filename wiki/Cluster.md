# Cluster

Un **leader** (control plane + SQLite) et des **workers** (compute). L’identifiant de nœud `id` est le `server_id` des projets : tu choisis sur quelle machine tourne une forge. **Une forge = un nœud**, pas de copie automatique.

La page Cluster liste **toutes les forges** (nœud, rôle, statut app, statut nœud). Accueil et liste projets affichent aussi le nœud.

Enrôlement **100 % UX**. Pas de variables d’environnement pour le rôle ou le join.

## Rôles

| Rôle | Rôle |
|------|------|
| Leader | UI complète, API, SQLite, invitations, dispatch exec |
| Worker | Heartbeat + `/internal/exec`, page `/app/node` uniquement |

Le leader s’enregistre tout seul (`id = default`).

## Ajouter un nœud depuis le leader

Page **Cluster** (`/app/cluster`, admin d’instance) :

1. **Inviter un nœud** — génère un **jeton** `dfjoin_…` (TTL 24 h). Sur l’autre machine : jeton + **URL du leader joignable depuis ce nœud** (pas collée dans le jeton). Nom optionnel.
2. **Via SSH** (avancé) — host, user, port. DevForge pousse le bootstrap. Clé SSH de Settings → Serveur.

Les nœuds en cours d’enrôlement apparaissent en statut **joining**. Un second join avec le même nom / URL / SSH **réutilise** le placeholder (pas de doublon).

Tu ne peux pas supprimer le leader. Le drain ne s’applique qu’aux workers (plus de nouveaux jobs via `ClusterAwareExecutor`).

Les tuiles affichent CPU, version DevForge, nombre d’apps, last_seen. Fiche nœud :

- **Infos** — rename, **URL du nœud / leader** (modifiable après ajout), métriques (CPU / RAM / disque / Docker), **mise à jour DevForge** (workers depuis le leader ; leader via Paramètres → Mise à jour), drain worker, CTA sauvegarde leader (`/app/settings?tab=backup`)
- **Apps** — liste des projets (`server_id`) + réassignation (le prochain deploy va sur la cible ; les conteneurs déjà lancés restent)
- **Diagnostic** — `uptime` / `free` / `df` / `docker ps` via exec

Si le **leader** tombe : après ~1 min sans heartbeat, le worker au plus petit `id` (non drainé, URL connue) **est élu** et restaure la dernière copie SQLite. L’UI/API reviennent sur cet intérim (perte max ~30–60 s). Les apps Docker déjà lancées **continuent**. Quand le leader d’origine revient, il reprend la base de l’intérim puis redevient le control plane.

Un tunnel Cloudflare **uniquement sur le leader** est un point unique : les domaines publics meurent avec lui. Settings → Domaine → **Entrée publique** : un token (et le domaine si besoin).

- **Cloudflare** — un tunnel `devforge-{nœud}` par machine, CNAME proxied vers `{tunnel_id}.cfargotunnel.com`. Pas de 80/443 à ouvrir.
- **Porkbun** — record A vers l’IP publique du nœud. Ports 80/443 + HTTP-01.

Traefik écoute sur **chaque nœud**. Cluster → Infos montre la cible auto (surcharge possible).

Si un **worker** tombe : seules les apps de ce nœud s’arrêtent. Réassigne + redéploie vers un nœud en ligne. Les autres workers et le leader restent.

## Bases de données

Trois couches distinctes :

| Quoi | Où | Si le nœud change / tombe |
|------|----|---------------------------|
| SQLite DevForge (control plane) | Fichier `/data` **sur le leader**, copie récente sur chaque worker | Leader down → élection + restauration de la copie (~30–60 s). Relancer la machine d’origine pour reprendre. Sauvegarde instance. |
| **Turso** liée au projet | Cloud (libSQL) | Les env `DATABASE_URL` / `TURSO_*` suivent le projet. La forge peut bouger de nœud, les données restent. |
| SQLite **dans le conteneur** de l’app | Disque du nœud qui run le container | Perdue au redéploy (nouveau conteneur). Inaccessible si ce worker est down. |

L’onglet projet **Database** ne provisionne pas de Postgres. Il lie une base Turso (MCP) et injecte les secrets dans Env, donc dans le conteneur au prochain deploy.

## Rejoindre depuis une machine neuve

Premier écran → **Rejoindre un cluster**. Colle le **jeton** `dfjoin_…`, puis l’**URL du leader** que cette machine peut joindre (DNS, IP LAN…). L’URL n’est pas dans le jeton.

Côté API locale : `POST /api/v1/cluster/local` `{ token, leader_url, name? }`. Un ancien collage `dfjoin_…@https://…` est encore accepté.

Après succès : rôle persisté dans SQLite (`cluster_local`), heartbeat démarré, UI worker.

Les adresses restent modifiables ensuite :

- **Leader** — fiche nœud → Infos : URL du leader ou de chaque worker
- **Worker** — page `/app/node` : URL du leader (heartbeat) et URL de ce nœud (propagée au leader)

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

- Réplication synchrone du control plane (Turso / libSQL)
- Mesh WireGuard entre nœuds

Le crate `crates/cluster` + tables SQLite `cluster_*` portent le v1.

## API

| Méthode | Route | Auth |
|---------|--------|------|
| GET/POST | `/api/v1/cluster/nodes` | admin |
| PATCH | `/api/v1/cluster/nodes/{id}` | admin — `{ name?, drained?, advertise_url?, ingress_host? }` |
| DELETE | `/api/v1/cluster/nodes/{id}?reassign_to=` | admin |
| GET | `/api/v1/cluster/nodes/{id}/projects` | admin |
| POST | `/api/v1/cluster/nodes/{id}/reassign` | admin — `{ target_node_id, project_uuid? \| all }` |
| GET | `/api/v1/cluster/nodes/{id}/logs` | admin |
| GET/POST | `/api/v1/cluster/nodes/{id}/update` | admin — lance / suit la self-update du worker |
| POST | `/api/v1/cluster/update-workers` | admin — `{ target_version? }` tous les workers en ligne |
| GET/POST | `/api/v1/cluster/invites` | admin |
| DELETE | `/api/v1/cluster/invites/{id}` | admin |
| POST | `/api/v1/cluster/join` | token d’invitation |
| POST | `/api/v1/cluster/heartbeat` | secret nœud (+ métriques) |
| GET/POST/PATCH | `/api/v1/cluster/local` | ouvert si 0 users, sinon admin — PATCH `{ leader_url?, advertise_url? }` (aussi sur un worker) |
| GET/POST | `/api/v1/settings/dns` | admin — `{ provider: cloudflare\|porkbun\|'', zone?, token? }` puis provision auto |
| POST | `/api/v1/settings/dns/test` | admin — ping Cloudflare ou Porkbun |
