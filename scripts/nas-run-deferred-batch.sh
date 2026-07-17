#!/usr/bin/env bash
set -eu

TEST_ROOT=/DATA/.devforge/test-env
NET=devforge-pest-net
APP_KEY=$(docker exec coolify printenv APP_KEY)

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
QUEUE_CONNECTION=sync
SESSION_DRIVER=array
TELESCOPE_ENABLED=false
NIGHTWATCH_ENABLED=false
BROADCAST_CONNECTION=log
MAIL_MAILER=array
FILESYSTEM_DISK=local
EOF

if [ -f "$TEST_ROOT/database/schema/testing-schema.sql" ]; then
  mv "$TEST_ROOT/database/schema/testing-schema.sql" "$TEST_ROOT/database/schema/testing-schema.sql.bak"
fi

echo "=== pint ==="
docker run --rm --entrypoint '' --user 0:0 \
  -v "$TEST_ROOT:/var/www/html" -w /var/www/html \
  ghcr.io/coollabsio/coolify:latest \
  php vendor/bin/pint --format agent \
    app/Services/DevForge/Database/LibsqlDatabaseTransferService.php \
    app/Services/DevForge/Agent/AgentToolkit.php \
    app/Services/DevForge/Agent/AgentChatService.php \
    app/Services/DevForge/Agent/Tool/AgentToolApprovalGrant.php \
    app/Http/Controllers/DevForge/AgentMessageController.php \
    routes/devforge-agents.php \
    tests/Unit/DevForge/LibsqlDatabaseTransferServiceTest.php \
    tests/Unit/DevForge/AgentToolApprovalGrantTest.php \
    tests/Unit/DevForge/AgentForgeToolsTest.php

echo "=== pest ==="
docker run --rm --entrypoint '' --network "$NET" \
  -v "$TEST_ROOT:/var/www/html" -w /var/www/html \
  -e APP_ENV=testing -e DB_CONNECTION=testing \
  -e DB_HOST=devforge-pest-pg -e DB_PORT=5432 \
  -e DB_DATABASE=coolify -e DB_USERNAME=coolify -e DB_PASSWORD=password \
  -e CACHE_DRIVER=array -e QUEUE_CONNECTION=sync -e SESSION_DRIVER=array \
  -e TELESCOPE_ENABLED=false -e NIGHTWATCH_ENABLED=false \
  ghcr.io/coollabsio/coolify:latest \
  php vendor/bin/pest --compact \
    tests/Unit/DevForge/LibsqlDatabaseTransferServiceTest.php \
    tests/Unit/DevForge/AgentToolApprovalGrantTest.php \
    tests/Unit/DevForge/AgentForgeToolsTest.php

echo DONE
