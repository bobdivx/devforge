#!/usr/bin/env bash
set -u
echo "=== ZimaOS-HD / AppData / Docker ==="
ls -la /media/ZimaOS-HD 2>/dev/null | head -20
echo
readlink -f /media/ZimaOS-HD /media/ZimaOS-HD/AppData 2>/dev/null
echo
df -h /media/ZimaOS-HD /media/ZimaOS-HD/AppData /media/Docker /media/Docker/AppData /DATA 2>/dev/null
echo
echo "=== real AppData ==="
ls -la /media/Docker/AppData 2>/dev/null
du -sh /media/Docker/AppData 2>/dev/null
echo
echo "=== casaos configs ==="
sudo grep -RIn -E 'AppData|appdata|ZimaOS-HD|Gallery|Download|docker' \
  /etc/casaos /var/lib/casaos --include='*.json' --include='*.conf' --include='*.yaml' 2>/dev/null \
  | grep -v appstore | grep -v node_modules | head -60

echo
echo "=== API settings ==="
for p in \
  /v2/local_storage/storage \
  /v1/sys/config \
  /v2/sys/config \
  /v1/users/current \
  ; do
  echo "-- $p"
  curl -sS -m 3 "http://127.0.0.1:90$p" | head -c 400
  echo
done
