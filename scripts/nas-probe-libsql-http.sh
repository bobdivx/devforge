#!/bin/bash
set -euo pipefail

DB_HOST="btnfrll4ubmua4nvk73y4h6u"
APP="$(docker ps --filter name=julfme7qvjx8tzzypz6qzea0 --format '{{.Names}}' | head -1)"
TOKEN="$(docker exec "${APP}" printenv TURSO_AUTH_TOKEN)"

echo "app=${APP}"
echo "token_len=${#TOKEN}"
echo "db_status=$(docker inspect --format '{{.State.Status}}' "${DB_HOST}")"
echo "db_health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${DB_HOST}")"

# Auth check on /v2/pipeline
BODY='{"requests":[{"type":"execute","stmt":{"sql":"select count(*) as c from users"}},{"type":"execute","stmt":{"sql":"select count(*) as c from prototypes"}},{"type":"execute","stmt":{"sql":"select count(*) as c from videos"}},{"type":"close"}]}'

RESP="$(docker exec "${APP}" wget -qO- --timeout=15 \
  --user=libsql --password="${TOKEN}" \
  --header='Content-Type: application/json' \
  --post-data="${BODY}" \
  "http://${DB_HOST}:8080/v2/pipeline" || true)"

echo "pipeline_response=${RESP}"

# Unauthorized check
CODE="$(docker exec "${APP}" wget -qS -O /dev/null --timeout=5 "http://${DB_HOST}:8080/v2/pipeline" 2>&1 | awk '/HTTP\//{print $2}' | tail -1 || true)"
echo "unauth_code=${CODE}"
