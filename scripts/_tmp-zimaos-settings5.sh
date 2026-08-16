#!/usr/bin/env bash
set -u
base=http://127.0.0.1:38710
gw=http://127.0.0.1:90

echo "=== GET via headers ==="
for p in \
  /v2/zimaos/settings/appdata \
  /v2/zimaos/settings/userdata \
  /v2/zimaos/settings/global/appdata \
  /v2/zimaos/settings/global \
  ; do
  for extra in "-H user_id:1" "-H X-User-Id:1" "-H CasaOS-User:1"; do
    echo "GET $p $extra"
    curl -sS -m 3 $extra "$base$p" | head -c 200
    echo
  done
done

echo
echo "=== PUT try ==="
curl -sS -X PUT "$base/v2/zimaos/settings/appdata" \
  -H 'Content-Type: application/json' -H 'user_id: 1' \
  -d '{"value":"/media/Docker/AppData"}'
echo
curl -sS -X PUT "$base/v2/zimaos/settings/appdata" \
  -H 'Content-Type: application/json' \
  -d '{"value":"/media/Docker/AppData","user_id":1}'
echo

echo
echo "=== GET after ==="
curl -sS -H 'user_id: 1' "$base/v2/zimaos/settings/appdata"
echo
curl -sS "$gw/v2/zimaos/settings/appdata" -H 'user_id: 1'
echo
