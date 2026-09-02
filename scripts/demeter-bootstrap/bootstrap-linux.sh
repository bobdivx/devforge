#!/usr/bin/env bash
# Bootstrap Pinokio + LiteLLM sur Demeter (Linux).
# Usage: bash scripts/demeter-bootstrap/bootstrap-linux.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Charger secrets locaux si presents
if [[ -f "$HOME/demeter.local.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$HOME/demeter.local.env"
  set +a
fi

PINOKIO_HOME="${PINOKIO_HOME:-$HOME/pinokio}"
LITELLM_CONFIG="${LITELLM_CONFIG:-$PINOKIO_HOME/litellm-config.yaml}"
LITELLM_PORT="${LITELLM_PORT:-4000}"
BACKUP_API_PATH="${BACKUP_API_PATH:-}"
BACKUP_LITELLM_CONFIG="${BACKUP_LITELLM_CONFIG:-}"

echo ">> Demeter bootstrap Linux"
echo "   PINOKIO_HOME=$PINOKIO_HOME"

if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "WARN: nvidia-smi absent — installer les drivers NVIDIA avant Pinokio LLM."
fi

mkdir -p "$PINOKIO_HOME/api"

if [[ -n "$BACKUP_API_PATH" && -d "$BACKUP_API_PATH" ]]; then
  echo ">> Restauration api depuis $BACKUP_API_PATH"
  rsync -a --delete \
    --exclude 'node_modules' \
    --exclude 'llm-models' \
    --exclude 'models' \
    --exclude 'env' \
    --exclude 'venv' \
    --exclude '.venv' \
    "$BACKUP_API_PATH/" "$PINOKIO_HOME/api/"
fi

if [[ -n "$BACKUP_LITELLM_CONFIG" && -f "$BACKUP_LITELLM_CONFIG" ]]; then
  echo ">> Restauration litellm-config.yaml"
  cp -f "$BACKUP_LITELLM_CONFIG" "$LITELLM_CONFIG"
fi

# Installer app LiteLLM Pinokio (Linux — copie depuis devforge, pas PowerShell)
if [[ -f "$REPO_ROOT/scripts/pinokio-litellm-cursor-proxy/pinokio.json" ]]; then
  TARGET="$PINOKIO_HOME/api/litellm-cursor-proxy"
  mkdir -p "$TARGET"
  cp -f "$REPO_ROOT/scripts/pinokio-litellm-cursor-proxy/"*.{json,js} "$TARGET/" 2>/dev/null || true
  cp -f "$REPO_ROOT/scripts/pinokio-litellm-cursor-proxy/install.js" "$TARGET/"
  cp -f "$REPO_ROOT/scripts/pinokio-litellm-cursor-proxy/start.js" "$TARGET/"
  if [[ -f "$REPO_ROOT/scripts/pinokio-litellm-cursor-proxy/litellm-config.yaml.example" ]]; then
    cp -f "$REPO_ROOT/scripts/pinokio-litellm-cursor-proxy/litellm-config.yaml.example" "$TARGET/"
  fi
  cat > "$TARGET/ENVIRONMENT" <<EOF
# genere par bootstrap-linux.sh
LITELLM_CONFIG_PATH=$LITELLM_CONFIG
LITELLM_PORT=$LITELLM_PORT
LITELLM_HOST=0.0.0.0
PINOKIO_SCRIPT_AUTOLAUNCH=start.js
PINOKIO_SCRIPT_AUTOLAUNCH_ENABLED=true
EOF
  echo ">> App litellm-cursor-proxy copiee vers $TARGET"
fi

# Homarr (dashboard)
HOMARR_DIR="$SCRIPT_DIR"
if command -v docker >/dev/null 2>&1 && [[ -f "$HOMARR_DIR/docker-compose.homarr.yml" ]]; then
  if [[ ! -f "$HOMARR_DIR/homarr.env" ]]; then
    if [[ -f "$HOMARR_DIR/homarr.env.example" ]]; then
      cp -f "$HOMARR_DIR/homarr.env.example" "$HOMARR_DIR/homarr.env"
      if command -v openssl >/dev/null 2>&1; then
        KEY=$(openssl rand -hex 32)
        sed -i "s/^SECRET_ENCRYPTION_KEY=.*/SECRET_ENCRYPTION_KEY=$KEY/" "$HOMARR_DIR/homarr.env" 2>/dev/null || \
          sed -i '' "s/^SECRET_ENCRYPTION_KEY=.*/SECRET_ENCRYPTION_KEY=$KEY/" "$HOMARR_DIR/homarr.env" 2>/dev/null || true
      fi
      echo ">> homarr.env cree (editer si besoin)"
    fi
  fi
  if [[ -f "$HOMARR_DIR/homarr.env" ]]; then
    echo ">> Demarrage Homarr (docker compose)"
    docker compose -f "$HOMARR_DIR/docker-compose.homarr.yml" --env-file "$HOMARR_DIR/homarr.env" up -d
    HOMARR_PORT="${HOMARR_PORT:-7575}"
    echo "   Homarr : http://127.0.0.1:${HOMARR_PORT}"
  fi
else
  echo "WARN: Docker absent ou docker-compose.homarr.yml introuvable — Homarr manuel."
fi

echo ""
echo "Termine (partie script)."
echo "Homarr : configurer tuiles (voir homarr-tiles.md)"
echo "Apps Pinokio + modeles : voir PINOKIO-STACK.md"
echo "  bash scripts/demeter-bootstrap/clone-pinokio-apps.sh"
echo "Actions Pinokio UI (sur Demeter Linux) :"
echo "  1. Uncensored Local Studio — Install, Start, retélécharger GGUF Qwen3-Coder, contexte 49152"
echo "  2. LiteLLM Cursor Proxy — Install, Start"
echo "  3. Wan 2 (pinokiofactory/wan) — Install, Start"
echo "  4. ACE-Step 1.5 + Studio — Install, Start"
echo "  5. Cloudflare tunnel vers port $LITELLM_PORT"
echo "  6. Test: curl http://127.0.0.1:$LITELLM_PORT/health/liveliness"
