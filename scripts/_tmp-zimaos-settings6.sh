#!/usr/bin/env bash
set -u
base=http://127.0.0.1:38710
echo "=== path variants ==="
for p in \
  /v2/zimaos/settings/1/appdata \
  /v2/zimaos/settings/1/userdata \
  /v2/zimaos/1/settings/appdata \
  /v2/zimaos/settings/appdata/1 \
  /v2/zimaos/settings/global/AppData \
  /v2/zimaos/settings/global/app_data \
  /v2/zimaos/settings/global/data_path \
  /v2/zimaos/settings/global/docker \
  ; do
  code=$(curl -sS -o /tmp/b -w '%{http_code}' -m 3 "$base$p" || true)
  echo "$code $p $(head -c 180 /tmp/b | tr '\n' ' ')"
done

echo
echo "=== PUT 1/appdata ==="
curl -sS -X PUT "$base/v2/zimaos/settings/1/appdata" \
  -H 'Content-Type: application/json' \
  -d '{"value":"/media/Docker/AppData"}'
echo
curl -sS "$base/v2/zimaos/settings/1/appdata"
echo

echo
echo "=== list global keys from strings ==="
sudo strings /usr/bin/zimaos | grep -oE 'settings/[A-Za-z0-9_./-]+' | sort -u | head -40
echo
sudo strings /usr/bin/zimaos | grep -oE '/media/[A-Za-z0-9_./-]+' | sort -u | head -40
