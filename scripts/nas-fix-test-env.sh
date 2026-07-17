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
FAKER_LOCALE=en_US
EOF

# Ensure Unit/DevForge RefreshDatabase tests bootstrap Laravel
python3 - <<'PY'
from pathlib import Path
p = Path('/DATA/.devforge/test-env/tests/Pest.php')
text = p.read_text()
old = "uses(Tests\\TestCase::class)->in('Feature', 'v4/Feature', 'v4/Browser');"
new = "uses(Tests\\TestCase::class)->in('Feature', 'v4/Feature', 'v4/Browser', 'Unit/DevForge');"
if old in text:
    p.write_text(text.replace(old, new))
    print('PEST_PATCHED')
elif new in text:
    print('PEST_ALREADY_PATCHED')
else:
    print('PEST_PATCH_FAILED')
    raise SystemExit(1)
PY

echo '=== package:discover ==='
docker run --rm --entrypoint '' \
  -v "$TEST_ROOT:/var/www/html" \
  -w /var/www/html \
  -e APP_ENV=testing \
  -e DB_CONNECTION=testing \
  ghcr.io/coollabsio/coolify:latest \
  php artisan package:discover --ansi

echo '=== composer dump-autoload ==='
docker run --rm -v "$TEST_ROOT:/app" -w /app composer:2 \
  composer dump-autoload --no-interaction --ignore-platform-reqs --no-scripts

echo '=== pest ==='
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
  -e FAKER_LOCALE=en_US \
  ghcr.io/coollabsio/coolify:latest \
  php vendor/bin/pest --compact \
    tests/Unit/DevForge/AgentToolPackageDefaultsTest.php \
    tests/Unit/DevForge/AgentToolPackagesTest.php \
    tests/Unit/DevForge/DeploymentFailureAgentDispatcherTest.php
PEST_EXIT=$?
set -e
echo "PEST_EXIT:${PEST_EXIT}"

echo '=== pint ==='
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
