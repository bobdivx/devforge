#!/usr/bin/env bash
# ACE-Step Gradio bind 0.0.0.0 (Pinokio start.js) — acces LAN / ace.briseteia.me
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PINOKIO_HOME="${PINOKIO_HOME:-/mnt/ia/pinokio}"
export ACE_STEP_PORT="${ACE_STEP_PORT:-8001}"

bash "$SCRIPT_DIR/fix-demeter-pinokio-ports.sh"

echo ""
echo "Redemarrer ACE-Step dans Pinokio (Stop → Start)."
echo "Verifier: curl -sI http://127.0.0.1:${ACE_STEP_PORT} | head -1"
echo "          curl -sI http://10.1.0.88:${ACE_STEP_PORT} | head -1"
