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
# Optional alerts (Discord webhook and/or Telegram):
#   /DATA/.devforge/state/disk-guard.env
#     DEVFORGE_DISK_WEBHOOK_URL=https://discord.com/api/webhooks/...
#     DEVFORGE_DISK_TELEGRAM_BOT_TOKEN=...
#     DEVFORGE_DISK_TELEGRAM_CHAT_ID=...
#
# Install:
#   bash scripts/nas-install-host-disk-guard.sh
set -euo pipefail

DISK_PATH="${DEVFORGE_DISK_PATH:-/media/Docker}"
WARN_PCT="${DEVFORGE_DISK_WARN_PCT:-80}"
CRITICAL_PCT="${DEVFORGE_DISK_CRITICAL_PCT:-85}"
EMERGENCY_PCT="${DEVFORGE_DISK_EMERGENCY_PCT:-92}"
MIN_FREE_GB="${DEVFORGE_DISK_MIN_FREE_GB:-25}"
LOG_DIR="${DEVFORGE_DISK_LOG_DIR:-/DATA/.devforge/logs}"
STATE_DIR="${DEVFORGE_DISK_STATE_DIR:-/DATA/.devforge/state}"
ENV_FILE="${DEVFORGE_DISK_ENV_FILE:-${STATE_DIR}/disk-guard.env}"
LOCK_FILE="${STATE_DIR}/disk-guard.lock"
ALERT_FLAG="${STATE_DIR}/alert.active"
DOCKER_CONFIG_DIR="${DOCKER_CONFIG:-/tmp/docker-config-disk-guard}"
WARN_COOLDOWN_SEC="${DEVFORGE_DISK_WARN_COOLDOWN_SEC:-21600}"
EMERGENCY_COOLDOWN_SEC="${DEVFORGE_DISK_EMERGENCY_COOLDOWN_SEC:-3600}"

mkdir -p "${LOG_DIR}" "${STATE_DIR}" "${DOCKER_CONFIG_DIR}"
export DOCKER_CONFIG="${DOCKER_CONFIG_DIR}"

if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi

WEBHOOK_URL="${DEVFORGE_DISK_WEBHOOK_URL:-}"
TELEGRAM_BOT_TOKEN="${DEVFORGE_DISK_TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${DEVFORGE_DISK_TELEGRAM_CHAT_ID:-}"

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { echo "[$(ts)] $*"; }
now_epoch() { date +%s; }

json_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/}
  printf '%s' "$s"
}

notify() {
  local msg="$1"
  log "NOTIFY: ${msg}"

  if [[ -n "${WEBHOOK_URL}" ]]; then
    local payload
    payload=$(printf '{"username":"DevForge Disk Guard","content":"%s"}' "$(json_escape "${msg}")")
    curl -fsS -X POST -H 'Content-Type: application/json' \
      -H 'User-Agent: DevForge-DiskGuard/1.0' \
      --data "${payload}" "${WEBHOOK_URL}" >/dev/null 2>&1 || log "discord notify failed"
  fi

  if [[ -n "${TELEGRAM_BOT_TOKEN}" && -n "${TELEGRAM_CHAT_ID}" ]]; then
    curl -fsS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${msg}" >/dev/null 2>&1 || log "telegram notify failed"
  fi
}

last_notify_age() {
  local key=$1
  local file="${STATE_DIR}/last-notify-${key}"
  if [[ ! -f "${file}" ]]; then
    echo 999999999
    return
  fi
  local last
  last=$(cat "${file}" 2>/dev/null || echo 0)
  echo $(( $(now_epoch) - last ))
}

mark_notify() {
  now_epoch > "${STATE_DIR}/last-notify-$1"
}

notify_throttled() {
  local key=$1
  local cooldown=$2
  local msg=$3
  local age
  age=$(last_notify_age "${key}")
  if (( age < cooldown )); then
    log "skip ${key} notify (cooldown ${cooldown}s, last ${age}s ago)"
    return
  fi
  notify "${msg}"
  mark_notify "${key}"
}

notify_recovery_if_needed() {
  if [[ -f "${ALERT_FLAG}" ]]; then
    notify "DevForge NAS : ${DISK_PATH} est revenu sous les seuils (${PCT}% / ${FREE_GB}G libres)."
    rm -f "${ALERT_FLAG}" "${STATE_DIR}/last-notify-warn" "${STATE_DIR}/last-notify-emergency" "${STATE_DIR}/last-notify-stuck"
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

if [[ "${1:-}" == "--test" ]]; then
  PCT="$(usage_pct)"
  FREE_GB="$(free_gb)"
  notify "Test alerte disque DevForge NAS : ${DISK_PATH} à ${PCT}% (${FREE_GB}G libres). Garde-fou hôte OK."
  exit 0
fi

exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  log "another disk-guard run is active; exiting"
  exit 0
fi

PCT="$(usage_pct)"
FREE_GB="$(free_gb)"
log "disk ${DISK_PATH}: ${PCT}% used, ${FREE_GB}G free (warn=${WARN_PCT} critical=${CRITICAL_PCT} emergency=${EMERGENCY_PCT} min_free=${MIN_FREE_GB}G)"

if (( PCT < WARN_PCT && FREE_GB >= MIN_FREE_GB )); then
  notify_recovery_if_needed
  exit 0
fi

touch "${ALERT_FLAG}"

if (( PCT >= WARN_PCT || FREE_GB < MIN_FREE_GB )); then
  notify_throttled warn "${WARN_COOLDOWN_SEC}" \
    "DevForge NAS disque bas : ${DISK_PATH} à ${PCT}% (${FREE_GB}G libres). Seuil ${WARN_PCT}% / ${MIN_FREE_GB}G."
fi

safe_prune_light() {
  log "light prune: dangling images + builder cache"
  docker image prune -f >/dev/null 2>&1 || true
  docker builder prune -af >/dev/null 2>&1 || true
  if [[ -d /DATA/.docker ]]; then
    DOCKER_CONFIG=/DATA/.docker docker buildx prune -af >/dev/null 2>&1 || true
  fi
}

safe_prune_containers() {
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
  log "truncate container json logs > 200MiB"
  find /var/lib/docker/containers -name '*-json.log' -size +209715200c -print0 2>/dev/null \
    | while IFS= read -r -d '' f; do
        truncate -s 0 "${f}" && log "truncated ${f}"
      done || true
}

safe_prune_light

if (( PCT >= CRITICAL_PCT || FREE_GB < MIN_FREE_GB )); then
  safe_prune_containers
  truncate_huge_json_logs
fi

if (( PCT >= EMERGENCY_PCT || FREE_GB < 10 )); then
  safe_prune_images
  notify_throttled emergency "${EMERGENCY_COOLDOWN_SEC}" \
    "DevForge NAS URGENCE prune : ${DISK_PATH} était à ${PCT}% / ${FREE_GB}G libres."
fi

PCT_AFTER="$(usage_pct)"
FREE_AFTER="$(free_gb)"
log "after cleanup: ${PCT_AFTER}% used, ${FREE_AFTER}G free"

if (( PCT_AFTER >= EMERGENCY_PCT || FREE_AFTER < 10 )); then
  notify_throttled stuck "${EMERGENCY_COOLDOWN_SEC}" \
    "DevForge NAS TOUJOURS CRITIQUE après prune : ${DISK_PATH} ${PCT_AFTER}% (${FREE_AFTER}G libres). Action manuelle requise."
  exit 2
fi
