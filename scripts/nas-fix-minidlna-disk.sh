#!/usr/bin/env bash
# Durable MiniDLNA fix for ZimaOS / DevForge NAS.
#
# Root cause of recurring /media/Docker ENOSPC:
#   /etc/minidlna.conf had media_dir=/media AND db_dir=/media/Docker/minidlna
#   → indexes Docker overlays into files.db (100G+), kills Postgres.
#
# This script:
#   1) restricts media_dir to real media mounts
#   2) moves db_dir to /media/Media/minidlna-db
#   3) drops the bloated rebuildable files.db from the Docker disk
set -euo pipefail

CONF=/etc/minidlna.conf
DB_DIR="${MINIDLNA_DB_DIR:-/media/Media/minidlna-db}"
OLD_DB="${MINIDLNA_OLD_DB:-/media/Docker/minidlna}"

echo "==> stop minidlnad"
sudo systemctl stop minidlnad 2>/dev/null || true
sudo pkill -x minidlnad 2>/dev/null || true
sleep 1

echo "==> rewrite ${CONF}"
sudo cp -a "${CONF}" "${CONF}.bak-$(date +%Y%m%d%H%M%S)"
sudo tee "${CONF}" >/dev/null <<EOF
port=8200
# Do NOT use media_dir=/media — that indexes /media/Docker and blows up files.db.
media_dir=/media/Media
media_dir=/media/Photos
media_dir=/media/Documents
album_art_names=Cover.jpg/cover.jpg/AlbumArtSmall.jpg/albumartsmall.jpg/AlbumArt.jpg/albumart.jpg/Album.jpg/album.jpg/Folder.jpg/folder.jpg/Thumb.jpg/thumb.jpg
inotify=yes
enable_tivo=no
tivo_discovery=bonjour
strict_dlna=no
notify_interval=900
friendly_name=ZimaOS DLNA Server
log_level=off
db_dir=${DB_DIR}
EOF

echo "==> free Docker disk"
sudo mkdir -p "${DB_DIR}"
sudo rm -rf "${OLD_DB}"

echo "==> start minidlnad"
sudo systemctl start minidlnad
sleep 2
systemctl is-active minidlnad || true
df -h /media/Docker /media/Media | head -5
echo "OK"
