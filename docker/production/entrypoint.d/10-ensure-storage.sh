#!/bin/sh
# Ensure Laravel writable paths exist at boot (www-data).
# .dockerignore excludes these dirs from the build context; bind mounts can also hide them.
set -eu

BASE="${APP_BASE_DIR:-/var/www/html}"

mkdir -p \
  "${BASE}/storage/logs" \
  "${BASE}/storage/framework/cache/data" \
  "${BASE}/storage/framework/sessions" \
  "${BASE}/storage/framework/views" \
  "${BASE}/bootstrap/cache"

# Best-effort: fix mode if we own the tree (cannot chown without root).
chmod -R u+rwX \
  "${BASE}/storage/logs" \
  "${BASE}/storage/framework/cache" \
  "${BASE}/storage/framework/sessions" \
  "${BASE}/storage/framework/views" \
  "${BASE}/bootstrap/cache" \
  2>/dev/null || true
