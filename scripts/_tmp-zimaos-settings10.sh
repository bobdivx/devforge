#!/usr/bin/env bash
set -u
cd /usr/share/casaos/www/assets
f=$(ls SettingsDialog-*.js | head -1)
echo "file=$f"
sudo python3 - <<PY
import re
p="$f"
s=open(p,encoding='utf-8',errors='ignore').read()
for pat in [r'.{80}AppData.{80}', r'.{80}appdata.{80}', r'.{80}userdata.{80}', r'.{60}ZimaOS-HD.{60}', r'.{80}settings/.{40}']:
    print('====', pat)
    for m in re.findall(pat, s)[:8]:
        print(m)
        print('---')
PY
echo
echo "=== interfaceFunctions ==="
sudo python3 - <<'PY'
import re
p="interfaceFunctions-BKrD8x3O.js"
s=open(p,encoding='utf-8',errors='ignore').read()
for pat in [r'.{100}appdata.{80}', r'.{80}user_id.{80}', r'.{60}/v2/zimaos/settings.{80}']:
    print('====', pat)
    for m in re.findall(pat, s)[:10]:
        print(m)
        print('---')
PY
