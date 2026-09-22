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
