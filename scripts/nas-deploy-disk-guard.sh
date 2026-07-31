#!/usr/bin/env bash
# Déploie les garde-fous disque dans le conteneur api vivant (sans rebuild image).
set -euo pipefail

API=devforge-api
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

files=(
  "app/Jobs/DevForge/InstanceHostDiskGuardJob.php"
  "app/Models/Server.php"
  "app/Actions/Server/CleanupDocker.php"
  "app/Console/Kernel.php"
)

echo "==> Copy files into ${API}"
for f in "${files[@]}"; do
  echo "  $f"
  sudo docker cp "${ROOT}/backend/${f}" "${API}:/var/www/html/${f}"
done

echo "==> Restart API to reload schedule"
sudo docker restart "${API}"
sleep 8
sudo docker ps --filter name=devforge --format '{{.Names}} {{.Status}}'
df -h /media/Docker | head -2
echo "OK"
