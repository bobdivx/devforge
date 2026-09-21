# Variables d’environnement (projet)

CRUD : `/api/v1/projects/{uuid}/env`. UI : onglet **Env** (import `.env` supporté).

Stockage SQLite `project_env_vars` (`crates/env`) — **scopé par `project_uuid`**.

## Source de vérité

La **DB projet** est la source de vérité. Le fichier `{workdir}/.env` est un **clone** de ces variables, jamais un store partagé entre projets.

| Action | Comportement |
|--------|----------------|
| Deploy / preview / upsert / import | Clone DB → `{workdir}/.env` (remplace tout) |
| Env projet vide | **Supprime** le `.env` workdir (évite leftover) |
| Import `.env` / Sync workdir | N’écrase une clé DB **que si la valeur a changé** |
| Nouveaux projets | Workdir `/data/devforge/applications/{uuid}` (isolation) |

API sync volontaire : `POST /api/v1/projects/{uuid}/env/sync-workdir` — lit le `.env` disque et merge only-if-changed, puis reclône.

## Secrets

Les tools agent voient les valeurs **masquées** (`********`). L’UI admin projet peut afficher / éditer.

## Injection

- **Deploy** : `.env` cloné puis `docker run --env-file`
- **Atelier** : injectées dans le process `npm run dev`, hors clés réservées (`PATH`, `PORT`, `HOST`, `NODE_ENV`, `LD_*`, etc.) + clone `.env` workdir

OIDC par app : le provisionnement écrit aussi des clés dans cet env. Voir [[SSO-et-OIDC]].

## Lien base

Un MCP Turso peut être lié au projet. Les clés (`DATABASE_URL`, `TURSO_*`) apparaissent dans Env et sont injectées au deploy.

Turso est **hors cluster** : leader et workers parlent à la même base cloud. Une SQLite dans le conteneur, elle, reste collée au nœud (et disparaît au redéploy). Voir [[Cluster]].
