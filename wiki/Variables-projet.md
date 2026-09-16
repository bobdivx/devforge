# Variables d’environnement (projet)

CRUD : `/api/v1/projects/{uuid}/env`. UI : onglet **Env** (import `.env` supporté).

Stockage SQLite `project_env_vars` (`crates/env`).

## Secrets

Les tools agent voient les valeurs **masquées** (`********`). L’UI admin projet peut afficher / éditer.

## Injection

- **Deploy** : exportées dans le conteneur
- **Atelier** : injectées dans le process `npm run dev`, hors clés réservées (`PATH`, `PORT`, `HOST`, `NODE_ENV`, `LD_*`, etc.)

OIDC par app : le provisionnement écrit aussi des clés dans cet env. Voir [[SSO-et-OIDC]].

## Lien base

Un MCP Turso peut être lié au projet. Les clés (`DATABASE_URL`, `TURSO_*`) apparaissent dans Env et sont injectées au deploy.

Turso est **hors cluster** : leader et workers parlent à la même base cloud. Une SQLite dans le conteneur, elle, reste collée au nœud (et disparaît au redéploy). Voir [[Cluster]].
