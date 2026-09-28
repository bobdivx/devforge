#!/usr/bin/env bash
# Installe DevForge Node sur Debian/Ubuntu (live USB ou machine installée).
# Usage :
#   curl -fsSL https://raw.githubusercontent.com/bobdivx/devforge/main/deploy/usb/bootstrap.sh | sudo bash
#   sudo bash bootstrap.sh [--version 2.0.162] [--offline-tar /chemin/image.tar]
#
# Après install :
#   - http://<IP>:8000  → écran « En attente »
#   - Leader → Cluster → Trouver des nœuds → Ajouter
set -euo pipefail

VERSION="${DEVFORGE_VERSION:-latest}"
OFFLINE_TAR=""
OPT_DIR="/opt/devforge"
DATA_DIR="/var/lib/devforge"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --offline-tar) OFFLINE_TAR="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Option inconnue : $1" >&2
      exit 1
      ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "Lance ce script en root (sudo)." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "==> Paquets de base"
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg lsb-release apt-transport-https \
    iproute2 hostname
else
  echo "Distribution non supportée (il faut apt / Debian-Ubuntu)." >&2
  exit 1
fi

echo "==> Docker Engine"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

# Plugin compose v2
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y --no-install-recommends docker-compose-plugin 2>/dev/null || true
fi
if ! docker compose version >/dev/null 2>&1 && ! command -v docker-compose >/dev/null 2>&1; then
  echo "docker compose introuvable après install." >&2
  exit 1
fi

echo "==> Fichiers appliance → ${OPT_DIR}"
mkdir -p "${OPT_DIR}/scripts" "${DATA_DIR}"

copy_from_bundle() {
  local src="$1" dest="$2"
  if [ -n "$SCRIPT_DIR" ] && [ -f "${SCRIPT_DIR}/${src}" ]; then
    cp -f "${SCRIPT_DIR}/${src}" "$dest"
    return 0
  fi
  return 1
}

# Préférer les fichiers locaux du dépôt / clé USB ; sinon télécharger depuis GitHub.
RAW_BASE="https://raw.githubusercontent.com/bobdivx/devforge/main/deploy/usb"

fetch() {
  local rel="$1" dest="$2"
  if copy_from_bundle "$rel" "$dest"; then
    return 0
  fi
  curl -fsSL "${RAW_BASE}/${rel}" -o "$dest"
}

fetch "compose.yml" "${OPT_DIR}/compose.yml"
fetch "scripts/firstboot.sh" "${OPT_DIR}/scripts/firstboot.sh"
fetch "scripts/show-ip.sh" "${OPT_DIR}/scripts/show-ip.sh"
fetch "systemd/devforge.service" /etc/systemd/system/devforge.service
fetch "systemd/devforge-console-ip.service" /etc/systemd/system/devforge-console-ip.service

chmod +x "${OPT_DIR}/scripts/"*.sh

# Pin version dans le compose si demandée
if [ "$VERSION" != "latest" ]; then
  sed -i "s|\${DEVFORGE_VERSION:-latest}|${VERSION}|g" "${OPT_DIR}/compose.yml" || true
fi
echo "$VERSION" > "${OPT_DIR}/VERSION"
cat > "${OPT_DIR}/.env" <<EOF
DEVFORGE_VERSION=${VERSION}
DEVFORGE_DATA_DIR=${DATA_DIR}
EOF

if [ -n "$OFFLINE_TAR" ] && [ -f "$OFFLINE_TAR" ]; then
  echo "==> Image Docker hors-ligne"
  cp -f "$OFFLINE_TAR" "${OPT_DIR}/devforge-image.tar"
  docker load -i "${OPT_DIR}/devforge-image.tar"
elif [ -f "${SCRIPT_DIR}/devforge-image.tar" ]; then
  echo "==> Image Docker hors-ligne (bundle USB)"
  cp -f "${SCRIPT_DIR}/devforge-image.tar" "${OPT_DIR}/devforge-image.tar"
  docker load -i "${OPT_DIR}/devforge-image.tar"
elif [ -f "${SCRIPT_DIR}/devforge-image.tar.gz" ]; then
  echo "==> Image Docker hors-ligne (bundle USB, gzip)"
  cp -f "${SCRIPT_DIR}/devforge-image.tar.gz" "${OPT_DIR}/devforge-image.tar.gz"
  gzip -dc "${OPT_DIR}/devforge-image.tar.gz" | docker load
else
  echo "==> Pull bobdivx/devforge:${VERSION}"
  docker pull "bobdivx/devforge:${VERSION}"
fi

echo "==> Services systemd"
systemctl daemon-reload
systemctl enable devforge.service devforge-console-ip.service
systemctl restart devforge.service
systemctl start devforge-console-ip.service || true

echo ""
echo "DevForge Node est démarré."
"${OPT_DIR}/scripts/show-ip.sh" || true
echo "Ouvre l’URL dans un navigateur, ou ajoute ce nœud depuis le leader (Trouver des nœuds)."
