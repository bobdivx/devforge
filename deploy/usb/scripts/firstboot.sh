#!/bin/sh
# First-boot / every-boot helpers for the DevForge USB appliance.
set -eu

OPT_DIR="${DEVFORGE_OPT_DIR:-/opt/devforge}"
DATA_DIR="${DEVFORGE_DATA_DIR:-/var/lib/devforge}"
COMPOSE_FILE="${OPT_DIR}/compose.yml"

mkdir -p "$DATA_DIR"

# Hostname stable et lisible dans le scan leader (devforge-a1b2).
if [ ! -f /etc/devforge-node-id ]; then
  # shellcheck disable=SC2010
  mac="$(ip -o link show 2>/dev/null | awk '/link\/ether/ {print $17; exit}' | tr -d ':' | tail -c 5)"
  if [ -z "$mac" ] || [ "$mac" = "0000" ]; then
    mac="$(head -c 2 /dev/urandom | od -An -tx1 | tr -d ' \n' | tail -c 4)"
  fi
  id="$(printf '%s' "$mac" | tr 'A-F' 'a-f')"
  echo "devforge-${id}" > /etc/devforge-node-id
fi
node_name="$(cat /etc/devforge-node-id)"
current="$(hostname 2>/dev/null || true)"
if [ "$current" != "$node_name" ]; then
  hostnamectl set-hostname "$node_name" 2>/dev/null || hostname "$node_name" || true
  if [ -f /etc/hosts ] && ! grep -q "$node_name" /etc/hosts 2>/dev/null; then
    echo "127.0.1.1 $node_name" >> /etc/hosts
  fi
fi

# Docker up
if command -v systemctl >/dev/null 2>&1; then
  systemctl start docker 2>/dev/null || true
fi

# Attendre le socket Docker (live USB / first boot).
i=0
while [ "$i" -lt 60 ]; do
  if docker info >/dev/null 2>&1; then
    break
  fi
  i=$((i + 1))
  sleep 1
done

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "compose manquant : $COMPOSE_FILE" >&2
  exit 1
fi

# Charger une image hors-ligne si présente (clé USB sans Internet).
if [ -f "${OPT_DIR}/devforge-image.tar" ]; then
  docker load -i "${OPT_DIR}/devforge-image.tar" || true
fi
if [ -f "${OPT_DIR}/devforge-image.tar.gz" ]; then
  gzip -dc "${OPT_DIR}/devforge-image.tar.gz" | docker load || true
fi

cd "$OPT_DIR"
export DEVFORGE_DATA_DIR="$DATA_DIR"
if docker compose version >/dev/null 2>&1; then
  docker compose -f "$COMPOSE_FILE" up -d
elif command -v docker-compose >/dev/null 2>&1; then
  docker-compose -f "$COMPOSE_FILE" up -d
else
  echo "docker compose introuvable" >&2
  exit 1
fi

# Laisser le healthcheck démarrer puis afficher l’IP.
sleep 3
"${OPT_DIR}/scripts/show-ip.sh" || true
