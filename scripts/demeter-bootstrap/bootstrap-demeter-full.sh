#!/usr/bin/env bash
# Bootstrap complet Demeter — executer SUR la machine (Remote SSH ou terminal local).
# Usage: bash scripts/demeter-bootstrap/bootstrap-demeter-full.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
USER_NAME="${USER:-bobdivx}"
PINOKIO_HOME="${PINOKIO_HOME:-/home/${USER_NAME}/pinokio}"
LITELLM_CONFIG="${LITELLM_CONFIG:-${PINOKIO_HOME}/litellm-config.yaml}"
LITELLM_PORT="${LITELLM_PORT:-4000}"

echo ">> Demeter full bootstrap"
echo "   REPO=$REPO_ROOT"
echo "   PINOKIO_HOME=$PINOKIO_HOME"

if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "WARN: nvidia-smi absent"
else
  nvidia-smi --query-gpu=name,memory.total --format=csv,noheader
fi

if ! command -v docker >/dev/null 2>&1; then
  echo ">> Installation Docker (sudo requis)"
  sudo pacman -S --noconfirm docker docker-compose
  sudo systemctl enable --now docker
  sudo usermod -aG docker "$USER_NAME"
  echo "   Reconnectez SSH si docker compose echoue (groupe docker)"
fi

mkdir -p "$PINOKIO_HOME"

if [[ ! -f "$HOME/demeter.local.env" ]]; then
  cp -f "$SCRIPT_DIR/demeter.local.env.example" "$HOME/demeter.local.env"
  sed -i "s|PINOKIO_HOME=.*|PINOKIO_HOME=${PINOKIO_HOME}|" "$HOME/demeter.local.env"
  sed -i "s|LITELLM_CONFIG=.*|LITELLM_CONFIG=${LITELLM_CONFIG}|" "$HOME/demeter.local.env"
  sed -i "s|/home/auber/|/home/${USER_NAME}/|g" "$HOME/demeter.local.env"
fi

if [[ ! -f "$LITELLM_CONFIG" ]]; then
  if [[ -f "$SCRIPT_DIR/litellm-config.demeter.yaml" ]]; then
    cp -f "$SCRIPT_DIR/litellm-config.demeter.yaml" "$LITELLM_CONFIG"
  else
    cp -f "$REPO_ROOT/scripts/pinokio-litellm-cursor-proxy/litellm-config.yaml.example" "$LITELLM_CONFIG"
  fi
  echo ">> litellm-config.yaml cree — verifier master_key"
fi

bash "$SCRIPT_DIR/bootstrap-linux.sh"
bash "$SCRIPT_DIR/clone-pinokio-apps.sh"

LITELLM_APP="$PINOKIO_HOME/api/litellm-cursor-proxy"
if [[ -d "$LITELLM_APP" ]]; then
  echo ">> Install LiteLLM venv"
  cd "$LITELLM_APP"
  python3 -m venv env
  source env/bin/activate
  pip install -q --upgrade pip
  pip install -q "litellm[proxy]>=1.97.0"
  deactivate
fi

UNCENSORED_DIR="$PINOKIO_HOME/api/uncensored-local-studio"
if [[ -d "$UNCENSORED_DIR/app" ]]; then
  echo ">> Uncensored setup.sh (peut prendre plusieurs minutes)"
  cd "$UNCENSORED_DIR/app"
  bash scripts/setup/setup.sh
fi

if command -v paru >/dev/null 2>&1 && ! command -v pinokio >/dev/null 2>&1; then
  echo ">> Installation Pinokio (paru)"
  paru -S --noconfirm pinokio-bin || echo "WARN: pinokio-bin — installer via paru manuellement"
fi

echo ">> Demarrage services (nohup)"
pkill -f "litellm --config" 2>/dev/null || true
if [[ -f "$LITELLM_APP/env/bin/litellm" ]]; then
  cd "$LITELLM_APP"
  source env/bin/activate
  nohup litellm --config "$LITELLM_CONFIG" --host 0.0.0.0 --port "$LITELLM_PORT" \
    > "$PINOKIO_HOME/litellm.log" 2>&1 &
  deactivate
fi

pkill -f "scripts/server/serve.cjs" 2>/dev/null || true
SERVE="$UNCENSORED_DIR/app/scripts/server/serve.cjs"
if [[ -f "$SERVE" ]]; then
  cd "$UNCENSORED_DIR/app"
  nohup node scripts/server/serve.cjs > "$PINOKIO_HOME/uncensored-serve.log" 2>&1 &
fi

sleep 5
echo ""
echo ">> Tests"
curl -sf -o /dev/null -w "Homarr :7575 -> %{http_code}\n" "http://127.0.0.1:7575" || echo "Homarr FAIL"
curl -sf -o /dev/null -w "LiteLLM :4000 -> %{http_code}\n" "http://127.0.0.1:${LITELLM_PORT}/health/liveliness" || echo "LiteLLM FAIL"
curl -sf -o /dev/null -w "llama :10086 -> %{http_code}\n" "http://127.0.0.1:10086/v1/models" || echo "llama-server FAIL (normal sans GGUF charge)"

echo ""
echo "Termine (infra Linux)."
echo "  Homarr     : http://10.1.0.88:7575"
echo "  LiteLLM    : http://10.1.0.88:${LITELLM_PORT}"
echo "  llama API  : http://10.1.0.88:10086/v1"
echo ""
echo "Suite obligatoire (Pinokio UI sur Demeter) :"
echo "  → PINOKIO-STACK.md (Wan, ACE-Step, retéléchargement GGUF, contexte 49152)"
echo "  pinokio   # Install + Start chaque app"
