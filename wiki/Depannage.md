# Dépannage

## Instance injoignable

- Conteneur / binaire up ? `curl http://127.0.0.1:8000/api/v1/health`
- Port `DEVFORGE_HTTP_PORT` / `8000`
- `DATABASE_URL` : en Docker ce doit être `sqlite:/data/devforge.db?mode=rwc` et le volume `/data` monté

## Login SSO bloqué

`DEVFORGE_FORCE_LOCAL_LOGIN=1` puis restart. Voir [[Authentification]].

## Worker au lieu de l’UI

Cette machine a rejoint un cluster. Ouvre le **leader**, ou `/app/node` en local. Le rôle est dans SQLite `cluster_local`, pas dans l’env.

## Apps en 504 / timeout via Traefik

Cause n°1 : **pas de réseau Docker commun** avec Traefik. Voir [[Domaines-et-Traefik]].

```bash
docker network connect "$DEVFORGE_DOCKER_NETWORK" df-<uuid>
```

Vérifie aussi `HOST=0.0.0.0` dans l’app et les labels Traefik.

## Atelier sans URL

Wildcard manquant : Settings → Domaine.

## Auto-deploy ne part pas

- Toggle `auto_deploy` du projet
- Webhook GitHub vers `/api/v1/webhooks/github` + secret
- PAT `admin:repo_hook` + `instance_url` pour l’ensure
- Branche du push = `git_branch`
- Le poller (~90 s) doit rattraper sinon : logs server / `DEVFORGE_GITHUB_WEBHOOK_SECRET`

## Agents muets

Settings → Agents / LLM. Health `backends.llm`. Mode stub = pas de génération.

## GitHub « off »

Pas de token Settings ni `DEVFORGE_GITHUB_TOKEN` : l’API GitHub échoue **explicitement** (pas de stub).

## npm / preview

Node/npm doivent être sur le nœud qui exécute l’atelier. Logs preview dans le workdir.

## Self-update

Vérifie `DEVFORGE_UPDATE_MODE`, le compose monté en lecture, et que le process a le droit Docker.
