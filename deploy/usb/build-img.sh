#!/usr/bin/env bash
# Construit une image disque raw flashable (USB / SSD) — Linux ou WSL2 / CI.
# Base : Debian cloud + cloud-init NoCloud + overlay DevForge embarqué.
#
# Résultat :
#   dist/devforge-node-amd64.img
#   dist/devforge-node-amd64.img.xz  (si xz disponible)
#
# Usage :
#   ./build-img.sh [--version 2.0.162] [--size 8G] [--offline]
#
# --offline : embarque aussi l’image Docker (gros fichier, boot sans pull).
set -euo pipefail

VERSION="${DEVFORGE_VERSION:-latest}"
SIZE="8G"
ARCH="amd64"
OFFLINE=0
ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="${ROOT}/../../dist"
WORK="${ROOT}/.build"
DEBIAN_VER="12"
IMAGE_URL="https://cloud.debian.org/images/cloud/bookworm/latest/debian-${DEBIAN_VER}-generic-${ARCH}.raw"

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --size) SIZE="$2"; shift 2 ;;
    --offline) OFFLINE=1; shift ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    *) echo "Option inconnue : $1" >&2; exit 1 ;;
  esac
done

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Prérequis manquant : $1" >&2
    exit 1
  fi
}

need wget
need qemu-img
need virt-customize

mkdir -p "$WORK" "$OUT_DIR"
SEED="${WORK}/seed"
OVERLAY="${WORK}/overlay"
IMG="${OUT_DIR}/devforge-node-${ARCH}.img"
RAW="${WORK}/debian.raw"

echo "==> Debian cloud ${DEBIAN_VER} (${ARCH})"
if [ ! -f "$RAW" ]; then
  wget -O "$RAW" "$IMAGE_URL"
fi

echo "==> Copie / agrandissement → ${IMG} (${SIZE})"
cp -f "$RAW" "$IMG"
qemu-img resize -f raw "$IMG" "$SIZE" 2>/dev/null || qemu-img resize "$IMG" "$SIZE"

echo "==> Overlay DevForge"
rm -rf "$OVERLAY" "$SEED"
mkdir -p "${OVERLAY}/scripts" "${OVERLAY}/systemd" "$SEED"
cp -f "${ROOT}/bootstrap.sh" "${OVERLAY}/"
cp -f "${ROOT}/compose.yml" "${OVERLAY}/"
cp -f "${ROOT}/scripts/"*.sh "${OVERLAY}/scripts/"
cp -f "${ROOT}/systemd/"*.service "${OVERLAY}/systemd/"
chmod +x "${OVERLAY}/bootstrap.sh" "${OVERLAY}/scripts/"*.sh
echo "$VERSION" > "${OVERLAY}/VERSION"

if [ "$OFFLINE" = "1" ]; then
  need docker
  echo "==> Export Docker hors-ligne bobdivx/devforge:${VERSION}"
  docker pull "bobdivx/devforge:${VERSION}"
  docker save "bobdivx/devforge:${VERSION}" -o "${OVERLAY}/devforge-image.tar"
fi

cat > "${SEED}/meta-data" <<EOF
instance-id: devforge-node-001
local-hostname: devforge-node
EOF

# Bootstrap local (pas de curl GitHub au 1er boot pour les scripts).
cat > "${SEED}/user-data" <<EOF
#cloud-config
hostname: devforge-node
manage_etc_hosts: true
ssh_pwauth: false
package_update: true

packages:
  - curl
  - ca-certificates

runcmd:
  - [ bash, -c, "cp -a /opt/devforge-seed/. /opt/devforge-bundle/ && cd /opt/devforge-bundle && bash bootstrap.sh --version ${VERSION}" ]
  - [ bash, /opt/devforge/scripts/show-ip.sh ]

final_message: |
  DevForge Node prêt. Ouvre http://IP:8000 ou adopte depuis le leader (Trouver des nœuds).
EOF

cat > "${SEED}/99_nocloud.cfg" <<EOF
datasource_list: [ NoCloud, None ]
EOF

# Tar l’overlay pour un seul upload virt-customize.
OVERLAY_TAR="${WORK}/overlay.tar"
tar -C "$OVERLAY" -cf "$OVERLAY_TAR" .

echo "==> Injection cloud-init + overlay (virt-customize)"
virt-customize -a "$IMG" \
  --mkdir /var/lib/cloud/seed/nocloud \
  --mkdir /opt/devforge-seed \
  --mkdir /opt/devforge-bundle \
  --upload "${SEED}/user-data:/var/lib/cloud/seed/nocloud/user-data" \
  --upload "${SEED}/meta-data:/var/lib/cloud/seed/nocloud/meta-data" \
  --upload "${SEED}/99_nocloud.cfg:/etc/cloud/cloud.cfg.d/99_devforge_nocloud.cfg" \
  --upload "${OVERLAY_TAR}:/tmp/devforge-overlay.tar" \
  --run-command "tar -xf /tmp/devforge-overlay.tar -C /opt/devforge-seed && rm -f /tmp/devforge-overlay.tar && chmod +x /opt/devforge-seed/bootstrap.sh /opt/devforge-seed/scripts/*.sh" \
  --run-command "chmod 644 /var/lib/cloud/seed/nocloud/* /etc/cloud/cloud.cfg.d/99_devforge_nocloud.cfg"

XZ_OUT="${IMG}.xz"
if command -v xz >/dev/null 2>&1; then
  echo "==> Compression xz"
  xz -T0 -f -k -e -9 "$IMG" || xz -T0 -f -k "$IMG"
  echo "Compressé : ${XZ_OUT} ($(du -h "$XZ_OUT" | awk '{print $1}'))"
fi

echo ""
echo "Image prête : ${IMG} ($(du -h "$IMG" | awk '{print $1}'))"
echo "Flash (Linux) : sudo dd if=${IMG} of=/dev/sdX bs=4M status=progress conv=fsync"
echo "Flash (Windows) : balenaEtcher / Rufus (mode DD) — préfère le .img.xz décompressé ou Etcher natif"
