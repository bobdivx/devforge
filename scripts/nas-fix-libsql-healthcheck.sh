#!/bin/bash
set -euo pipefail

DB_UUID="btnfrll4ubmua4nvk73y4h6u"
COMPOSE="/media/Docker/AppData/coolify/data/databases/${DB_UUID}/docker-compose.yml"

echo "==> Test bash /dev/tcp inside container"
docker exec "${DB_UUID}" bash -c 'exec 3<>/dev/tcp/127.0.0.1/8080 && echo TCP_OK' || echo TCP_FAIL

echo "==> Patch healthcheck in compose"
python3 - <<'PY'
from pathlib import Path
import re
path = Path("/media/Docker/AppData/coolify/data/databases/btnfrll4ubmua4nvk73y4h6u/docker-compose.yml")
text = path.read_text()
# Replace wget healthcheck test block with bash tcp probe
new_test = """        healthcheck:
            test:
                - CMD-SHELL
                - 'bash -c \"exec 3<>/dev/tcp/127.0.0.1/8080\" || exit 1'
"""
pattern = r"        healthcheck:\n(?:            .*\n)+?"
# more precise: from healthcheck to mem_limit
pattern = r"        healthcheck:\n(?:            .*\n)*?(?=        mem_limit:)"
text2, n = re.subn(pattern, new_test, text, count=1)
if n != 1:
    raise SystemExit(f"healthcheck patch failed matches={n}")
path.write_text(text2)
print("patched")
PY

echo "==> Recreate container"
docker compose -f "${COMPOSE}" up -d --force-recreate

for i in $(seq 1 20); do
  status="$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${DB_UUID}")"
  echo "t=${i} ${status}"
  if [ "${status}" = "running healthy" ]; then
    break
  fi
  sleep 3
done

# Refresh Coolify DB status via check if available
docker exec -w /var/www/html coolify php /tmp/nas-refresh-libsql-status.php 2>/dev/null || true
