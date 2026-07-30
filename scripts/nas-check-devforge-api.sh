#!/usr/bin/env bash
set -euo pipefail
C=devforge-api
echo "=== env ==="
docker exec "$C" printenv | sort | grep -E '^(DB_|REDIS_|APP_|PUSHER_|SESSION_)'
echo "=== laravel.log ==="
docker exec "$C" sh -c 'tail -100 /var/www/html/storage/logs/laravel.log' || true
echo "=== tables sample ==="
docker exec devforge-db psql -U coolify -d coolify -c '\dt' 2>/dev/null | head -20 || docker exec devforge-db psql -U coolify -d coolify -c '\dt' | head -20
