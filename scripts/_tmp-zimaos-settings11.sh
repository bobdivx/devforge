#!/usr/bin/env bash
set -u
cd /usr/share/casaos/www/assets
sudo python3 - <<'PY'
import re,glob
for p in glob.glob("SettingsDialog-*.js")+glob.glob("interfaceFunctions-*.js")+glob.glob("Home-*.js"):
    s=open(p,encoding='utf-8',errors='ignore').read()
    if "MigrationType" not in s and "migrate" not in s.lower():
        continue
    print("FILE", p, "len", len(s))
    for pat in [
        r'.{50}MigrationType.{80}',
        r'.{40}getMigrationSize.{80}',
        r'.{40}migrate.{80}',
        r'.{40}/v2[^"\']*migrat[^"\']*',
        r'.{40}app_data.{80}',
        r'.{40}user_data.{80}',
        r'.{40}docker_image.{80}',
    ]:
        ms=re.findall(pat,s,flags=re.I)
        if ms:
            print(" PAT", pat)
            for m in ms[:6]:
                print("  ", m[:200])
    print()
PY
