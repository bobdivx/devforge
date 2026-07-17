#!/usr/bin/env bash
set -eu

TEST_ROOT=/DATA/.devforge/test-env

APP_KEY=$(docker exec coolify printenv APP_KEY)

cat > "$TEST_ROOT/.env" <<EOF
APP_NAME=Coolify
APP_ENV=testing
APP_KEY=${APP_KEY}
APP_DEBUG=true
APP_URL=http://localhost
DB_CONNECTION=testing
CACHE_DRIVER=array
QUEUE_CONNECTION=sync
SESSION_DRIVER=array
TELESCOPE_ENABLED=false
NIGHTWATCH_ENABLED=false
BROADCAST_CONNECTION=log
MAIL_MAILER=array
FILESYSTEM_DISK=local
EOF

echo "=== env ready (APP_KEY present: $(grep -c '^APP_KEY=' "$TEST_ROOT/.env")) ==="

echo "=== pest ==="
set +e
docker run --rm --entrypoint '' \
  -v "$TEST_ROOT:/var/www/html" \
  -w /var/www/html \
  -e APP_ENV=testing \
  -e DB_CONNECTION=testing \
  -e CACHE_DRIVER=array \
  -e QUEUE_CONNECTION=sync \
  -e SESSION_DRIVER=array \
  -e TELESCOPE_ENABLED=false \
  -e NIGHTWATCH_ENABLED=false \
  ghcr.io/coollabsio/coolify:latest \
  php vendor/bin/pest --compact \
    tests/Unit/DevForge/AgentToolPackageDefaultsTest.php \
    tests/Unit/DevForge/AgentToolPackagesTest.php \
    tests/Unit/DevForge/DeploymentFailureAgentDispatcherTest.php
PEST_EXIT=$?
set -e
echo "PEST_EXIT:${PEST_EXIT}"

echo "=== pint ==="
set +e
docker run --rm --entrypoint '' \
  -v "$TEST_ROOT:/var/www/html" \
  -w /var/www/html \
  ghcr.io/coollabsio/coolify:latest \
  php vendor/bin/pint --dirty --format agent
PINT_EXIT=$?
set -e
echo "PINT_EXIT:${PINT_EXIT}"

exit "${PEST_EXIT}"
