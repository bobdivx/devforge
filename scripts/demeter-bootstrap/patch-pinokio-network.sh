#!/usr/bin/env bash
# Corrige bind réseau 0.0.0.0 pour toutes les apps Pinokio Demeter (LAN + NPM + Homarr)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PINOKIO_HOME="${PINOKIO_HOME:-/mnt/ia/pinokio}"
export DEMETER_HOST="${DEMETER_HOST:-10.1.0.88}"

echo "=== patch-pinokio-network $(date -Iseconds) ==="
echo "   PINOKIO_HOME=$PINOKIO_HOME"

bash "$SCRIPT_DIR/fix-demeter-pinokio-ports.sh"
bash "$SCRIPT_DIR/patch-serve-network.sh"

# Contexte 49152 + host (idempotent)
if [[ -x "$SCRIPT_DIR/patch-serve-context.sh" ]]; then
  bash "$SCRIPT_DIR/patch-serve-context.sh" 2>/dev/null || bash "$SCRIPT_DIR/patch-serve-llm-host.sh"
fi

echo ""
echo "=== Terminé ==="
echo "Dans Pinokio : Stop → Start sur chaque app (Uncensored, LiteLLM, Wan, ACE-Step)."
echo ""
echo "Vérification LAN (après redémarrage) :"
echo "  DEMETER_HOST=$DEMETER_HOST bash $SCRIPT_DIR/verify-demeter-ports.sh"
echo ""
echo "Bind attendu (ss) : 0.0.0.0:1420 0.0.0.0:4000 0.0.0.0:8001 0.0.0.0:8188 0.0.0.0:10086"
