#!/bin/bash
set -euo pipefail

DB_UUID="btnfrll4ubmua4nvk73y4h6u"
VOLUME="libsql-data-${DB_UUID}"
COMPOSE_DIR="/media/Docker/AppData/coolify/data/databases/${DB_UUID}"

echo "==> Stop crash-loop container"
docker stop -t 5 "${DB_UUID}" 2>/dev/null || true
docker rm -f "${DB_UUID}" 2>/dev/null || true

echo "==> Extract flat import and bootstrap modern sqld layout"
docker run --rm -v "${VOLUME}:/var/lib/sqld" alpine:3.20 sh -c '
  set -e
  cd /var/lib/sqld
  ls -lah
  if [ -f data.db ]; then
    mv data.db /var/lib/sqld/.imported-flat.db
    rm -f data.db-wal data.db-shm
    echo "Saved flat import as .imported-flat.db"
  elif [ -f .imported-flat.db ]; then
    echo "Reuse existing .imported-flat.db"
  elif [ -f data.db/dbs/default/data ]; then
    echo "Modern layout already present with data"
    exit 0
  else
    echo "No import candidate found"; ls -lahR; exit 1
  fi
'

# Bootstrap empty directory layout with a short-lived sqld
docker run --rm -d --name "${DB_UUID}-bootstrap" \
  -v "${VOLUME}:/var/lib/sqld" \
  -e SQLD_NODE=primary \
  -e SQLD_DB_PATH=data.db \
  -e SQLD_HTTP_LISTEN_ADDR=0.0.0.0:8080 \
  ghcr.io/tursodatabase/libsql-server:latest >/dev/null

for i in $(seq 1 20); do
  if docker exec "${DB_UUID}-bootstrap" sh -c 'test -f /var/lib/sqld/data.db/dbs/default/data'; then
    echo "Bootstrap layout ready (t=${i})"
    break
  fi
  sleep 1
done

docker stop -t 3 "${DB_UUID}-bootstrap" >/dev/null 2>&1 || true
docker rm -f "${DB_UUID}-bootstrap" >/dev/null 2>&1 || true

echo "==> Inject imported SQLite into dbs/default/data"
docker run --rm -v "${VOLUME}:/var/lib/sqld" alpine:3.20 sh -c '
  set -e
  cd /var/lib/sqld
  test -f .imported-flat.db
  test -d data.db/dbs/default
  rm -f data.db/dbs/default/data data.db/dbs/default/data-wal data.db/dbs/default/data-shm
  cp .imported-flat.db data.db/dbs/default/data
  apk add --no-cache sqlite >/dev/null
  echo -n "integrity="
  sqlite3 data.db/dbs/default/data "PRAGMA integrity_check;"
  sqlite3 data.db/dbs/default/data "SELECT COUNT(*) AS users FROM users; SELECT COUNT(*) AS prototypes FROM prototypes; SELECT COUNT(*) AS videos FROM videos;"
  ls -lah data.db/dbs/default/
'

echo "==> Start libsql via compose"
docker compose -f "${COMPOSE_DIR}/docker-compose.yml" up -d

echo "==> Wait for container"
for i in $(seq 1 30); do
  status="$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}nohealth{{end}}' "${DB_UUID}" 2>/dev/null || echo missing)"
  echo "t=${i} ${status}"
  case "${status}" in
    "running healthy"|"running nohealth")
      break
      ;;
  esac
  # still crash-looping?
  if echo "${status}" | grep -q Restarting; then
    echo "Still restarting — logs:"
    docker logs --tail 20 "${DB_UUID}" 2>&1 || true
  fi
  sleep 3
done

echo "==> Final logs"
docker logs --tail 40 "${DB_UUID}" 2>&1 || true

echo "==> Network probe from app"
APP="$(docker ps --filter name=julfme7qvjx8tzzypz6qzea0 --format '{{.Names}}' | head -1)"
echo "app=${APP}"
if [ -n "${APP}" ]; then
  docker exec "${APP}" sh -c 'getent hosts btnfrll4ubmua4nvk73y4h6u || true'
  TOKEN="$(docker exec "${APP}" printenv TURSO_AUTH_TOKEN || true)"
  docker exec "${APP}" sh -c "wget -qO- --timeout=5 http://btnfrll4ubmua4nvk73y4h6u:8080/ 2>&1 | head -c 200; echo"
  if [ -n "${TOKEN}" ]; then
    docker exec "${APP}" wget -qO- --timeout=5 --user=libsql --password="${TOKEN}" "http://btnfrll4ubmua4nvk73y4h6u:8080/v2/pipeline" 2>&1 | head -c 200 || true
    echo
  fi
  docker exec "${APP}" sh -c 'printenv TURSO_DATABASE_URL; printenv LIBSQL_URL' | sed 's/:[^:@]*@/:***@/g'
fi

echo "DONE"
