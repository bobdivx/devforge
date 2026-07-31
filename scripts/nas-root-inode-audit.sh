#!/usr/bin/env bash
set -euo pipefail
df -i /
echo '--- mounts of interest ---'
mount | grep -E 'on / |on /usr|on /var|on /opt|on /media|on /DATA|on /boot' || true
echo '--- file counts on root mount only (-xdev) ---'
sudo find / -xdev -type f 2>/dev/null | wc -l
sudo find / -xdev -type d 2>/dev/null | wc -l
echo '--- per top-level on root ---'
for top in bin sbin etc lib lib64 opt root home mnt media usr share; do
  if [ -e "/$top" ]; then
    c=$(sudo find "/$top" -xdev 2>/dev/null | wc -l)
    echo "$c /$top"
  fi
done | sort -nr
echo '--- biggest dirs by entry count under /etc /usr /opt ---'
for d in /etc /usr /opt /root; do
  [ -d "$d" ] || continue
  sudo find "$d" -xdev -type d -print0 2>/dev/null | \
    xargs -0 -I{} sh -c 'n=$(ls -A "$1" 2>/dev/null | wc -l); [ "$n" -gt 100 ] && echo "$n $1"' _ {} 2>/dev/null | \
    sort -nr | head -10
done
