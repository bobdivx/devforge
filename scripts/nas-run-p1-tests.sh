#!/usr/bin/env bash
set -eu

TEST_ROOT=/DATA/.devforge/test-env
NET=devforge-pest-net
PG=devforge-pest-pg
REDIS=devforge-pest-redis
APP_KEY=$(docker exec coolify printenv APP_KEY)

# Disposable Postgres + Redis for isolated Pest runs (never touch prod coolify-db / coolify-redis).
docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET"
if ! docker ps --format '{{.Names}}' | grep -qx "$PG"; then
  docker rm -f "$PG" >/dev/null 2>&1 || true
  docker run -d --name "$PG" --network "$NET" \
    -e POSTGRES_USER=coolify \
    -e POSTGRES_PASSWORD=password \
    -e POSTGRES_DB=coolify \
    postgres:15-alpine >/dev/null
  echo "Waiting for postgres..."
  for i in $(seq 1 30); do
    if docker exec "$PG" pg_isready -U coolify >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$REDIS"; then
  docker rm -f "$REDIS" >/dev/null 2>&1 || true
  docker run -d --name "$REDIS" --network "$NET" \
    --network-alias coolify-redis \
    redis:7-alpine >/dev/null
else
  docker network connect "$NET" "$REDIS" 2>/dev/null || true
fi

# Ensure testing connection points at disposable postgres.
python3 - <<'PY'
from pathlib import Path
p = Path('/DATA/.devforge/test-env/config/database.php')
text = p.read_text()
needle = "'testing' => ["
if "devforge-pest-pg" not in text:
    block = """'testing' => [
            'driver' => 'pgsql',
            'host' => env('DB_HOST', 'devforge-pest-pg'),
            'port' => env('DB_PORT', '5432'),
            'database' => env('DB_DATABASE', 'coolify'),
            'username' => env('DB_USERNAME', 'coolify'),
            'password' => env('DB_PASSWORD', 'password'),
            'charset' => 'utf8',
            'prefix' => '',
            'prefix_indexes' => true,
            'search_path' => 'public',
            'sslmode' => 'prefer',
        ],"""
    # Replace sqlite testing block if present
    import re
    text2, n = re.subn(
        r"'testing'\s*=>\s*\[[^\]]*?\],",
        block,
        text,
        count=1,
        flags=re.S,
    )
    if n:
        p.write_text(text2)
        print('DB_TESTING_PATCHED')
    else:
        print('DB_TESTING_PATCH_SKIP')
else:
    print('DB_TESTING_ALREADY_PG')
PY

cat > "$TEST_ROOT/.env" <<EOF
APP_NAME=Coolify
APP_ENV=testing
APP_KEY=${APP_KEY}
APP_DEBUG=true
APP_URL=http://localhost
DB_CONNECTION=testing
DB_HOST=devforge-pest-pg
DB_PORT=5432
DB_DATABASE=coolify
DB_USERNAME=coolify
DB_PASSWORD=password
CACHE_DRIVER=array
CACHE_STORE=array
QUEUE_CONNECTION=sync
SESSION_DRIVER=array
REDIS_HOST=devforge-pest-redis
REDIS_PORT=6379
TELESCOPE_ENABLED=false
NIGHTWATCH_ENABLED=false
BROADCAST_CONNECTION=log
MAIL_MAILER=array
FILESYSTEM_DISK=local
FAKER_LOCALE=en_US
EOF

run_pest() {
  docker run --rm --entrypoint '' \
    --network "$NET" \
    -v "$TEST_ROOT:/var/www/html" \
    -w /var/www/html \
    -e APP_ENV=testing \
    -e DB_CONNECTION=testing \
    -e DB_HOST=devforge-pest-pg \
    -e DB_PORT=5432 \
    -e DB_DATABASE=coolify \
    -e DB_USERNAME=coolify \
    -e DB_PASSWORD=password \
    -e CACHE_DRIVER=array \
    -e CACHE_STORE=array \
    -e QUEUE_CONNECTION=sync \
    -e SESSION_DRIVER=array \
    -e REDIS_HOST=devforge-pest-redis \
    -e REDIS_PORT=6379 \
    -e TELESCOPE_ENABLED=false \
    -e NIGHTWATCH_ENABLED=false \
    -e FAKER_LOCALE=en_US \
    ghcr.io/coollabsio/coolify:latest \
    php vendor/bin/pest --compact "$@"
}

echo "=== unit tests ==="
set +e
run_pest \
  tests/Unit/DevForge/AgentRunLauncherTest.php \
  tests/Unit/DevForge/DeploymentAgentDispatchLimiterTest.php \
  tests/Unit/DevForge/DeploymentBuildAgentDispatcherTest.php
UNIT_EXIT=$?
set -e
echo "UNIT_EXIT:${UNIT_EXIT}"

echo "=== feature tests ==="
set +e
run_pest \
  tests/Feature/DevForgeDeploymentMonitoringApiTest.php \
  tests/Feature/DevForgeDeploymentAgentCatchUpTest.php
FEAT_EXIT=$?
set -e
echo "FEAT_EXIT:${FEAT_EXIT}"

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

if [ "$UNIT_EXIT" -ne 0 ]; then
  exit "$UNIT_EXIT"
fi
exit "$FEAT_EXIT"
