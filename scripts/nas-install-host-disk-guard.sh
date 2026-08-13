#!/usr/bin/env bash
# Install host-level disk guard (cron) on the NAS.
# Usage (from repo on NAS, or after scp):
#   bash scripts/nas-install-host-disk-guard.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="${ROOT}/nas-host-disk-guard.sh"
BIN_DIR=/DATA/.devforge/bin
LOG_DIR=/DATA/.devforge/logs
STATE_DIR=/DATA/.devforge/state
CRON_FILE=/etc/cron.d/devforge-disk-guard

if [[ ! -f "${SRC}" ]]; then
  echo "missing ${SRC}" >&2
  exit 1
fi

sudo mkdir -p "${BIN_DIR}" "${LOG_DIR}" "${STATE_DIR}"
sudo sed -i 's/\r$//' "${SRC}"
sudo install -m 0755 "${SRC}" "${BIN_DIR}/disk-guard.sh"

sudo tee "${CRON_FILE}" >/dev/null <<'EOF'
# DevForge / ZimaOS: keep /media/Docker from hitting ENOSPC.
# Runs on the host so it still works when Postgres/DevForge are down.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/10 * * * * root /DATA/.devforge/bin/disk-guard.sh >> /DATA/.devforge/logs/disk-guard.log 2>&1
EOF
sudo chmod 644 "${CRON_FILE}"

echo "installed ${BIN_DIR}/disk-guard.sh + ${CRON_FILE}"
sudo "${BIN_DIR}/disk-guard.sh" || true
df -h /media/Docker | head -2
