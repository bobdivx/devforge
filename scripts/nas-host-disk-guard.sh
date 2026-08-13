#!/usr/bin/env bash
# Host-level disk guard for ZimaOS /media/Docker.
# MUST run outside DevForge (cron/systemd): when the disk is full, Postgres dies
# and Laravel jobs cannot free space.
#
# Safe by design:
# - never unfiltered `docker container prune`
# - never deletes named critical containers/images
# - never touches AppData bind mounts or media libraries
#
# Install (once, as root on NAS):
#   install -m 0755 scripts/nas-host-disk-guard.sh /DATA/.devforge/bin/disk-guard.sh
#   echo '*/10 * * * * root /DATA/.devforge/bin/disk-guard.sh >> /DATA/.devforge/logs/disk-guard.log 2>&1' \
#     > /etc/cron.d/devforge-disk-guard
set -euo pipefail

DISK_PATH="${DEVFORGE_DISK_PATH:-/media/Docker}"
WARN_PCT="${DEVFORGE_DISK_WARN_PCT:-80}"
CRITICAL_PCT="${DEVFORGE_DISK_CRITICAL_PCT:-85}"
EMERGENCY_PCT="${DEVFORGE_DISK_EMERGENCY_PCT:-92}"
MIN_FREE_GB="${DEVFORGE_DISK_MIN_FREE_GB:-25}"
LOG_DIR="${DEVFORGE_DISK_LOG_DIR:-/DATA/.devforge/logs}"
STATE_DIR="${DEVFORGE_DISK_STATE_DIR:-/DATA/.devforge/state}"
LOCK_FILE="${STATE_DIR}/disk-guard.lock"
WEBHOOK_URL="${DEVFORGE_DISK_WEBHOOK_URL:-}"
DOCKER_CONFIG_DIR="${DOCKER_CONFIG:-/tmp/docker-config-disk-guard}"

mkdir -p "${LOG_DIR}" "${STATE_DIR}" "${DOCKER_CONFIG_DIR}"
export DOCKER_CONFIG="${DOCKER_CONFIG_DIR}"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "[$(ts)] $*"; }

notify() {
  local msg="$1"
  log "NOTIFY: ${msg}"
  if [[ -n "${WEBHOOK_URL}" ]]; then
    curl -fsS -X POST -H 'Content-Type: application/json' \
      -d "{\"content\":\"${msg}\"}" "${WEBHOOK_URL}" >/dev/null 2>&1 || true
  fi
}

usage_pct() {
  df -P "${DISK_PATH}" | awk 'NR==2 {gsub(/%/,"",$5); print $5}'
}

free_gb() {
  local avail_kb
  avail_kb="$(df -Pk "${DISK_PATH}" | awk 'NR==2 {print $4}')"
  echo $((avail_kb / 1024 / 1024))
}

# Avoid concurrent runs (cron overlap / manual).
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  log "another disk-guard run is active; exiting"
  exit 0
fi

PCT="$(usage_pct)"
FREE_GB="$(free_gb)"
log "disk ${DISK_PATH}: ${PCT}% used, ${FREE_GB}G free (warn=${WARN_PCT} critical=${CRITICAL_PCT} emergency=${EMERGENCY_PCT} min_free=${MIN_FREE_GB}G)"

if (( PCT < WARN_PCT && FREE_GB >= MIN_FREE_GB )); then
  exit 0
fi

if (( PCT >= WARN_PCT || FREE_GB < MIN_FREE_GB )); then
  notify "DevForge NAS disk warning: ${DISK_PATH} at ${PCT}% (${FREE_GB}G free)"
fi

# --- safe cleanup tiers ---
safe_prune_light() {
  log "light prune: dangling images + builder cache"
  docker image prune -f >/dev/null 2>&1 || true
  docker builder prune -af >/dev/null 2>&1 || true
  # Prefer CasaOS/Zima docker config for buildx when available.
  if [[ -d /DATA/.docker ]]; then
    DOCKER_CONFIG=/DATA/.docker docker buildx prune -af >/dev/null 2>&1 || true
  fi
}

safe_prune_containers() {
  # ONLY Coolify/DevForge managed ephemeral containers — never platform DBs.
  log "safe container prune (coolify.managed, exclude db/app/service/proxy)"
  docker container prune -f \
    --filter 'label=coolify.managed=true' \
    --filter 'label!=coolify.proxy=true' \
    --filter 'label!=coolify.type=database' \
    --filter 'label!=coolify.type=application' \
    --filter 'label!=coolify.type=service' >/dev/null 2>&1 || true
}

safe_prune_images() {
  log "image prune: unused older than 72h (keeps running)"
  docker image prune -a -f --filter 'until=72h' >/dev/null 2>&1 || true
}

truncate_huge_json_logs() {
  # Container json logs can grow without bound on some NAS setups.
  log "truncate container json logs > 200MiB"
  find /var/lib/docker/containers -name '*-json.log' -size +209715200c -print0 2>/dev/null \
    | while IFS= read -r -d '' f; do
        truncate -s 0 "${f}" && log "truncated ${f}"
      done || true
}

# Always run light prune when warned.
safe_prune_light

if (( PCT >= CRITICAL_PCT || FREE_GB < MIN_FREE_GB )); then
  safe_prune_containers
  truncate_huge_json_logs
fi

if (( PCT >= EMERGENCY_PCT || FREE_GB < 10 )); then
  safe_prune_images
  notify "DevForge NAS disk EMERGENCY prune ran: ${DISK_PATH} was ${PCT}% / ${FREE_GB}G free"
fi

PCT_AFTER="$(usage_pct)"
FREE_AFTER="$(free_gb)"
log "after cleanup: ${PCT_AFTER}% used, ${FREE_AFTER}G free"

if (( PCT_AFTER >= EMERGENCY_PCT || FREE_AFTER < 10 )); then
  notify "DevForge NAS disk STILL CRITICAL after prune: ${DISK_PATH} ${PCT_AFTER}% (${FREE_AFTER}G free). Manual action required (media/AppData)."
  exit 2
fi
