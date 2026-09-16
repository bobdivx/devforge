# Domaines et Traefik

## Wildcard apps

Settings → Domaine : `apps.example.com`.

- Prod : `{slug}.apps.example.com` (selon tes FQDN projet)
- Atelier : `dev-{8chars}.{wildcard}`

Sans wildcard, l’atelier ne publie pas d’URL HTTPS.

Certificats : crate `domain` + **certbot ACME** via l’executor (pas seulement un enregistrement DNS).

## Labels Traefik

Au deploy, DevForge applique des labels (`docker update` / recreate) pour que Traefik route vers le conteneur `df-<uuid>`.

## Réseau obligatoire

Traefik et les apps doivent partager **un réseau Docker**.

```bash
DEVFORGE_DOCKER_NETWORK=devforge
```

Si absent : DevForge tente une auto-détection (inspect des conteneurs traefik/caddy). En cas d’échec : 504 / timeout alors que le conteneur est `Up`.

Fix immédiat :

```bash
docker network connect "$NETWORK" df-<uuid>
```

Puis corrige l’env et redéploie.

## Checks

```bash
# Traefik voit le router ?
curl http://traefik:8080/api/http/routers | jq '.[] | select(.name | contains("df-"))'

# Réseaux communs
docker inspect df-<uuid> --format '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}'
docker inspect traefik --format '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}'
```

L’app doit écouter `0.0.0.0:<port>` (souvent via `HOST=0.0.0.0`).

## Proxy DevForge

- `GET /api/v1/system/proxy/status`
- `POST /api/v1/system/proxy/ensure` · `restart`
