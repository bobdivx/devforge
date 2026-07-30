#!/usr/bin/env bash
# Copie Postgres Coolify -> DevForge (network_mode: host, ports partages).
# Sur le NAS: bash nas-copy-coolify-db-to-devforge.sh
set -euo pipefail

DATE=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=/DATA/.devforge/backups
COOLIFY_PG=/media/Docker/AppData/coolify/postgress
COOLIFY_DATA=/media/Docker/AppData/coolify/data
DEVFORGE_PG=/media/Docker/AppData/devforge/postgres
DEVFORGE_DATA=/media/Docker/AppData/devforge/data
COMPOSE=/var/lib/casaos/apps/devforge/docker-compose.yml
COMPOSE_DIR=/var/lib/casaos/apps/devforge
DF_DB=devforge-db

mkdir -p "$BACKUP_DIR"

echo "=== 1. Stop DBs (liberer 5432) ==="
for c in coolify-db "$DF_DB"; do
  if docker ps -a --format '{{.Names}}' | grep -qx "$c"; then
    echo "Stopping $c"
    docker stop "$c" || true
  fi
done
sleep 2

if sudo ss -tlnp | grep -q ':5432'; then
  echo "ERROR: port 5432 encore occupe:"
  sudo ss -tlnp | grep 5432 || true
  exit 1
fi
echo "Port 5432 libre."

echo "=== 2. Backup filesystem Coolify Postgres ==="
sudo tar -czf "$BACKUP_DIR/coolify-postgress-$DATE.tar.gz" -C /media/Docker/AppData/coolify postgress
ls -lh "$BACKUP_DIR/coolify-postgress-$DATE.tar.gz"

echo "=== 3. Copie Postgres + data ==="
sudo mkdir -p "$DEVFORGE_PG" "$DEVFORGE_DATA"
sudo rsync -aH --delete "$COOLIFY_PG/" "$DEVFORGE_PG/"
sudo rsync -aH --delete "$COOLIFY_DATA/" "$DEVFORGE_DATA/"
sudo du -sh "$DEVFORGE_PG" "$DEVFORGE_DATA"

echo "=== 4. Patch credentials DevForge (= Coolify) ==="
sudo cp "$COMPOSE" "$COMPOSE.bak-$DATE"
sudo python3 - <<'PY'
from pathlib import Path
p = Path("/var/lib/casaos/apps/devforge/docker-compose.yml")
text = p.read_text()
name = "dev" + "forge"
pairs = [
    (
        "APP_KEY: base64:CHANGE_ME_GENERATE_WITH_php_artisan_key_generate",
        "APP_KEY: base64:uX9vK7bN2mP5wQ8xZ3rY6tV1eW4qG7zJpKsLtMvNxBc=",
    ),
    (f"DB_DATABASE: {name}", "DB_DATABASE: coolify"),
    ("DB_PASSWORD: CHANGE_ME", "DB_PASSWORD: 8tc6vr89"),
    (f"DB_USERNAME: {name}", "DB_USERNAME: coolify"),
    (f"POSTGRES_DB: {name}", "POSTGRES_DB: coolify"),
    ("POSTGRES_PASSWORD: CHANGE_ME", "POSTGRES_PASSWORD: 8tc6vr89"),
    (f"POSTGRES_USER: {name}", "POSTGRES_USER: coolify"),
]
for old, new in pairs:
    if old in text:
        text = text.replace(old, new)
        print("patched:", old.split(":", 1)[0])
    else:
        print("skip (absent):", old)
p.write_text(text)
PY

echo "=== 5. Recreate DevForge stack ==="
docker update --restart=no coolify-db || true
docker update --restart=no coolify-redis || true
docker stop coolify-realtime || true
docker update --restart=no coolify-realtime || true

cd "$COMPOSE_DIR"
sudo docker compose up -d db redis realtime api

echo "=== 6. Wait Postgres ==="
READY=0
for i in $(seq 1 30); do
  if docker exec "$DF_DB" pg_isready -U coolify -d coolify >/dev/null 2>&1; then
    echo "$DF_DB ready"
    READY=1
    break
  fi
  sleep 2
done
if [ "$READY" != "1" ]; then
  echo "WARN: postgres not ready yet"
  docker logs --tail 30 "$DF_DB" || true
  exit 1
fi

echo "=== 7. Verify ==="
docker exec "$DF_DB" psql -U coolify -d coolify -c "SELECT count(*) AS tables FROM information_schema.tables WHERE table_schema='public';"
docker ps --filter name=devforge --format 'table {{.Names}}\t{{.Status}}'
echo "Done. Backup: $BACKUP_DIR/coolify-postgress-$DATE.tar.gz"
echo "NOTE: coolify-db / coolify-redis / coolify-realtime restent arretes (ports partages)."
