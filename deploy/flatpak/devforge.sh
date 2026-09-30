#!/bin/sh
# Lance le serveur, ou rouvre l’interface s’il tourne déjà.
# --background (ouverture de session) : icône seule, sans navigateur.
export PATH="/app/bin:${PATH}"
for arg in "$@"; do
  if [ "$arg" = "--background" ]; then
    export DEVFORGE_NO_BROWSER=1
  fi
done
PORT="${PORT:-8000}"
URL="http://127.0.0.1:${PORT}"
if command -v curl >/dev/null 2>&1 && curl -fsS --max-time 1 "${URL}/api/v1/health" >/dev/null 2>&1; then
  if [ -z "${DEVFORGE_NO_BROWSER:-}" ]; then
    xdg-open "${URL}" >/dev/null 2>&1 || true
  fi
  exit 0
fi
exec /app/bin/devforge-server "$@"
