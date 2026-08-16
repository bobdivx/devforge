#!/usr/bin/env bash
set -u
base=http://127.0.0.1:38710
echo "=== global keys ==="
for k in \
  fe.custom.setting.appdata \
  fe.custom.setting.AppData \
  fe.custom.setting.storage.appdata \
  fe.custom.setting.storage.AppData \
  fe.custom.setting.application.data \
  fe.custom.setting.apps.path \
  fe.custom.setting.userdata \
  fe.custom.setting.user.database \
  fe.custom.setting.files.root \
  ; do
  echo "-- $k"
  curl -sS -m 3 "$base/v2/zimaos/settings/global/$k"
  echo
done

echo
echo "=== user_id query names ==="
for q in 'user_id=1' 'userid=1' 'userId=1' 'uid=1' 'id=1'; do
  echo "-- ?$q"
  curl -sS -m 3 "$base/v2/zimaos/settings/appdata?$q" | head -c 160
  echo
done

echo
echo "=== files service ==="
sudo cat /var/run/casaos/icewhale-files.url
fbase=$(sudo cat /var/run/casaos/icewhale-files.url)
for p in /v2_1/files/settings /v2/files/settings /v1/settings; do
  echo "-- $fbase$p"
  curl -sS -m 3 "$fbase$p" | head -c 200
  echo
done

echo
echo "=== PUT global appdata ==="
curl -sS -X PUT "$base/v2/zimaos/settings/global/fe.custom.setting.appdata" \
  -H 'Content-Type: application/json' \
  -d '{"value":"/media/Docker/AppData"}'
echo
curl -sS -X PUT "$base/v2/zimaos/settings/appdata?userId=1" \
  -H 'Content-Type: application/json' \
  -d '{"value":"/media/Docker/AppData"}'
echo
