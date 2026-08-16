#!/usr/bin/env bash
set -u
echo "=== conf files ==="
ls /etc/casaos/*.conf /etc/casaos/*.json 2>/dev/null
echo
for f in /etc/casaos/*.conf; do
  echo "----- $f -----"
  sudo grep -nEi 'appdata|data_path|Default|ZimaOS|Gallery|docker|folder' "$f" || true
done

echo
echo "=== sqlite settings ==="
sudo find /var/lib/casaos /DATA -name '*.db' 2>/dev/null | head -30
for db in /var/lib/casaos/db/*.db /var/lib/casaos/*.db; do
  [ -f "$db" ] || continue
  echo "DB $db"
  sudo python3 - <<PY
import sqlite3
con=sqlite3.connect("$db")
print(con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall())
PY
done

echo
echo "=== gateway settings routes ==="
for p in \
  /v2/zimaos/settings \
  /v1/sys \
  /v2/sys \
  /v2/app_management/settings \
  /v2/app_management/info \
  /v1/folder \
  /v2/folder \
  ; do
  code=$(curl -sS -o /tmp/b -w '%{http_code}' -m 3 "http://127.0.0.1:90$p" || true)
  echo "$code $p $(head -c 160 /tmp/b | tr '\n' ' ')"
done

echo
echo "=== strings app-management paths ==="
sudo strings /usr/bin/zimaos-app-management 2>/dev/null | grep -E 'AppData|ZimaOS-HD|data_path|DataPath' | sort -u | head -40
