#!/bin/sh
# Lance le serveur, ou rouvre l’interface s’il tourne déjà.
export PATH="/app/bin:${PATH}"
PORT="${PORT:-8000}"
URL="http://127.0.0.1:${PORT}"
if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 1 "${URL}/api/v1/health" >/dev/null 2>&1; then
  xdg-open "${URL}" >/dev/null 2>&1 || true
  exit 0
fi
exec /app/bin/devforge-server "$@"
