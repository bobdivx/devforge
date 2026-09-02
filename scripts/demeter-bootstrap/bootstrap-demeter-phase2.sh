#!/usr/bin/env bash
# Suite bootstrap Demeter — Pinokio + apps + setup (SSH)
set -euo pipefail

LOG="$HOME/demeter-bootstrap-phase2.log"
exec > >(tee -a "$LOG") 2>&1

PINOKIO_HOME="${PINOKIO_HOME:-$HOME/pinokio}"
API="$PINOKIO_HOME/api"
REPO="$HOME/Documents/devforge"

echo "=== Phase 2 $(date -Iseconds) ==="

if ! command -v pinokio >/dev/null 2>&1; then
  echo ">> Install pinokio-bin (paru)"
  if command -v paru >/dev/null 2>&1; then
    paru -S --noconfirm pinokio-bin || paru -S pinokio-bin
  else
    echo "WARN: paru absent — installer pinokio manuellement"
  fi
fi
command -v pinokio && pinokio --version 2>/dev/null || true

echo ">> Uncensored Local Studio — clone app + setup.sh"
U="$API/uncensored-local-studio"
if [[ ! -d "$U/app" ]]; then
  git clone --depth 1 https://github.com/techjarves/Uncensored-Local-Studio.git "$U/app"
fi
if [[ -f "$U/app/scripts/setup/setup.sh" ]]; then
  cd "$U/app"
  bash scripts/setup/setup.sh
fi

echo ">> ACE-Step 1.5 — clone app"
A="$API/ace-step.pinokio"
if [[ ! -d "$A/app" ]]; then
  cd "$A"
  # install.js clones ACE-Step-1.5
  git clone --depth 1 https://github.com/ace-step/ACE-Step-1.5.git app || true
fi
if [[ -d "$A/app" ]] && command -v uv >/dev/null 2>&1; then
  cd "$A/app" && uv sync || true
elif [[ -d "$A/app" ]]; then
  echo ">> uv absent — pacman -S uv ou Install via Pinokio UI"
  sudo pacman -S --noconfirm uv 2>/dev/null && cd "$A/app" && uv sync || true
fi

echo ">> Wan 2 — install deps (si install.js present)"
W="$API/wan"
if [[ -f "$W/install.js" ]] && [[ ! -d "$W/app" ]]; then
  cd "$W"
  git clone --depth 1 https://github.com/deepbeepmeep/Wan2GP.git app 2>/dev/null || \
    git clone --depth 1 https://github.com/pinokiofactory/wan.git _meta 2>/dev/null || true
fi

echo ">> Desactiver auto-load serve.cjs si present"
SERVE="$U/app/scripts/server/serve.cjs"
if [[ -f "$SERVE" ]] && ! grep -q AUTO_LOAD_DISABLED "$SERVE" 2>/dev/null; then
  sed -i 's/const AUTO_LOAD/\/\/ AUTO_LOAD_DISABLED\nconst AUTO_LOAD/' "$SERVE" 2>/dev/null || true
fi

echo ">> Demarrage serve.cjs (Uncensored)"
pkill -f "scripts/server/serve.cjs" 2>/dev/null || true
if [[ -f "$SERVE" ]]; then
  cd "$U/app"
  nohup node scripts/server/serve.cjs >> "$PINOKIO_HOME/uncensored-serve.log" 2>&1 &
  sleep 3
fi

echo ">> LiteLLM (redemarrage)"
pkill -f "litellm --config" 2>/dev/null || true
L="$API/litellm-cursor-proxy"
if [[ -f "$L/env/bin/litellm" ]]; then
  cd "$L" && source env/bin/activate
  nohup litellm --config "$PINOKIO_HOME/litellm-config.yaml" --host 0.0.0.0 --port 4000 \
    >> "$PINOKIO_HOME/litellm.log" 2>&1 &
  deactivate
fi

sleep 5
echo ">> Health"
curl -sf -o /dev/null -w "homarr:%{http_code}\n" http://127.0.0.1:7575 || echo homarr:FAIL
curl -sf -o /dev/null -w "litellm:%{http_code}\n" http://127.0.0.1:4000/health/liveliness || echo litellm:FAIL
curl -sf -o /dev/null -w "llama:%{http_code}\n" http://127.0.0.1:10086/v1/models || echo llama:FAIL
curl -sf -o /dev/null -w "uncensored:%{http_code}\n" http://127.0.0.1:1420/api/health 2>/dev/null || echo uncensored:check_pinokio_port

echo "=== Phase 2 terminee $(date -Iseconds) ==="
echo "Suite manuelle Pinokio UI: Wan + ACE Start, telecharger GGUF Qwen3-Coder, ctx 49152, cloudflared"
