#!/usr/bin/env bash
# Déplace LiteLLM en :4001 et active le proxy GPU auto-acquire sur :4000
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${HOME}/Documents/devforge"
PINOKIO="${PINOKIO_HOME:-/mnt/ia/pinokio}"
L="$PINOKIO/api/litellm-cursor-proxy"
LOG_DIR="/mnt/ia/logs"
CFG="$PINOKIO/litellm-config.yaml"

mkdir -p "$LOG_DIR" "$REPO/scripts/demeter-bootstrap/gpu-arbiter"
cp -a "$SCRIPT_DIR/." "$REPO/scripts/demeter-bootstrap/gpu-arbiter/"
chmod +x "$REPO/scripts/demeter-bootstrap/gpu-arbiter/"*.py

# Sync start helpers
cp -f "$SCRIPT_DIR/../start-ace-step-studio-pinokio.sh" "$REPO/scripts/demeter-bootstrap/" 2>/dev/null || true
cp -f "$SCRIPT_DIR/../load-demeter-llm-gpu.sh" "$REPO/scripts/demeter-bootstrap/" 2>/dev/null || true

# systemd units
mkdir -p "${HOME}/.config/systemd/user"
cp -f "$SCRIPT_DIR/demeter-gpu-arbiter.service" "${HOME}/.config/systemd/user/"
cp -f "$SCRIPT_DIR/litellm-gpu-proxy.service" "${HOME}/.config/systemd/user/"

# Stop public :4000 litellm, restart on :4001
echo ">> Relocate LiteLLM 4000 → 4001"
pkill -f 'litellm --config' 2>/dev/null || true
pkill -f 'litellm-gpu-proxy.py' 2>/dev/null || true
sleep 2
# free port if stuck
fuser -k 4000/tcp 2>/dev/null || true
fuser -k 4001/tcp 2>/dev/null || true
sleep 1

LITELLM_BIN="$L/env/bin/litellm"
[[ -x "$LITELLM_BIN" ]] || LITELLM_BIN="$L/app/env/bin/litellm"
[[ -x "$LITELLM_BIN" ]] || { echo "litellm binary missing"; exit 1; }
[[ -f "$CFG" ]] || { echo "missing $CFG"; exit 1; }

nohup "$LITELLM_BIN" --config "$CFG" --host 127.0.0.1 --port 4001 \
  >>"$LOG_DIR/litellm.log" 2>&1 &
echo "litellm internal pid $!"

for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:4001/health/liveliness >/dev/null; then
    echo "LiteLLM :4001 OK"
    break
  fi
  sleep 1
done

# Patch start.js / ENVIRONMENT so Pinokio also uses 4001 if restarted
ENVF="$L/ENVIRONMENT"
touch "$ENVF"
if grep -q '^LITELLM_PORT=' "$ENVF" 2>/dev/null; then
  sed -i 's/^LITELLM_PORT=.*/LITELLM_PORT=4001/' "$ENVF"
else
  echo 'LITELLM_PORT=4001' >> "$ENVF"
fi
if grep -q '^LITELLM_HOST=' "$ENVF" 2>/dev/null; then
  sed -i 's/^LITELLM_HOST=.*/LITELLM_HOST=127.0.0.1/' "$ENVF"
else
  echo 'LITELLM_HOST=127.0.0.1' >> "$ENVF"
fi

# Patch Pinokio start.js if present
START="$L/start.js"
if [[ -f "$START" ]] && grep -q '4000' "$START"; then
  sed -i 's/4000/4001/g' "$START" || true
  # ensure host loopback in message if possible
  echo "  patched $START → port 4001"
fi

# Also update demeter-ai start script copy if exists
AI="$REPO/scripts/demeter-bootstrap/start-demeter-ai.sh"
if [[ -f "$AI" ]]; then
  sed -i 's/--port 4000/--host 127.0.0.1 --port 4001/' "$AI" 2>/dev/null || true
fi

systemctl --user daemon-reload
systemctl --user enable --now demeter-gpu-arbiter.service
systemctl --user enable --now litellm-gpu-proxy.service
sleep 2

echo "==== status ===="
systemctl --user --no-pager is-active demeter-gpu-arbiter.service litellm-gpu-proxy.service
ss -tlnp | grep -E ':4000|:4001|:8790' || true
curl -sf -o /dev/null -w "proxy_health:%{http_code}\n" http://127.0.0.1:4000/health/liveliness || echo proxy_health:FAIL
curl -sf -o /dev/null -w "upstream:%{http_code}\n" http://127.0.0.1:4001/health/liveliness || echo upstream:FAIL
echo "OK — Cursor → :4000 (proxy) auto-acquire LLM → LiteLLM :4001"
