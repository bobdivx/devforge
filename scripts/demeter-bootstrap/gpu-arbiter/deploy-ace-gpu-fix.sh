#!/usr/bin/env bash
# Déploie patches GPU arbiter + ACE Pinokio sur Demeter
set -euo pipefail
REPO="${HOME}/Documents/devforge"
SRC="${1:-/tmp/gpu-arbiter-deploy}"
BOOT="$REPO/scripts/demeter-bootstrap"

mkdir -p "$BOOT/gpu-arbiter"
cp -a "$SRC/." "$BOOT/gpu-arbiter/"
chmod +x "$BOOT/gpu-arbiter/"*.sh "$BOOT/gpu-arbiter/"*.py 2>/dev/null || true
chmod +x "$BOOT/gpu-arbiter/demeter-gpu" 2>/dev/null || true

# starter ACE + patch
cp -f /tmp/start-ace-step-studio-pinokio.sh "$BOOT/start-ace-step-studio-pinokio.sh" 2>/dev/null || true
cp -f /tmp/patch-ace-step-studio.sh "$BOOT/patch-ace-step-studio.sh" 2>/dev/null || true
chmod +x "$BOOT/start-ace-step-studio-pinokio.sh" "$BOOT/patch-ace-step-studio.sh" 2>/dev/null || true

cp -f "$BOOT/gpu-arbiter/acquire-gpu-slot.sh" /mnt/ia/pinokio/bin/acquire-gpu-slot.sh
chmod +x /mnt/ia/pinokio/bin/acquire-gpu-slot.sh

mkdir -p "${HOME}/.local/bin" "${HOME}/.config/systemd/user"
ln -sfn "$BOOT/gpu-arbiter/demeter-gpu" "${HOME}/.local/bin/demeter-gpu"
cp -f "$BOOT/gpu-arbiter/demeter-gpu-arbiter.service" "${HOME}/.config/systemd/user/"
cp -f "$BOOT/gpu-arbiter/litellm-gpu-proxy.service" "${HOME}/.config/systemd/user/" 2>/dev/null || true

PINOKIO_HOME=/mnt/ia/pinokio bash "$BOOT/patch-ace-step-studio.sh"

systemctl --user daemon-reload
systemctl --user restart demeter-gpu-arbiter.service
sleep 2
systemctl --user --no-pager is-active demeter-gpu-arbiter.service
curl -sf http://127.0.0.1:8790/status | head -c 300; echo

echo "==== Test: prepare ACE (stop LLM, no autostart) ===="
curl -sf -X POST http://127.0.0.1:8790/acquire \
  -H 'Content-Type: application/json' \
  -d '{"slot":"ace","owner":"deploy-test","timeout_s":180,"start":false}' | head -c 400
echo
nvidia-smi --query-gpu=memory.used --format=csv,noheader

echo "==== Start ACE via script ===="
ARBITER_SKIP_ACQUIRE=1 bash "$BOOT/start-ace-step-studio-pinokio.sh" || true

echo "==== Wait DiT / :8001 ===="
ok=0
for i in $(seq 1 90); do
  if curl -sf -o /dev/null --connect-timeout 2 http://127.0.0.1:8001/; then
    echo "ACE UI OK after ${i}s"
    ok=1
    break
  fi
  sleep 2
done
if [[ "$ok" != 1 ]]; then
  echo "ACE UI not ready — log:"
  tail -40 /tmp/ace-studio-run.log || true
  exit 1
fi

# Touch lease so idle timer starts from now
curl -sf -X POST http://127.0.0.1:8790/touch -H 'Content-Type: application/json' -d '{"owner":"deploy-test"}' >/dev/null || true
curl -sf http://127.0.0.1:8790/status; echo
grep -E 'DiT model initialized|OutOfMemory|OOM|Listening|Server running' /tmp/ace-studio-run.log | tail -10 || true
echo "DEPLOY OK"
