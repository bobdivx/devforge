#!/usr/bin/env bash
# Répare Postgres DevForge + durcit le cleanup Docker localhost.
set -euo pipefail

echo "==> Restart API"
sudo docker restart devforge-api
sleep 8

echo "==> Migrate"
sudo docker exec devforge-api php artisan migrate --force --no-interaction

echo "==> DB ping"
sudo docker exec devforge-api php artisan tinker --execute='echo DB::connection()->getPdo() ? "db-ok" : "db-fail";'

echo "==> Harden localhost docker cleanup settings"
sudo docker exec devforge-api php artisan tinker --execute='
$server = App\Models\Server::find(0) ?? App\Models\Server::where("ip", "host.docker.internal")->first();
if (!$server) { echo "no-localhost-server"; return; }
$settings = $server->settings;
$settings->force_docker_cleanup = true;
$settings->docker_cleanup_threshold = 70;
$settings->docker_cleanup_frequency = "0 * * * *";
$settings->delete_unused_volumes = false;
$settings->delete_unused_networks = true;
$settings->server_disk_usage_notification_threshold = 80;
$settings->server_disk_usage_check_frequency = "0 */6 * * *";
$settings->save();
echo "server={$server->id} force=1 thresh=70 freq=hourly";
'

echo "==> Disk status"
df -h /media/Docker /DATA / | head -20

echo "==> Containers"
sudo docker ps -a --filter name=devforge --format "{{.Names}} {{.Status}}"
