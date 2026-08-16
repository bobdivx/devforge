#!/usr/bin/env bash
set -u
echo "=== grep AppData in casaos data ==="
sudo grep -RIn 'ZimaOS-HD/AppData\|/media/ZimaOS-HD' /var/lib/casaos /etc/casaos /DATA/.casaos 2>/dev/null \
  | grep -v appstore | grep -v '.log' | head -40

echo
echo "=== conf dir ==="
sudo ls -la /var/lib/casaos/conf 2>/dev/null
sudo find /var/lib/casaos/conf -type f 2>/dev/null | head
sudo cat /var/lib/casaos/conf/* 2>/dev/null | head -80

echo
echo "=== GET settings with token from user.db ==="
sudo python3 - <<'PY'
import sqlite3,json
con=sqlite3.connect("/var/lib/casaos/db/user.db")
print("users cols", list(con.execute("PRAGMA table_info(o_users)")))
for row in con.execute("SELECT * FROM o_users"):
    print([(i,str(v)[:80]) for i,v in enumerate(row)])
PY

echo
echo "=== OPTIONS allow methods settings ==="
curl -sS -m 3 -X OPTIONS -D - "http://127.0.0.1:90/v2/zimaos/settings" -o /tmp/o | head -25
echo body: $(cat /tmp/o)

echo
echo "=== try PUT/GET common keys ==="
# local unix? 
sudo cat /var/run/casaos/zimaos.url
echo
base=$(sudo cat /var/run/casaos/zimaos.url)
echo "zimaos=$base"
for p in /v2/zimaos/settings /v2/settings /v1/sys/config /v2/zimaos/settings/appdata; do
  echo "-- $base$p"
  curl -sS -m 3 "$base$p" | head -c 300
  echo
done
