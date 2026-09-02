#!/usr/bin/env bash
# Clone les launchers Pinokio dans ~/pinokio/api/ (sans executer Install).
# Usage: bash scripts/demeter-bootstrap/clone-pinokio-apps.sh
set -euo pipefail

USER_NAME="${USER:-bobdivx}"
PINOKIO_HOME="${PINOKIO_HOME:-/home/${USER_NAME}/pinokio}"
API="$PINOKIO_HOME/api"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

mkdir -p "$API"

clone_if_missing() {
  local dir="$1"
  local url="$2"
  if [[ -d "$API/$dir" ]]; then
    echo "  skip $dir (existe)"
  else
    echo "  clone $dir"
    git clone --depth 1 "$url" "$API/$dir"
  fi
}

echo ">> Clone Pinokio apps vers $API"

clone_if_missing "uncensored-local-studio" \
  "https://github.com/cocktailpeanut/uncensored-local-studio.pinokio"

# LiteLLM depuis devforge (pas un repo GitHub pinokio)
if [[ ! -d "$API/litellm-cursor-proxy" ]]; then
  echo "  copy litellm-cursor-proxy depuis devforge"
  mkdir -p "$API/litellm-cursor-proxy"
  cp -f "$REPO_ROOT/scripts/pinokio-litellm-cursor-proxy/"*.{json,js} "$API/litellm-cursor-proxy/" 2>/dev/null || true
  cp -f "$REPO_ROOT/scripts/pinokio-litellm-cursor-proxy/install.js" "$API/litellm-cursor-proxy/"
  cp -f "$REPO_ROOT/scripts/pinokio-litellm-cursor-proxy/start.js" "$API/litellm-cursor-proxy/"
  cp -f "$REPO_ROOT/scripts/pinokio-litellm-cursor-proxy/litellm-config.yaml.example" \
    "$API/litellm-cursor-proxy/" 2>/dev/null || true
fi

clone_if_missing "wan" "https://github.com/pinokiofactory/wan"
clone_if_missing "ace-step.pinokio" "https://github.com/cocktailpeanut/ace-step.pinokio"
# ACE-Step Studio (timoncool) = doublon UI — garder uniquement ace-step.pinokio (ACE-Step 1.5)

echo ""
echo "Termine. Ouvrir Pinokio → Install + Start pour chaque app."
echo "Modeles : voir scripts/demeter-bootstrap/PINOKIO-STACK.md"
