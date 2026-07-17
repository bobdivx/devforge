#!/bin/sh
set -eu
APP=$(docker ps --filter name=julfme7qvjx8tzzypz6qzea0 --format '{{.Names}}' | head -1)
echo "APP=$APP"
docker cp /tmp/nas-probe-libsql-client.mjs "$APP":/tmp/nas-probe-libsql-client.mjs
docker exec "$APP" node /tmp/nas-probe-libsql-client.mjs
