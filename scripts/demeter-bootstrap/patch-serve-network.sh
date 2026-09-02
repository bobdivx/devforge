#!/usr/bin/env bash
# serve.cjs Uncensored : llama-server + UI frontend en 0.0.0.0 (LAN / NPM)
set -euo pipefail

PINOKIO="${PINOKIO_HOME:-/mnt/ia/pinokio}"
SERVE="$PINOKIO/api/uncensored-local-studio/app/scripts/server/serve.cjs"

if [[ ! -f "$SERVE" ]]; then
  echo "WARN: serve.cjs introuvable — $SERVE"
  exit 0
fi

echo ">> Patch serve.cjs réseau : $SERVE"

# llama-server --host
perl -i -pe 's/"--host", "127\.0\.0\.1"/"--host", process.env.LLM_HOST || "0.0.0.0"/g' "$SERVE"

# Express / frontend listen (plusieurs conventions upstream)
perl -i -pe "s/\.listen\\(([^,]+),\\s*['\"]127\\.0\\.0\\.1['\"]/\.listen(\$1, process.env.HOST || '0.0.0.0'/g" "$SERVE"
perl -i -pe 's/host:\s*["'\'']127\.0\.0\.1["'\'']/host: process.env.HOST || "0.0.0.0"/g' "$SERVE"

grep -E 'LLM_HOST|0\.0\.0\.0|--host' "$SERVE" | head -5 || true
echo "OK serve.cjs"
