#!/bin/sh
set -eu
docker run --rm --entrypoint sh ghcr.io/tursodatabase/libsql-server:latest -c '
  ls -la /
  command -v sqld || true
  sqld --help 2>&1 | head -100 || true
  # Fresh volume layout experiment
'
TMPVOL="libsql-layout-probe-$$"
docker volume create "$TMPVOL" >/dev/null
docker run --rm -v "$TMPVOL:/var/lib/sqld" -e SQLD_DB_PATH=data.db -e SQLD_NODE=primary --entrypoint sh ghcr.io/tursodatabase/libsql-server:latest -c '
  cd /var/lib/sqld
  timeout 3 sqld 2>&1 || true
  echo "---AFTER---"
  find /var/lib/sqld -maxdepth 4 -type f -o -type d | head -80
  ls -laR /var/lib/sqld | head -80
'
docker volume rm "$TMPVOL" >/dev/null
