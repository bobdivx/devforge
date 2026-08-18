#!/usr/bin/env bash
# Install host-level disk guard (cron) on the NAS.
# Usage (from repo on NAS, or after scp):
#   bash scripts/nas-install-host-disk-guard.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="${ROOT}/nas-host-disk-guard.sh"
EXPORT_PHP="${ROOT}/nas-export-disk-webhook.php"
BIN_DIR=/DATA/.devforge/bin
LOG_DIR=/DATA/.devforge/logs
STATE_DIR=/DATA/.devforge/state
CRON_FILE=/etc/cron.d/devforge-disk-guard
ENV_FILE="${STATE_DIR}/disk-guard.env"
API="${DEVFORGE_API_CONTAINER:-devforge-api}"

if [[ ! -f "${SRC}" ]]; then
  echo "missing ${SRC}" >&2
  exit 1
fi

sudo mkdir -p "${BIN_DIR}" "${LOG_DIR}" "${STATE_DIR}"
sudo sed -i 's/\r$//' "${SRC}"
sudo install -m 0755 "${SRC}" "${BIN_DIR}/disk-guard.sh"

if [[ -f "${EXPORT_PHP}" ]] && docker inspect "${API}" >/dev/null 2>&1; then
  sudo sed -i 's/\r$//' "${EXPORT_PHP}"
  docker cp "${EXPORT_PHP}" "${API}:/tmp/nas-export-disk-webhook.php"
  tmp_env="$(mktemp)"
  if docker exec -w /var/www/html "${API}" php /tmp/nas-export-disk-webhook.php >"${tmp_env}" 2>/tmp/disk-guard-export.err; then
    if grep -q '^DEVFORGE_DISK_WEBHOOK_URL=https://' "${tmp_env}" || grep -q '^DEVFORGE_DISK_TELEGRAM_BOT_TOKEN=' "${tmp_env}"; then
      sudo install -m 0600 "${tmp_env}" "${ENV_FILE}"
      echo "alert credentials written to ${ENV_FILE}"
    else
      echo "export produced no credentials; keeping existing env if any" >&2
      cat /tmp/disk-guard-export.err >&2 || true
    fi
  else
    echo "could not export DevForge notification credentials (API down or none configured)" >&2
    cat /tmp/disk-guard-export.err >&2 || true
  fi
  rm -f "${tmp_env}"
fi

sudo tee "${CRON_FILE}" >/dev/null <<'EOF'
# DevForge / ZimaOS: keep /media/Docker from hitting ENOSPC.
# Runs on the host so it still works when Postgres/DevForge are down.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/10 * * * * root /DATA/.devforge/bin/disk-guard.sh >> /DATA/.devforge/logs/disk-guard.log 2>&1
EOF
sudo chmod 644 "${CRON_FILE}"

channels=none
if [[ -f "${ENV_FILE}" ]]; then
  channels=()
  grep -q '^DEVFORGE_DISK_WEBHOOK_URL=' "${ENV_FILE}" && channels+=(discord)
  grep -q '^DEVFORGE_DISK_TELEGRAM_BOT_TOKEN=' "${ENV_FILE}" && channels+=(telegram)
  channels="${channels[*]:-none}"
fi

echo "installed ${BIN_DIR}/disk-guard.sh + ${CRON_FILE} (alerts: ${channels})"
sudo "${BIN_DIR}/disk-guard.sh" || true
df -h /media/Docker | head -2
