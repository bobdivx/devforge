#!/usr/bin/env bash
# Demeter AI stack — démarrage au boot (systemd user)
set -euo pipefail

IA="${IA_ROOT:-/mnt/ia}"
PINOKIO="${PINOKIO_HOME:-$IA/pinokio}"
REPO="${HOME}/Documents/devforge"
H="${REPO}/scripts/demeter-bootstrap"
LOG_DIR="$IA/logs"
U="$PINOKIO/api/uncensored-local-studio/app"
L="$PINOKIO/api/litellm-cursor-proxy"

mkdir -p "$LOG_DIR"

# Attendre le disque IA (fstab peut être lent au boot)
for _ in $(seq 1 90); do
  if [[ -d "$PINOKIO/api" ]]; then
    break
  fi
  sleep 2
done

if [[ ! -d "$PINOKIO/api" ]]; then
  echo "ERROR: $PINOKIO/api introuvable après 180s"
  exit 1
fi

export PINOKIO_HOME="$PINOKIO"
export PATH="/usr/bin:/usr/local/bin:${PATH:-}"

# Homarr (docker restart=unless-stopped — relance si container arrêté)
if command -v docker >/dev/null 2>&1 && [[ -f "$H/docker-compose.homarr.yml" ]]; then
  if ! docker ps --format '{{.Names}}' | grep -qx homarr-demeter; then
    docker compose -f "$H/docker-compose.homarr.yml" --env-file "$H/homarr.env" up -d 2>>"$LOG_DIR/homarr-boot.log" || true
  fi
fi

# Uncensored serve.cjs (UI + llama-server)
if [[ -f "$U/scripts/server/serve.cjs" ]] && ! pgrep -f "scripts/server/serve.cjs" >/dev/null 2>&1; then
  cd "$U"
  export FRONTEND_PORT="${UNCENSORED_UI_PORT:-1420}"
  export LLM_PORT="${LLM_PORT:-10086}"
  export LLM_HOST="${LLM_HOST:-0.0.0.0}"
  nohup node scripts/server/serve.cjs >>"$LOG_DIR/uncensored-serve.log" 2>&1 &
  echo "uncensored-serve started pid $!"
fi

# LiteLLM proxy
if [[ -x "$L/env/bin/litellm" ]] && ! pgrep -f "litellm --config" >/dev/null 2>&1; then
  nohup "$L/env/bin/litellm" --config "$PINOKIO/litellm-config.yaml" --host 0.0.0.0 --port 4000 \
    >>"$LOG_DIR/litellm.log" 2>&1 &
  echo "litellm started pid $!"
fi

# Charger Qwen3 sur GPU (après serve.cjs, sans auto-load serve.cjs)
if [[ -x "$H/load-demeter-llm-gpu.sh" ]]; then
  nohup bash "$H/load-demeter-llm-gpu.sh" >>"$LOG_DIR/llm-gpu-load.log" 2>&1 &
fi

exit 0
