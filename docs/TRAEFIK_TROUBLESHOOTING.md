# Traefik Routing Troubleshooting Guide

## Symptôme : App timeout/504 via Cloudflare→Traefik

Container déployé avec labels Traefik (`[start] traefik labels applied`), container Up/healthy, mais requêtes timeout ou 504 via Cloudflare→Traefik, alors que d'autres apps sur le même Traefik fonctionnent.

## Investigation étape par étape

### 1. Vérifier que Traefik voit le router

```bash
# Via API Traefik
curl http://traefik:8080/api/http/routers | jq '.[] | select(.name | contains("df-<uuid>"))'
```

**Attendu** : Router existe avec rule `Host(\`your-domain.com\`)` et service `df-<uuid>`

**Si absent** : Labels non appliqués ou Traefik ne surveille pas le bon Docker provider

### 2. ✅ Vérifier connectivité réseau Docker (MOST COMMON)

```bash
# Lister réseaux du container
docker inspect <container-name> --format '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}'

# Comparer avec réseaux Traefik
docker inspect traefik --format '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}'
```

**Attendu** : Au moins un réseau commun (ex: `devforge-net`, `traefik-public`, `coolify`)

**Si aucun réseau partagé** : ⚠️ **C'EST LE PROBLÈME**
- Traefik match le router mais ne peut pas joindre le container
- Requêtes hang jusqu'au timeout (504)
- **Solution** : Définir `DEVFORGE_DOCKER_NETWORK` avant deploy OU connecter manuellement :

```bash
# Fix container existant
NETWORK=devforge-net  # ou traefik-public, coolify, etc.
docker network connect $NETWORK <container-name>
```

### 3. Vérifier l'app répond en interne

```bash
# Depuis container Traefik (ou autre sur même réseau)
docker exec traefik wget -O- --timeout=5 http://<container-name>:<port>/

# OU créer container test
docker run --rm --network devforge-net alpine/curl:latest \
  curl -v http://<container-name>:<port>/
```

**Si connection refused/timeout** :
- App ne listen pas sur `0.0.0.0:<port>` ou mauvais port
- App crashed/stuck au démarrage
- Vérifier logs : `docker logs <container-name>`

**Si 200 OK** : Réseau OK, problème ailleurs (DNS, Cloudflare tunnel, config Traefik)

### 4. Vérifier service backend Traefik

```bash
# Vérifier résolution service
curl http://traefik:8080/api/http/services | jq '.[] | select(.name == "df-<uuid>@docker")'
```

**Attendu** : Service avec `loadBalancer.servers[].url = "http://<container-ip>:<port>"`

**Si servers[] vide** : Traefik ne résout pas le container (problème réseau ou nom service incorrect dans labels)

## Causes communes & Fixes

| Symptôme | Cause | Fix |
|---------|-------|-----|
| Traefik 404 | Router pas créé | Vérifier labels, restart Traefik rescan |
| Requêtes hang/504 | **Pas de réseau partagé** | Set `DEVFORGE_DOCKER_NETWORK`, redeploy ou `docker network connect` |
| Connection refused | App ne listen pas | Logs app, vérifier `HOST=0.0.0.0` env |
| Traefik OK mais app lent | App bloque au startup | Vérifier dépendances app (DB, API calls) |
| Template parsing error | Bug dans `docker_recreate_with_labels` | **Fixed in PR #48** |

## Checks DevForge-specific

### Variable d'environnement

```bash
# Sur serveur DevForge
echo $DEVFORGE_DOCKER_NETWORK
```

**Attendu** : Non-vide, ex: `devforge-net` ou `traefik-public` ou `coolify`

**Si vide** : 
1. Définir dans `/etc/environment` ou systemd service
2. Restart DevForge server
3. **Logs deploy afficheront warning** (après PR #48) :
   ```
   [start] WARNING: Traefik labels set but DEVFORGE_DOCKER_NETWORK is empty.
   [start] WARNING: Set DEVFORGE_DOCKER_NETWORK to 'devforge-net', 'traefik-public', or 'coolify'.
   ```

### Vérifier proxy/sync préserve réseau

Après `POST /api/v1/projects/{uuid}/proxy/sync` :

```bash
# Before et after doivent matcher
docker inspect <container-name> --format '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}'
```

**Si changé** : Bug `docker_recreate_with_labels` → **Fixed in PR #48**

### Vérifier labels intacts après sync

```bash
docker inspect <container-name> --format '{{json .Config.Labels}}' | jq '
  to_entries[] | select(.key | startswith("traefik."))
'
```

**Attendu** : Labels `Host(\`fqdn\`)` présents verbatim, pas de corruption

**Si corrompu** : Bug shell command substitution → **Fixed in PR #48**

## Diagnostic avancé

### 1. Cloudflare tunnel ingress

```bash
cloudflared tunnel route ip show
# OU via dashboard Cloudflare Zero Trust > Access > Tunnels
```

### 2. DNS

```bash
dig +short your-domain.com
# Doit pointer vers IPs Cloudflare
```

### 3. Test sans Cloudflare

```bash
curl -H "Host: your-domain.com" http://<server-ip>:80/
# Bypass Cloudflare, direct vers Traefik
```

### 4. Logs Traefik debug

```bash
# Config Traefik : --log.level=DEBUG
docker logs traefik -f | grep <container-name>
```

## Workflow complet de diagnostic

```bash
#!/bin/bash
CONTAINER="df-<uuid>"
TRAEFIK="traefik"

echo "=== 1. Networks ==="
echo "Container networks:"
docker inspect $CONTAINER --format '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}'
echo "Traefik networks:"
docker inspect $TRAEFIK --format '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}'

echo -e "\n=== 2. Labels ==="
docker inspect $CONTAINER --format '{{json .Config.Labels}}' | jq 'to_entries[] | select(.key | startswith("traefik."))'

echo -e "\n=== 3. Internal connectivity ==="
PORT=$(docker inspect $CONTAINER --format '{{json .Config.Labels}}' | jq -r '.["traefik.http.services.df-'${CONTAINER:3:8}'.loadbalancer.server.port"]')
docker exec $TRAEFIK wget -O- --timeout=2 http://$CONTAINER:$PORT/ 2>&1 | head -5

echo -e "\n=== 4. Traefik router ==="
curl -s http://localhost:8080/api/http/routers | jq ".[] | select(.name | contains(\"${CONTAINER:3:8}\"))"

echo -e "\n=== 5. Traefik service ==="
curl -s http://localhost:8080/api/http/services | jq ".[] | select(.name | contains(\"${CONTAINER:3:8}\"))"
```

Sauver comme `diagnose-traefik.sh`, rendre exécutable, lancer avec nom du container.

## Résolution rapide (checklist)

- [ ] Container et Traefik sur même réseau Docker ?
- [ ] `DEVFORGE_DOCKER_NETWORK` défini dans environnement serveur ?
- [ ] App listen sur `0.0.0.0:<port>` (pas `127.0.0.1`) ?
- [ ] Labels Traefik présents et non-corrompus ?
- [ ] Router présent dans Traefik API ?
- [ ] Service backend résolu avec server URL ?
- [ ] Test connectivité interne OK ?

## Liens

- PR #48: Fix `docker_recreate_with_labels` network + label quoting
- `crates/deploy/src/docker.rs`: Documentation inline Traefik requirements
