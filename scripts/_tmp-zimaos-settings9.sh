#!/usr/bin/env bash
set -u
cd /usr/share/casaos/www/assets
echo "=== appdata API in js ==="
sudo grep -l 'settings/appdata\|AppData\|application data location\|/media/ZimaOS-HD' index-*.js *.js 2>/dev/null | head
echo
sudo grep -oE '.{40}settings/appdata.{40}' index-*.js | head
echo
sudo grep -oE '.{30}ZimaOS-HD/AppData.{30}' *.js | head
echo
sudo grep -oE '.{40}user_id.{20}appdata.{40}' index-*.js | head
echo
# login to get token
echo "=== login API ==="
sudo grep -oE '/v2/zimaos/[^"'\'' ]+' index-*.js | sort -u | head -40
echo
sudo grep -oE '/v1/users/[^"'\'' ]+' index-*.js | sort -u | head
echo
sudo grep -oE 'Authorization.{0,40}' index-*.js | head
