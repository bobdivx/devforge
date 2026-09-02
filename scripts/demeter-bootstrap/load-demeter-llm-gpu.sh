#!/usr/bin/env bash
# Charge le LLM sur GPU après démarrage de serve.cjs (sans auto-load dans serve.cjs)
set -euo pipefail

PORT="${LLM_UI_PORT:-1420}"
JSON="${HOME}/Documents/devforge/scripts/demeter-bootstrap/llm-start-gpu.json"
MAX_WAIT=120

for i in $(seq 1 "$MAX_WAIT"); do
  if curl -sf "http://127.0.0.1:${PORT}/api/llm/status" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if [[ ! -f "$JSON" ]]; then
  echo "WARN: $JSON introuvable"
  exit 0
fi

# Déjà chargé ?
if curl -sf "http://127.0.0.1:${PORT}/api/llm/status" | grep -q '"ready":true'; then
  echo "LLM already ready"
  exit 0
fi

curl -sf -X POST "http://127.0.0.1:${PORT}/api/llm/stop" >/dev/null 2>&1 || true
sleep 2
curl -sf -X POST "http://127.0.0.1:${PORT}/api/llm/start" \
  -H 'Content-Type: application/json' \
  -d @"$JSON" && echo "LLM GPU load requested"
