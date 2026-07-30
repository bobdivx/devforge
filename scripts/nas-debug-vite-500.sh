#!/usr/bin/env bash
set -euo pipefail
C=devforge-api

echo "=== pwd / html ==="
docker exec "$C" sh -c 'pwd; ls -la /var/www/html | head -30'

echo "=== public ==="
docker exec "$C" sh -c 'ls -la /var/www/html/public | head -40'

echo "=== public/build ==="
docker exec "$C" sh -c 'ls -la /var/www/html/public/build 2>&1 | head -20; test -f /var/www/html/public/build/manifest.json && echo MANIFEST_OK || echo MANIFEST_MISSING'

echo "=== storage mounts ==="
docker exec "$C" sh -c 'ls -la /var/www/html/storage 2>&1 | head -20; ls -la /var/www/html/storage/framework 2>&1 | head -20; ls -la /var/www/html/bootstrap/cache 2>&1 | head -10'

echo "=== mounts ==="
docker inspect "$C" --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'

echo "=== latest vite/cache errors ==="
docker exec "$C" sh -c 'grep -E "ViteException|Unable to locate|cache path|Permission denied" /var/www/html/storage/logs/laravel.log 2>/dev/null | tail -30 || echo no-log'

echo "=== curl login ==="
curl -sI https://web.briseteia.me/login 2>/dev/null | head -15 || curl -sI http://127.0.0.1:8080/login | head -15
