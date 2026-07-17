#!/bin/bash
set -eu
APP="$(docker ps --filter name=julfme7qvjx8tzzypz6qzea0 --format '{{.Names}}' | head -1)"
TOKEN="$(docker exec "${APP}" printenv TURSO_AUTH_TOKEN)"
echo "app=${APP} token_len=${#TOKEN}"

docker exec "${APP}" sh -c 'cat > /tmp/q.json <<EOF
{"requests":[{"type":"execute","stmt":{"sql":"select count(*) as c from users"}},{"type":"execute","stmt":{"sql":"select count(*) as c from prototypes"}},{"type":"close"}]}
EOF'

echo "with_auth:"
docker exec "${APP}" wget -qO- --timeout=15 \
  --user=libsql \
  --password="${TOKEN}" \
  --header='Content-Type: application/json' \
  --post-file=/tmp/q.json \
  http://btnfrll4ubmua4nvk73y4h6u:8080/v2/pipeline || echo "wget_failed:$?"
echo

echo "healthcheck_sim:"
docker exec btnfrll4ubmua4nvk73y4h6u sh -c \
  "wget --spider -q --http-user=libsql --http-password='${TOKEN}' http://127.0.0.1:8080/v2/pipeline && echo OK || echo FAIL_root; wget -qO- --http-user=libsql --http-password='${TOKEN}' --header='Content-Type: application/json' --post-data='{\"requests\":[{\"type\":\"execute\",\"stmt\":{\"sql\":\"select 1\"}},{\"type\":\"close\"}]}' http://127.0.0.1:8080/v2/pipeline; echo"
