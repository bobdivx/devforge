#!/usr/bin/env bash
set -u
cd /usr/share/casaos/www/assets
echo "=== getMigrationInfo definition ==="
sudo grep -l 'getMigrationInfo' *.js
echo
sudo python3 - <<'PY'
import glob,re
for p in glob.glob("*.js"):
    s=open(p,encoding='utf-8',errors='ignore').read()
    if "getMigrationInfo" not in s:
        continue
    print("FILE", p)
    for m in re.finditer(r'.{0,120}getMigrationInfo.{0,200}', s):
        print(m.group(0)[:300])
        print('---')
    for m in re.finditer(r'.{0,80}migration.{0,80}', s, re.I):
        t=m.group(0)
        if '/v' in t or 'http' in t or 'local_storage' in t or 'files' in t:
            print("URLISH", t)
    print()
PY
