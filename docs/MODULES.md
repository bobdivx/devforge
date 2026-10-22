# Modules backend (crates)

Facades derrière traits ; runtime réel activé via env (sinon stubs).

| Crate | Rôle | État |
|-------|------|------|
| `shared` | Erreurs, Tool trait, DTOs | OK |
| `agent` | Runner + registry tools | OK stub LLM |
| `deploy` | tests + Docker lifecycle via `RemoteExecutor` | **SSH / local** (stub = tests only) |
| `env` | Variables d’env projet (secrets masqués) | OK + SQLite |
| `ports` | Mapping ports container ↔ public | Memory store |
| `domain` | FQDN + **certbot ACME** via executor | Memory + apply |
| `proxy` | Routes + **labels Traefik** via `docker update` | Memory + apply |
| `wireguard` | Réseaux/peers + **`wg-quick`** | Memory + apply |
| `auth` | Users, sessions, onboarding | **Argon2 + SQLite** |
| `storage` | Buckets S3-compatibles | **UX Settings** (+ memory fallback) |
| `backup` | Jobs backup → storage + **backup instance** | S3 via UX |
| `detect` | Détection framework (Laravel, Next, Astro, Compose…) | **OK** |
| `llm` | Providers LLM (OpenAI-compat + stub) | **OK** |
| `update` | Self-update versions + compose/docker/binary | **OK** |
| `database` | Provision Postgres (conteneur par projet) + copie SQLite | **OK** |
| `mcp` | Serveur MCP + client HTTP + catalogue (Turso, Slack…) + lien DB→projet | **OK** |
| `cluster` | Nœuds leader/worker, invitations UX, exec HTTP | **OK** |

## Worker Cursor (My Machines)

Admin → **Worker Cursor** (`/app/admin?tab=cursor-worker`) : bouton unique « Installer le worker Cursor » (`POST /api/v1/cursor-worker/install`) — DevForge installe le CLI Cursor dans `<data>/cursor-worker/home` s'il manque, démarre **un process `agent worker start` par projet cloné** (`.git` présent, max 20 ; sinon un espace vide). Chaque process sert le **worktree dédié `<workdir>-cursor`** (créé au démarrage par `git worktree add --no-track -b cursor/devforge <workdir>-cursor origin/<branche de prod>`, jamais modifié ensuite), pas le checkout que les déploiements remettent à `origin/<branche>` : un déploiement n'efface plus le travail d'un agent et un changement de branche de l'agent ne gêne plus le build. Projet sans checkout : « pas encore de checkout : déployer une fois ». « Remettre à jour » (`POST /api/v1/cursor-worker/refresh`, leader) replace chaque worktree sur `origin/<branche>` après sauvegarde des changements non publiés (`<data>/draft-backups/<uuid>-cursor/`). Chaque process a son `--worker-dir`, son `--data-dir` et **son propre nom de machine `<nom>-<dépôt>`** (dépôt = dernier segment du remote `origin`, ex. `devforge-template-studio`). Le CLI mémorise le workerId par nom affiché : un nom partagé donnerait un seul workerId et Cursor enverrait la session à n'importe quel process. Pour viser un dépôt : machine `<nom>-<dépôt>` dans My Machines, ou `worker=<nom>-<dépôt>`. DevForge vérifie ensuite le process et la sonde `/readyz`. Nœud : leader par défaut (processus enfant), ou un nœud worker via l'executor du cluster. Seule la clé API personnelle Cursor est demandée si elle n'est pas déjà enregistrée (ou `CURSOR_API_KEY` côté serveur) ; elle est passée par l'environnement, jamais en argument. Nom, binaire et dossiers en plus : modale « Avancé ». Autostart via `cursor_worker_enabled` (activé par l'installation).

## Base de données DevForge (métadonnées)

**Défaut : PostgreSQL** (conteneur `devforge-pg`, `127.0.0.1:5433`). Un ancien `DATABASE_URL=sqlite:…` est importé une fois dans cette base. Un `DATABASE_URL=postgres://…` externe est utilisé tel quel.

- Simple en solo / CI / laptop.
- **Turso** (libSQL) : option plus tard pour replicas HA du control plane — même schéma SQL, driver `libsql`. Pas obligatoire maintenant.

Le **cluster v1** n’utilise pas Turso : un leader SQLite + des workers. Enrôlement 100 % UX (`/app/cluster` et onboarding « Rejoindre un cluster ») — aucune variable `DEVFORGE_CLUSTER_*` / `DEVFORGE_ROLE`.

## Activation runtime

```bash
export DEVFORGE_EXECUTOR=auto   # ssh si DEVFORGE_SSH_HOST, sinon local
export DEVFORGE_SSH_HOST=…
export DEVFORGE_GITHUB_TOKEN=…
# Backups S3 instance : Settings → Sauvegardes (UX), pas d’env.
```

Pas de fallback stub silencieux : sans config, GitHub = `off` (erreur API), executor = `local`.

`GET /api/v1/health` → `backends.{executor,github,storage,database,llm,update,cluster}` + `version`.

## Routes HTTP

- Storage : `/api/v1/storage/buckets` + `…/{bucket}/objects`
- Backups projets : `/api/v1/projects/{uuid}/backups` + `…/restore-preview`
- Backups instance : `/api/v1/settings/backup-s3` + `/api/v1/instance/backups` (+ restore)
- Update : `/api/v1/update/check|status|start` (+ UI `/app/update`, wait `/app/update/wait`)
- Cluster : `/api/v1/cluster/nodes` · `PATCH/DELETE /nodes/{id}` · `/nodes/{id}/projects|reassign|logs` · `/invites` · `/join` · `/heartbeat` · `/local` (+ UI `/app/cluster`)
- (+ ports, domains, proxy, lifecycle, wireguard, github)
