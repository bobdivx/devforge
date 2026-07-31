#!/usr/bin/env bash
set -euo pipefail
API=devforge-api
SRC=/tmp/devforge-disk-guard

echo "==> Ensure dirs"
sudo docker exec "$API" mkdir -p \
  /var/www/html/app/Jobs/DevForge \
  /var/www/html/app/Actions/Server \
  /var/www/html/tests/Feature

echo "==> Copy"
sudo docker cp "$SRC/app/Jobs/DevForge/InstanceHostDiskGuardJob.php" "$API:/var/www/html/app/Jobs/DevForge/"
sudo docker cp "$SRC/app/Models/Server.php" "$API:/var/www/html/app/Models/"
sudo docker cp "$SRC/app/Actions/Server/CleanupDocker.php" "$API:/var/www/html/app/Actions/Server/"
sudo docker cp "$SRC/app/Console/Kernel.php" "$API:/var/www/html/app/Console/"
sudo docker cp "$SRC/tests/Feature/InstanceHostDiskGuardJobTest.php" "$API:/var/www/html/tests/Feature/" || true

echo "==> Verify"
sudo docker exec "$API" ls -la /var/www/html/app/Jobs/DevForge/InstanceHostDiskGuardJob.php
sudo docker exec "$API" grep -c InstanceHostDiskGuardJob /var/www/html/app/Console/Kernel.php
sudo docker exec "$API" grep -c 'Prefer the Docker workload mount' /var/www/html/app/Models/Server.php
sudo docker exec "$API" grep -c 'postgres(:|$)' /var/www/html/app/Actions/Server/CleanupDocker.php

echo "==> Restart + settings check"
sudo docker restart "$API"
sleep 10
sudo docker exec "$API" php artisan tinker --execute='
$s = App\Models\Server::find(0);
echo "cleanup_freq=".$s->settings->docker_cleanup_frequency.PHP_EOL;
echo "force=".(int)$s->settings->force_docker_cleanup.PHP_EOL;
echo "thresh=".$s->settings->docker_cleanup_threshold.PHP_EOL;
echo "disk=".$s->getWorkloadDiskUsage().PHP_EOL;
'

sudo docker ps --filter name=devforge --format '{{.Names}} {{.Status}}'
df -h /media/Docker | head -2
