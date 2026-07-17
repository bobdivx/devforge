#!/bin/sh
set -eu
APP=$(docker ps --filter name=julfme7qvjx8tzzypz6qzea0 --format '{{.Names}}' | head -1)
echo "APP=$APP"
docker cp /tmp/nas-probe-libsql-fixed.mjs "$APP":/tmp/nas-probe-libsql-fixed.mjs
docker exec -w /app "$APP" node /tmp/nas-probe-libsql-fixed.mjs
