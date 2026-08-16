#!/bin/sh
set -eu

docker cp /tmp/zimaos-fix-localhost-server.php devforge-api:/tmp/zimaos-fix-localhost-server.php
docker exec -w /var/www/html devforge-api php artisan tinker /tmp/zimaos-fix-localhost-server.php

GW="$(docker exec devforge-api ip route | awk '/default/ {print $3}')"
echo "GATEWAY=$GW"
docker exec -u root devforge-api sh -c "grep -q host.docker.internal /etc/hosts || echo $GW host.docker.internal >> /etc/hosts"
docker exec devforge-api getent hosts host.docker.internal

KEY_FILE="$(docker exec -u root -w /var/www/html devforge-api sh -c 'ls storage/app/ssh/keys/ssh_key@* | grep -v lock | head -1')"
echo "=== SSH TEST ($KEY_FILE) ==="
docker exec -u www-data -w /var/www/html devforge-api ssh \
    -i "/var/www/html/${KEY_FILE}" \
    -o StrictHostKeyChecking=accept-new \
    -o ConnectTimeout=8 \
    bobdivx@host.docker.internal 'echo ssh-ok; hostname; id'
