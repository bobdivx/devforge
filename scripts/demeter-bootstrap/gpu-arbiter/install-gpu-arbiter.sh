#!/usr/bin/env bash
# Installe + active demeter-gpu-arbiter (systemd user)
# Source of truth : scripts/pinokio-gpu-arbiter/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../../.." && pwd)"
UNIT_SRC="$SCRIPT_DIR/demeter-gpu-arbiter.service"
UNIT_DST="${HOME}/.config/systemd/user/demeter-gpu-arbiter.service"
BIN_DST="${HOME}/.local/bin/demeter-gpu"

# Sync depuis le package Pinokio (arbiter + UI dist)
if [[ -f "$SCRIPT_DIR/sync-from-pinokio-package.sh" ]]; then
  bash "$SCRIPT_DIR/sync-from-pinokio-package.sh"
fi

mkdir -p "${HOME}/.config/systemd/user" "${HOME}/.local/bin" /mnt/ia/logs

# Ensure scripts exist under Documents/devforge (systemd path)
TARGET_REPO="${HOME}/Documents/devforge"
if [[ ! -d "$TARGET_REPO/scripts/demeter-bootstrap/gpu-arbiter" ]]; then
  mkdir -p "$TARGET_REPO/scripts/demeter-bootstrap"
  cp -a "$SCRIPT_DIR" "$TARGET_REPO/scripts/demeter-bootstrap/gpu-arbiter"
  mkdir -p "$TARGET_REPO/scripts"
  if [[ -d "$REPO/scripts/pinokio-gpu-arbiter" ]]; then
    cp -a "$REPO/scripts/pinokio-gpu-arbiter" "$TARGET_REPO/scripts/"
  fi
  for f in start-ace-step-studio-pinokio.sh load-demeter-llm-gpu.sh llm-start-gpu.json; do
    [[ -f "$SCRIPT_DIR/../$f" ]] && cp -f "$SCRIPT_DIR/../$f" "$TARGET_REPO/scripts/demeter-bootstrap/" || true
  done
else
  cp -a "$SCRIPT_DIR/." "$TARGET_REPO/scripts/demeter-bootstrap/gpu-arbiter/"
  if [[ -d "$REPO/scripts/pinokio-gpu-arbiter" ]]; then
    mkdir -p "$TARGET_REPO/scripts/pinokio-gpu-arbiter"
    rsync -a --delete "$REPO/scripts/pinokio-gpu-arbiter/" "$TARGET_REPO/scripts/pinokio-gpu-arbiter/" 2>/dev/null \
      || cp -a "$REPO/scripts/pinokio-gpu-arbiter/." "$TARGET_REPO/scripts/pinokio-gpu-arbiter/"
  fi
  cp -f "$SCRIPT_DIR/../start-ace-step-studio-pinokio.sh" "$TARGET_REPO/scripts/demeter-bootstrap/" 2>/dev/null || true
  cp -f "$SCRIPT_DIR/../load-demeter-llm-gpu.sh" "$TARGET_REPO/scripts/demeter-bootstrap/" 2>/dev/null || true
fi

chmod +x "$TARGET_REPO/scripts/demeter-bootstrap/gpu-arbiter/demeter-gpu"
chmod +x "$TARGET_REPO/scripts/demeter-bootstrap/gpu-arbiter/demeter-gpu-arbiter.py"
chmod +x "$TARGET_REPO/scripts/demeter-bootstrap/start-ace-step-studio-pinokio.sh" 2>/dev/null || true

cp -f "$UNIT_SRC" "$UNIT_DST"

ln -sfn "$TARGET_REPO/scripts/demeter-bootstrap/gpu-arbiter/demeter-gpu" "$BIN_DST"

# App Pinokio optionnelle
PINOKIO_API="${PINOKIO_HOME:-/mnt/ia/pinokio}/api"
if [[ -d "$PINOKIO_API" && -d "$TARGET_REPO/scripts/pinokio-gpu-arbiter" ]]; then
  mkdir -p "$PINOKIO_API/gpu-arbiter"
  rsync -a --delete --exclude node_modules "$TARGET_REPO/scripts/pinokio-gpu-arbiter/" "$PINOKIO_API/gpu-arbiter/" 2>/dev/null \
    || cp -a "$TARGET_REPO/scripts/pinokio-gpu-arbiter/." "$PINOKIO_API/gpu-arbiter/"
  echo "Pinokio app → $PINOKIO_API/gpu-arbiter"
fi

systemctl --user daemon-reload
systemctl --user enable --now demeter-gpu-arbiter.service
sleep 2
systemctl --user --no-pager status demeter-gpu-arbiter.service | head -15
curl -sf http://127.0.0.1:8790/status | head -c 400 || true
echo ""
echo "Dashboard: http://127.0.0.1:8790/  |  demeter-gpu status | use ace | use llm"
