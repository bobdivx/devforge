#!/bin/sh
set -eu
APP=$(docker ps --filter name=julfme7qvjx8tzzypz6qzea0 --format '{{.Names}}' | head -1)
echo "APP=$APP"
echo "=== image/created ==="
docker inspect "$APP" --format 'created={{.Created}} image={{.Config.Image}}'
echo "=== recent turso logs ==="
docker logs --since 10m "$APP" 2>&1 | grep -iE 'turso|fetch failed' | tail -20 || echo '(aucune erreur turso récente)'
echo "=== smoke select via fixed client ==="
docker cp /tmp/nas-probe-libsql-fixed.mjs "$APP":/tmp/nas-probe-libsql-fixed.mjs
docker exec -w /app "$APP" node /tmp/nas-probe-libsql-fixed.mjs
echo "=== check built turso helper contains Basic ==="
docker exec "$APP" sh -c 'grep -R "Basic\|isSelfHostedLibsqlUrl\|resolveLibsqlClientOptions" -l /app/dist /app/.output /app/server 2>/dev/null | head -10 || true; ls /app | head -20'
