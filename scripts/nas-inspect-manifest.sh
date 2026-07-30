#!/usr/bin/env bash
set -euo pipefail
C=devforge-api
echo "=== build dir ==="
docker exec "$C" ls -la /var/www/html/public/build
echo "=== manifest size ==="
docker exec "$C" wc -c /var/www/html/public/build/manifest.json
echo "=== manifest keys ==="
docker exec "$C" php -r 'echo implode("\n", array_keys(json_decode(file_get_contents("/var/www/html/public/build/manifest.json"), true))), "\n";'
echo "=== app entries ==="
docker exec "$C" php -r '$m=json_decode(file_get_contents("/var/www/html/public/build/manifest.json"), true); foreach ($m as $k=>$v) { if (str_contains($k, "app.")) echo $k, PHP_EOL; }'
