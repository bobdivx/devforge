#!/usr/bin/env bash
set -euo pipefail
echo '=== inode hogs under / ==='
# Find directories with most entries on root filesystem only
sudo find / -xdev -type d -print0 2>/dev/null | \
  xargs -0 -n1 sudo sh -c 'echo "$(ls -A "$1" 2>/dev/null | wc -l) $1"' _ 2>/dev/null | \
  sort -nr | head -30

echo '=== suspicious paths ==='
for p in /var/lib/docker /var/log /tmp /run /var/cache /DATA/.docker /var/lib/casaos; do
  if [ -e "$p" ]; then
    echo -n "$p: "
    sudo find "$p" -xdev 2>/dev/null | wc -l
  fi
done

echo '=== overlay/tmp small files ==='
sudo find /var /tmp /run -xdev -type f 2>/dev/null | wc -l
sudo ls /var/lib 2>/dev/null
sudo find /var/lib -xdev -maxdepth 2 -type d 2>/dev/null | while read d; do
  c=$(sudo find "$d" -xdev -maxdepth 1 2>/dev/null | wc -l)
  [ "$c" -gt 50 ] && echo "$c $d"
done | sort -nr | head -20
