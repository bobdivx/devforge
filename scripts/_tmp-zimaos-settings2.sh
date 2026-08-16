#!/usr/bin/env bash
set -u
echo "=== zimaos.db settings ==="
sudo python3 - <<'PY'
import sqlite3
con=sqlite3.connect("/var/lib/casaos/db/zimaos.db")
print("cols", list(con.execute("PRAGMA table_info(settings)")))
for row in con.execute("SELECT * FROM settings"):
    print(row)
PY

echo
echo "=== user_service_configs ==="
sudo python3 - <<'PY'
import sqlite3
con=sqlite3.connect("/var/lib/casaos/db/user.db")
print("cols", list(con.execute("PRAGMA table_info(user_service_configs)")))
for row in con.execute("SELECT * FROM user_service_configs"):
    s=str(row)
    if len(s)>400: s=s[:400]+"..."
    print(s)
PY

echo
echo "=== zimaos.conf ==="
sudo cat /etc/casaos/zimaos.conf
echo
echo "=== app-management.conf ==="
sudo cat /etc/casaos/app-management.conf

echo
echo "=== OPTIONS settings ==="
for p in /v2/zimaos/settings /v2/zimaos /v1/sys/config /v2/app_management; do
  echo "-- $p"
  curl -sS -m 3 -X OPTIONS -D - "http://127.0.0.1:90$p" -o /tmp/o | grep -E 'HTTP|Allow'
done

echo
echo "=== files data_migration ==="
sudo python3 - <<'PY'
import sqlite3
con=sqlite3.connect("/var/lib/casaos/files.db")
print(list(con.execute("PRAGMA table_info(data_migration_models)")))
for row in con.execute("SELECT * FROM data_migration_models"):
    print(row)
PY
