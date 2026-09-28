#!/usr/bin/env bash
# Prépare une clé USB « kit DevForge Node » (pas encore bootable seule).
# Contenu : bootstrap + compose + scripts + image Docker exportée (hors-ligne).
#
# Prérequis : Linux ou WSL2, Docker, clé montée.
#
# Usage :
#   ./prepare-kit.sh /mnt/usb [--version 2.0.162]
#
# Ensuite :
#   1. Installe Ventoy sur la clé (ou une ISO Debian/Ubuntu Live à côté)
#   2. Boot la machine en live Linux
#   3. monte la partition Ventoy / data et lance :
#        sudo bash /chemin/devforge-usb/bootstrap.sh
set -euo pipefail

DEST="${1:-}"
VERSION="${DEVFORGE_VERSION:-latest}"
shift || true

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    *) echo "Option inconnue : $1" >&2; exit 1 ;;
  esac
done

if [ -z "$DEST" ]; then
  echo "Usage : $0 /mnt/usb [--version X.Y.Z]" >&2
  exit 1
fi

if [ ! -d "$DEST" ]; then
  echo "Dossier introuvable : $DEST (monte la clé d’abord)." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")" && pwd)"
KIT="${DEST}/devforge-usb"
mkdir -p "${KIT}/scripts" "${KIT}/systemd"

echo "==> Copie du kit → ${KIT}"
cp -f "${ROOT}/bootstrap.sh" "${KIT}/"
cp -f "${ROOT}/compose.yml" "${KIT}/"
cp -f "${ROOT}/scripts/"*.sh "${KIT}/scripts/"
cp -f "${ROOT}/systemd/"*.service "${KIT}/systemd/"
chmod +x "${KIT}/bootstrap.sh" "${KIT}/scripts/"*.sh

echo "==> Export image Docker bobdivx/devforge:${VERSION}"
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker requis pour l’export hors-ligne." >&2
  exit 1
fi
docker pull "bobdivx/devforge:${VERSION}"
docker save "bobdivx/devforge:${VERSION}" -o "${KIT}/devforge-image.tar"

cat > "${KIT}/START-HERE.txt" <<EOF
DevForge Node — kit USB
=======================

1) Boot la machine avec une ISO Linux Live (Debian / Ubuntu) — Ventoy recommandé.
2) Branche le réseau (DHCP).
3) Monte cette clé et lance :

   sudo bash ${KIT}/bootstrap.sh --version ${VERSION}

   (si l’image tar est à côté du script, l’install est hors-ligne)

4) Sur l’écran / la console : note l’URL http://IP:8000
5) Soit ouvre cette URL (créer une instance OU laisser « En attente »),
   soit depuis ton leader DevForge : Cluster → Trouver des nœuds → Ajouter.

Données persistantes (si le live a un disque / partition) :
  /var/lib/devforge

Sur un live sans persistance, les données disparaissent au reboot —
installe Debian sur le disque interne puis relance bootstrap.sh.
EOF

echo ""
echo "Kit prêt : ${KIT}"
echo "Taille image : $(du -h "${KIT}/devforge-image.tar" | awk '{print $1}')"
echo "Voir START-HERE.txt sur la clé."
