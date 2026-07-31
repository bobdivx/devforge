#!/usr/bin/env bash
set -euo pipefail
sudo docker exec devforge-api php artisan tinker --execute='
try {
  echo Schema::getColumnType("ai_agent_subagent_runs", "reason");
} catch (Throwable $e) {
  echo "err:".$e->getMessage();
}
'
echo
df -i / /media/Docker | head -10
echo '=== root culprits ==='
sudo du -xh --max-depth=1 /var /tmp /opt /usr 2>/dev/null | sort -h | tail -25
