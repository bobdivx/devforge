#!/bin/sh
set -e
echo "Killing horizon processes..."
ps aux | grep '[a]rtisan horizon' | awk '{print $1}' | while read pid; do
  kill -9 "$pid" 2>/dev/null || true
done
sleep 3
echo "Horizon processes after restart:"
ps aux | grep '[a]rtisan horizon' | grep -v grep || echo "(none yet)"
php artisan horizon:status || true
php artisan queue:monitor default,high --max=1000 || true
