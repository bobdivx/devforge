#!/bin/sh
# Affiche sur la console TTY les URL LAN de DevForge (port 8000).
set -eu

PORT="${DEVFORGE_HTTP_PORT:-8000}"
HOSTNAME_FQDN="$(hostname 2>/dev/null || echo devforge)"

ips=""
if command -v ip >/dev/null 2>&1; then
  ips="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | tr '\n' ' ')"
fi
if [ -z "$ips" ] && command -v hostname >/dev/null 2>&1; then
  ips="$(hostname -I 2>/dev/null || true)"
fi

{
  echo ""
  echo "============================================================"
  echo "  DevForge Node — $HOSTNAME_FQDN"
  echo "============================================================"
  if [ -n "$ips" ]; then
    for ip in $ips; do
      echo "  →  http://${ip}:${PORT}"
    done
  else
    echo "  (pas d’IP LAN encore — DHCP en cours ?)"
  fi
  echo ""
  echo "  Navigateur : ouvre l’URL ci-dessus"
  echo "  Worker     : sur le leader → Cluster → Trouver des nœuds"
  echo "============================================================"
  echo ""
} | tee /dev/tty1 2>/dev/null || true

# Aussi dans le journal systemd
logger -t devforge-node "ready — http://<lan>:${PORT} — hostname=${HOSTNAME_FQDN}" || true
