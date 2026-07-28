# Cutover NAS — Coolify → DevForge standalone

## Prérequis

- Backup Postgres + AppData
- `DEPLOY_MODE=images` dans `scripts/devforge-deploy.env`
- Disque `/media/Docker` avec **≥ 20 Go libres** (`scripts/devforge-disk-prune.sh`)
- Secrets prêts dans `/media/Docker/AppData/devforge/source/.env` (copier `.env.devforge.example`)

## 1. Backup

```bash
ssh bobdivx@10.1.0.58
mkdir -p /DATA/.devforge/backups
# Postgres (conteneur coolify-db encore up)
docker exec coolify-db pg_dumpall -U coolify | gzip -c > /DATA/.devforge/backups/pg-$(date +%Y%m%d).sql.gz
# AppData
tar -czf /DATA/.devforge/backups/coolify-appdata-$(date +%Y%m%d).tar.gz -C /media/Docker/AppData coolify
```

## 2. Préparer les chemins DevForge

```bash
mkdir -p /media/Docker/AppData/devforge/{source,ssh,applications,databases,services,backups,data,postgres,redis}

# Option A — réutiliser Postgres Coolify sans copie (cutover rapide)
# Dans .env :
#   DEVFORGE_POSTGRES_DATA=/media/Docker/AppData/coolify/postgress
#   DEVFORGE_DATA_ROOT=/media/Docker/AppData/coolify
#   DEVFORGE_PLATFORM_DATA=/media/Docker/AppData/coolify/data

# Option B — copie puis bascule (recommandé si espace disque ok)
rsync -aH /media/Docker/AppData/coolify/postgress/ /media/Docker/AppData/devforge/postgres/
rsync -aH /media/Docker/AppData/coolify/data/ /media/Docker/AppData/devforge/data/
# Copier .env Coolify → .env et adapter DB_HOST=postgres, APP_NAME=DevForge
```

## 3. Déployer depuis Windows

```powershell
.\scripts\nas-fix-devforge.ps1 -EnableAgents
```

Le script build les images sur le NAS et lance :

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env up -d
```

## 4. Arrêter l’ancienne stack Coolify (CasaOS)

Quand la stack `devforge-*` est healthy :

```bash
cd /var/lib/casaos/apps/coolify
docker compose stop coolify coolify-db coolify-redis coolify-realtime
# Garder coolify-proxy si d’autres apps l’utilisent ; sinon pointer le port 8080
# vers devforge-proxy (déjà publié sur DEVFORGE_HTTP_PORT=8080).
```

**Attention** : ne pas démarrer `coolify-db` et `devforge-db` en même temps sur le **même** répertoire Postgres.

## 5. Vérifications

```bash
docker ps --filter name=devforge
curl -sI http://127.0.0.1:8080/ | head
curl -sI http://127.0.0.1:8080/api/health | head
curl -sI http://127.0.0.1:8080/login | head
```

UI : `http://10.1.0.58:8080/` (redirect `/devforge/` → `/`).

## 6. Rollback

```bash
cd /media/Docker/AppData/devforge/source
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env down
cd /var/lib/casaos/apps/coolify
docker compose up -d
```

Restaurer le dump SQL si la DB a été altérée.

## 7. Après cutover stable

- Mettre `DEPLOY_MODE=images` définitivement
- Retirer le mode `overlay` des habitudes
- Surveiller `/media/Docker` (prune post-deploy automatique)
- Progresser Phase 4/5 : purge Livewire, `COOLIFY_*` → `DEVFORGE_*`
