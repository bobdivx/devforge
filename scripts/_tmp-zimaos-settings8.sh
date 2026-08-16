#!/usr/bin/env bash
set -u
echo "=== find UI strings ==="
sudo grep -RIn --binary-files=without-match -E 'AppData|application data|Données de l' /usr/share/casaos /var/lib/casaos /DATA/casaos-ui 2>/dev/null | head -20

# typical UI locations
for d in /usr/share/casaos-ui /var/lib/casaos/www /DATA/www /usr/share/casaos/www; do
  [ -d "$d" ] && echo "DIR $d" && sudo ls "$d" | head
done

echo
echo "=== find js bundles ==="
sudo find /usr /var/lib/casaos /DATA -name '*.js' 2>/dev/null | grep -iE 'casaos|zima|ui' | head -30

echo
echo "=== grep AppData in www ==="
sudo grep -RIn --include='*.js' --include='*.json' 'ZimaOS-HD/AppData' /usr /var/lib/casaos 2>/dev/null | head -20
