#!/usr/bin/env bash
TEST_ROOT=/DATA/.devforge/test-env
echo starting
docker run --rm --entrypoint '' \
  -v "$TEST_ROOT:/var/www/html" \
  -w /var/www/html \
  -e APP_ENV=testing \
  -e DB_CONNECTION=testing \
  ghcr.io/coollabsio/coolify:latest \
  php -d display_errors=1 artisan package:discover --ansi
echo DISCOVER_EXIT:$?
ls -la "$TEST_ROOT/bootstrap/cache/"
