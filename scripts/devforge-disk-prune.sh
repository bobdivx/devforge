#!/usr/bin/env bash
# Post-deploy disk hygiene for DevForge NAS hosts.
# Frees dangling images / build cache and warns when Docker volume is low.
set -euo pipefail

DISK_PATH="${DEVFORGE_DISK_PATH:-/media/Docker}"
WARN_GB="${DEVFORGE_DISK_WARN_GB:-20}"

echo "==> DevForge disk prune ($(date -u +%Y-%m-%dT%H:%M:%SZ))"

df -h "${DISK_PATH}" || true

# Drop dangling images (intermediate *-build layers)
docker image prune -f || true

# Drop unused images older than 72h (keeps running stack images)
docker image prune -a -f --filter "until=72h" || true

# Build cache (may need root on some NAS setups)
if docker builder prune -af >/dev/null 2>&1; then
  echo "builder prune: ok"
else
  echo "builder prune: skipped (permission or unsupported)"
fi

# Stopped containers
docker container prune -f || true

df -h "${DISK_PATH}" || true

# Warn if free space below threshold (portable GB parse)
avail_kb="$(df -Pk "${DISK_PATH}" 2>/dev/null | awk 'NR==2 {print $4}')"
if [[ -n "${avail_kb}" ]]; then
  avail_gb=$((avail_kb / 1024 / 1024))
  echo "Free on ${DISK_PATH}: ${avail_gb}G (warn < ${WARN_GB}G)"
  if (( avail_gb < WARN_GB )); then
    echo "WARNING: low disk on ${DISK_PATH} — prune deployments / old app images manually." >&2
  fi
fi

echo "==> Disk prune done"
