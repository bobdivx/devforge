#!/bin/bash
set -eu
TOKEN="$(docker exec "$(docker ps --filter name=julfme7qvjx8tzzypz6qzea0 --format '{{.Names}}' | head -1)" printenv TURSO_AUTH_TOKEN)"
echo "token_len=${#TOKEN}"

BODY='{"requests":[{"type":"execute","stmt":{"sql":"select count(*) as c from users"}},{"type":"execute","stmt":{"sql":"select count(*) as c from prototypes"}},{"type":"execute","stmt":{"sql":"select count(*) as c from videos"}},{"type":"close"}]}'

docker run --rm --network coolify curlimages/curl:8.5.0 -sS \
  -u "libsql:${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "${BODY}" \
  http://btnfrll4ubmua4nvk73y4h6u:8080/v2/pipeline
echo

# TCP liveness from inside DB container
docker exec btnfrll4ubmua4nvk73y4h6u sh -c 'ls /bin; command -v curl; command -v wget; command -v bash; (echo >/dev/tcp/127.0.0.1/8080) >/dev/null 2>&1 && echo TCP_OK || echo TCP_FAIL'
