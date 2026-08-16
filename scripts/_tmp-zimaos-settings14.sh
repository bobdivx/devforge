#!/usr/bin/env bash
set -u
cd /usr/share/casaos/www/assets
sudo python3 - <<'PY'
import re
s=open("vendor-api-files-DuYYo52K.js",encoding='utf-8',errors='ignore').read()
# MigrationStartModel nearby
for m in re.finditer(r'.{0,80}MigrationStart.{0,250}', s):
    print(m.group(0)[:320])
    print('---')
print("====")
# start body fields
for m in re.finditer(r'type:|to_path|dest|storage_name|app_data|user_data', s):
    pass
# dump a window around startMigration function body assignment
i=s.find('startMigration')
print(s[i:i+1500][:1500])
PY

echo
echo "=== POST start empty ==="
curl -sS -X POST http://127.0.0.1:37813/v2_1/files/migration/start \
  -H 'Content-Type: application/json' -d '{}'
echo
echo
echo "=== GET size ==="
curl -sS http://127.0.0.1:37813/v2_1/files/migration/size/app_data
echo
curl -sS http://127.0.0.1:37813/v2_1/files/migration/size/AppData
echo
echo
echo "=== OPTIONS start ==="
curl -sS -X OPTIONS -D - http://127.0.0.1:37813/v2_1/files/migration/start -o /tmp/o | grep Allow
