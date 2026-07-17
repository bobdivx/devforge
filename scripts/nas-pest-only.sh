#!/usr/bin/env bash
set -eu
TEST_ROOT=/DATA/.devforge/test-env

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
echo PEST_EXIT:$?

docker run --rm --entrypoint '' \
  -v "$TEST_ROOT:/var/www/html" \
  -w /var/www/html \
  ghcr.io/coollabsio/coolify:latest \
  php vendor/bin/pint --dirty --format agent
echo PINT_EXIT:$?
