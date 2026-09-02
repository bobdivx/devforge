#!/usr/bin/env bash
# Wrapper Pinokio : free GPU + start ACE Studio
# PORT=8001 = Express UI (NPM) ; ACESTEP_PORT=7865 = Gradio pipeline (interne)
set -euo pipefail

PINOKIO="${PINOKIO_HOME:-/mnt/ia/pinokio}"
ROOT="$PINOKIO/api/ace-step-studio.pinokio"
APP="$ROOT/app"
SERVER="$APP/app/server"
ACQUIRE="$PINOKIO/bin/acquire-gpu-slot.sh"

export PATH="$PINOKIO/bin/miniforge/bin:$PINOKIO/bin/npm/bin:${PATH}"
export PORT="${PORT:-8001}"
export HOST="${HOST:-0.0.0.0}"
export NO_AUTO_BROWSER="${NO_AUTO_BROWSER:-true}"
export PYTHON_PATH="${PYTHON_PATH:-$APP/env/bin/python}"
export ACESTEP_PATH="${ACESTEP_PATH:-$APP/ACE-Step-1.5}"
export HF_HOME="${HF_HOME:-$APP/models}"
export HUGGINGFACE_HUB_CACHE="${HUGGINGFACE_HUB_CACHE:-$APP/models}"
export TRANSFORMERS_CACHE="${TRANSFORMERS_CACHE:-$APP/models}"
export TORCH_HOME="${TORCH_HOME:-$APP/models/torch}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$APP/cache}"
export HF_HUB_ENABLE_HF_TRANSFER=1
export DEFAULT_MODEL="${DEFAULT_MODEL:-marcorez8/acestep-v15-xl-turbo-bf16}"
export MANAGE_PIPELINE="${MANAGE_PIPELINE:-true}"
# Gradio NE doit PAS prendre le même port que Express
export ACESTEP_PORT="${ACESTEP_PORT:-7865}"
export ACESTEP_API_URL="${ACESTEP_API_URL:-http://127.0.0.1:${ACESTEP_PORT}}"
export GRADIO_SERVER_PORT="${GRADIO_SERVER_PORT:-$ACESTEP_PORT}"
export PYTHONIOENCODING=utf-8
export PYTHONUNBUFFERED=1
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
export GRADIO_SERVER_NAME=127.0.0.1
export SERVER_NAME=127.0.0.1
export FRONTEND_URL="${FRONTEND_URL:-https://ace.briseteia.me}"

echo "[start-ace] freeing GPU via arbiter…"
if [[ -x "$ACQUIRE" ]]; then
  bash "$ACQUIRE" ace pinokio-ace || true
fi

if ss -tlnp 2>/dev/null | grep -q ":${PORT} "; then
  echo "[start-ace] port ${PORT} busy — killing previous ACE studio"
  pkill -f 'ace-step-studio.pinokio/app/app/server' 2>/dev/null || true
  pkill -f 'acestep.acestep_v15_pipeline' 2>/dev/null || true
  fuser -k "${PORT}/tcp" 2>/dev/null || true
  fuser -k "${ACESTEP_PORT}/tcp" 2>/dev/null || true
  sleep 2
fi

cd "$SERVER"
echo "[start-ace] Express UI http://0.0.0.0:${PORT} | Gradio pipeline :${ACESTEP_PORT}"
echo "ACE-Step UI Server running on http://localhost:${PORT}"
exec npx tsx src/index.ts
