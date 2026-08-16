#!/usr/bin/env bash
set -u
cd /usr/share/casaos/www/assets
sudo python3 - <<'PY'
import re
s=open("vendor-api-files-DuYYo52K.js",encoding='utf-8',errors='ignore').read()
print("BASE", re.findall(r'BASE_PATH="[^"]+"', s)[:10])
print("PATHS", re.findall(r'"/[^"]*migrat[^"]*"', s, re.I))
print("PATHS2", re.findall(r'"/migration[^"]*"', s))
# startMigration
for m in re.finditer(r'.{0,60}startMigrat.{0,200}', s, re.I):
    print("START", m.group(0)[:250])
for m in re.finditer(r'.{0,40}putMigration.{0,200}', s, re.I):
    print("PUT", m.group(0)[:250])
for m in re.finditer(r'const s="(/[^"]+)"', s):
    if "migrat" in m.group(1).lower() or "folder" in m.group(1).lower():
        print("const", m.group(1))
PY

echo
fbase=$(sudo cat /var/run/casaos/icewhale-files.url)
echo "files=$fbase"
for p in \
  /v2_1/files/migration/info \
  /v2/files/migration/info \
  /migration/info \
  /v2_1/migration/info \
  ; do
  echo "-- $p"
  curl -sS -m 3 "$fbase$p" | head -c 400
  echo
done
