#!/usr/bin/env bash
# Hotfix: strip backend/ prefix from Vite manifest keys + APP_URL
# Prefer this over patching Blade @vite() paths (keeps source conventions).
set -euo pipefail

C=devforge-api
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

align_manifest() {
  docker cp "${SCRIPT_DIR}/nas-align-vite-manifest.php" "$C":/tmp/nas-align-vite-manifest.php
  docker exec -u root "$C" php /tmp/nas-align-vite-manifest.php
  docker exec -u root "$C" sh -c '
    mkdir -p /var/www/html/storage/framework/cache \
      /var/www/html/storage/framework/sessions \
      /var/www/html/storage/framework/views \
      /var/www/html/storage/logs \
      /var/www/html/bootstrap/cache
    chown -R 9999:9999 /var/www/html/storage /var/www/html/bootstrap/cache
  '
  docker exec "$C" php artisan view:clear || true
}

echo "=== 1. Patch APP_URL in CasaOS compose ==="
sudo python3 - <<'PY'
from pathlib import Path
p = Path("/var/lib/casaos/apps/devforge/docker-compose.yml")
text = p.read_text()
old = "APP_URL: http://10.1.0.58:8080"
new = "APP_URL: https://web.briseteia.me"
if old in text:
    text = text.replace(old, new)
    p.write_text(text)
    print("APP_URL patched")
elif new in text:
    print("APP_URL already correct")
else:
    print("WARN: APP_URL pattern not found")
PY

echo "=== 2. Recreate api ==="
cd /var/lib/casaos/apps/devforge
sudo docker compose up -d api
sleep 12

echo "=== 3. Align Vite manifest after recreate ==="
align_manifest

echo "=== 4. Verify ==="
sleep 2
echo "APP_URL=$(docker exec "$C" printenv APP_URL)"
docker exec "$C" grep -n "@vite" \
  /var/www/html/resources/views/layouts/devforge-auth.blade.php \
  /var/www/html/resources/views/layouts/base.blade.php
docker exec "$C" php -r 'echo implode("\n", array_keys(json_decode(file_get_contents("/var/www/html/public/build/manifest.json"), true))), "\n";'
echo "--- https ---"
curl -sI https://web.briseteia.me/login | head -12
echo "--- local ---"
curl -sI http://127.0.0.1:8080/login | head -8
