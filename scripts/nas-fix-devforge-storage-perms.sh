#!/usr/bin/env bash
set -euo pipefail
DF=devforge-api
docker exec -u root "$DF" bash -c '
  mkdir -p /var/www/html/storage/logs \
    /var/www/html/storage/framework/cache \
    /var/www/html/storage/framework/sessions \
    /var/www/html/storage/framework/views \
    /var/www/html/bootstrap/cache \
    /data
  chown -R 9999:9999 /var/www/html/storage /var/www/html/bootstrap/cache /data
  chmod -R ug+rwX /var/www/html/storage /var/www/html/bootstrap/cache /data
'
docker restart "$DF"
sleep 12
docker ps --filter name=devforge-api --format '{{.Names}} {{.Status}}'
echo '--- env ---'
docker exec "$DF" printenv | grep -E '^(DB_|APP_KEY|APP_NAME)='
echo '--- http ---'
curl -sI http://127.0.0.1:8080/login | head -8
echo '--- logs ---'
docker logs --tail 15 "$DF" 2>&1
