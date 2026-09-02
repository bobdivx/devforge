#!/usr/bin/env bash
# Patch serve.cjs pour contexte 49152 (Demeter / RTX 3090)
set -euo pipefail
SERVE="${PINOKIO_HOME:-/mnt/ia/pinokio}/api/uncensored-local-studio/app/scripts/server/serve.cjs"
[[ -f "$SERVE" ]] || { echo "serve.cjs introuvable"; exit 1; }
sed -i 's/Math.min(32768, contextSize)/Math.min(49152, contextSize)/' "$SERVE"
sed -i 's/"--host", "127.0.0.1"/"--host", process.env.LLM_HOST || "0.0.0.0"/' "$SERVE"
echo "Patched $SERVE — LLM écoute sur 0.0.0.0 (LLM_HOST env)"
