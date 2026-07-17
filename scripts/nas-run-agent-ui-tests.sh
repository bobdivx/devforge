#!/usr/bin/env bash
set -eu

TEST_ROOT=/DATA/.devforge/test-env
RUN_ID=$$
PG_NAME="devforge-pest-pg-agent-ui-${RUN_ID}"
NETWORK="devforge-pest-net-agent-ui-${RUN_ID}"
APP_KEY=$(docker exec coolify printenv APP_KEY)

cleanup() {
  docker rm -f "$PG_NAME" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$NETWORK" >/dev/null
docker rm -f "$PG_NAME" >/dev/null 2>&1 || true

echo "=== start throwaway postgres ==="
docker run -d --name "$PG_NAME" --network "$NETWORK" \
  -e POSTGRES_USER=coolify \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=coolify \
  postgres:15-alpine >/dev/null

echo "=== wait for postgres ==="
for i in $(seq 1 40); do
  if docker exec "$PG_NAME" pg_isready -U coolify -d coolify >/dev/null 2>&1; then
    echo "postgres ready"
    break
  fi
  sleep 1
done

if [ -f "$TEST_ROOT/database/schema/testing-schema.sql" ]; then
  mv "$TEST_ROOT/database/schema/testing-schema.sql" "$TEST_ROOT/database/schema/testing-schema.sql.bak"
fi

python3 - <<'PY'
from pathlib import Path
p = Path('/DATA/.devforge/test-env/config/database.php')
text = p.read_text()
marker = 'devforge-pest-pg'
if marker in text:
    print('DATABASE_TESTING_ALREADY_PATCHED')
else:
    old = """        'testing' => [
            'driver' => 'sqlite',
            'database' => ':memory:',
            'prefix' => '',
            'foreign_key_constraints' => true,
        ],"""
    new = """        'testing' => [
            'driver' => 'pgsql',
            'host' => env('DB_HOST', '127.0.0.1'),
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
    if old not in text:
        raise SystemExit('database.php testing connection not found for patch')
    p.write_text(text.replace(old, new, 1))
    print('DATABASE_TESTING_PATCHED')
PY

cat > "$TEST_ROOT/.env" <<EOF
APP_NAME=Coolify
APP_ENV=testing
APP_KEY=${APP_KEY}
APP_DEBUG=true
APP_URL=http://localhost
DB_CONNECTION=testing
DB_HOST=${PG_NAME}
DB_PORT=5432
DB_DATABASE=coolify
DB_USERNAME=coolify
DB_PASSWORD=password
CACHE_DRIVER=array
CACHE_STORE=array
QUEUE_CONNECTION=sync
SESSION_DRIVER=array
TELESCOPE_ENABLED=false
NIGHTWATCH_ENABLED=false
BROADCAST_CONNECTION=log
MAIL_MAILER=array
FILESYSTEM_DISK=local
FAKER_LOCALE=en_US
EOF

COMMON_ENV=(
  -e APP_ENV=testing
  -e DB_CONNECTION=testing
  -e DB_HOST="$PG_NAME"
  -e DB_PORT=5432
  -e DB_DATABASE=coolify
  -e DB_USERNAME=coolify
  -e DB_PASSWORD=password
  -e CACHE_DRIVER=array
  -e CACHE_STORE=array
  -e QUEUE_CONNECTION=sync
  -e SESSION_DRIVER=array
  -e TELESCOPE_ENABLED=false
  -e NIGHTWATCH_ENABLED=false
  -e FAKER_LOCALE=en_US
)

echo "=== migrate ==="
docker run --rm --entrypoint '' \
  --network "$NETWORK" \
  -v "$TEST_ROOT:/var/www/html" \
  -w /var/www/html \
  "${COMMON_ENV[@]}" \
  ghcr.io/coollabsio/coolify:latest \
  php artisan migrate --force --no-interaction --database=testing

echo "=== pest ==="
set +e
docker run --rm --entrypoint '' \
  --network "$NETWORK" \
  -v "$TEST_ROOT:/var/www/html" \
  -w /var/www/html \
  "${COMMON_ENV[@]}" \
  ghcr.io/coollabsio/coolify:latest \
  php vendor/bin/pest --compact \
    tests/Unit/DevForge/AgentDirectivesTest.php \
    tests/Unit/DevForge/AgentToolPackagesTest.php \
    tests/Unit/DevForge/DeploymentMonitoringContextIsolationTest.php
PEST_EXIT=$?
set -e
echo "PEST_EXIT:${PEST_EXIT}"
exit "${PEST_EXIT}"
