#!/bin/sh
set -eu
APP=$(docker ps --filter name=julfme7qvjx8tzzypz6qzea0 --format '{{.Names}}' | head -1)
echo "APP=$APP"
docker cp /tmp/nas-probe-libsql-auth.mjs "$APP":/tmp/nas-probe-libsql-auth.mjs
docker exec -w /app "$APP" node /tmp/nas-probe-libsql-auth.mjs
echo "=== SQLD_HTTP_AUTH in db container ==="
docker exec btnfrll4ubmua4nvk73y4h6u sh -c 'printenv SQLD_HTTP_AUTH' | sed 's/:.*/:***/'
echo "=== authToken usage in @libsql/client ==="
docker exec "$APP" sh -c 'grep -R "Authorization\|authToken\|Bearer\|Basic" -n node_modules/@libsql/client/lib-esm/*.js 2>/dev/null | head -50' || true
