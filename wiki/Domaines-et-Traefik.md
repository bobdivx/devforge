# Domaines et Traefik

## Wildcard apps

Settings → Domaine : `apps.example.com`.

- Prod : `{slug}.apps.example.com` (selon tes FQDN projet)
- Atelier : `dev-{8chars}.{wildcard}`

Sans wildcard, l’atelier ne publie pas d’URL HTTPS.

## Entrée publique (auto)

Settings → Domaine → **Entrée publique**. Token + domaine optionnel (sinon déduit du wildcard). Traefik sur **chaque nœud**. Une forge = un nœud : le DNS vise la machine qui l’héberge.

| Fournisseur | Ce que DevForge fait | Si le leader tombe |
|-------------|----------------------|--------------------|
| **Cloudflare** | Tunnel `devforge-{nœud}` (catch-all → Traefik :80) + CNAME proxied `{fqdn}` → `{tunnel_id}.cfargotunnel.com` | Les apps workers restent joignables via *leur* tunnel |
| **Porkbun** | Record A (ou AAAA/CNAME) vers l’IP publique du nœud | Idem, le record pointe vers le nœud d’hébergement |
| Tunnel Cloudflare **manuel, leader seul** | — | Tous les hostnames de ce tunnel meurent |

Cloudflare : token Account Tunnel Edit + Zone DNS Edit + Account Read. Porkbun : **clé API** + **Secret API** (deux champs). Ports **80/443** seulement pour Porkbun (Let’s Encrypt HTTP-01). Cloudflare tunnel n’a pas besoin de ports publics.

Certificats : crate `domain` + **certbot ACME** via l’executor. Traefik gère aussi l’HTTP challenge.


## ZimaOS : 80/443 déjà pris

Le gateway ZimaOS occupe l'hôte `:80`. Publier `80:80` laisse `devforge-traefik` en `Created` (`port is already allocated`) et toutes les apps `df-*` injoignables.

DevForge publie 80/443 seulement s'ils sont libres. Sinon Traefik écoute uniquement sur le réseau Docker `devforge`, et le tunnel Cloudflare vise `http://devforge-traefik:80` (plus `127.0.0.1:80`). `devforge-cloudflared` est sur ce réseau, pas en `network_mode: host`.

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
