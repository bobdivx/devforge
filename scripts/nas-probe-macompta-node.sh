#!/bin/sh
set -eu
APP=$(docker ps --filter name=wyo3a2eut7kknr0tii0uvfur --format '{{.Names}}' | head -1)
echo "APP=$APP"
docker inspect "$APP" --format 'cmd={{json .Config.Cmd}} entry={{json .Config.Entrypoint}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}'
echo "=== logs ==="
docker logs --tail 80 "$APP" 2>&1 | tail -80
echo "=== ports/env ==="
docker exec "$APP" sh -c 'printenv PORT; printenv HOST; printenv NODE_ENV; ls -la /app/dist/server 2>/dev/null | head; ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null || true'
echo "=== http ==="
docker exec "$APP" sh -c 'wget -S -O- --timeout=5 http://127.0.0.1:80/ 2>&1 | head -40; echo ---; wget -S -O- --timeout=5 http://127.0.0.1:4321/ 2>&1 | head -20'
