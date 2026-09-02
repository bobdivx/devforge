#!/usr/bin/env bash
set -euo pipefail
SERVE="${PINOKIO_HOME:-/mnt/ia/pinokio}/api/uncensored-local-studio/app/scripts/server/serve.cjs"
[[ -f "$SERVE" ]] || exit 1
perl -i -pe 's/"--host", "127\.0\.0\.1"/"--host", process.env.LLM_HOST || "0.0.0.0"/' "$SERVE"
grep '"--host"' "$SERVE" | head -1
