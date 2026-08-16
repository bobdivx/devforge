#!/usr/bin/env bash
set -u
base=http://127.0.0.1:38710
echo "=== probe settings paths ==="
for p in \
  '/v2/zimaos/settings/appdata?user_id=1' \
  '/v2/zimaos/settings/appdata?user_id=-1' \
  '/v2/zimaos/settings?user_id=1' \
  '/v2/zimaos/settings/userdata?user_id=1' \
  '/v2/zimaos/settings/user_data?user_id=1' \
  '/v2/zimaos/settings/database?user_id=1' \
  '/v2/zimaos/settings/paths?user_id=1' \
  '/v2/zimaos/settings/folder?user_id=1' \
  ; do
  code=$(curl -sS -o /tmp/b -w '%{http_code}' -m 3 "$base$p" || true)
  echo "$code $p $(head -c 250 /tmp/b | tr '\n' ' ')"
done

echo
echo "=== strings settings keys ==="
sudo strings /usr/bin/zimaos 2>/dev/null | grep -E 'settings/|AppData|UserData|user_data|appdata' | sort -u | head -50

echo
echo "=== PUT schema ==="
curl -sS -X PUT "$base/v2/zimaos/settings/appdata?user_id=1" -H 'Content-Type: application/json' -d '{}'
echo
curl -sS -X POST "$base/v2/zimaos/settings/appdata?user_id=1" -H 'Content-Type: application/json' -d '{}'
echo
