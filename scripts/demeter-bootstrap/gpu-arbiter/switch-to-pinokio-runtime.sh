#!/usr/bin/env bash
set -euo pipefail

PIN=/mnt/ia/pinokio/api/gpu-arbiter
REPO="$HOME/Documents/devforge/scripts"

mkdir -p "$PIN"
rsync -a --delete --exclude node_modules --exclude .astro \
  "$REPO/pinokio-gpu-arbiter/" "$PIN/"

cp -f "$PIN/arbiter/demeter-gpu-arbiter.py" "$REPO/demeter-bootstrap/gpu-arbiter/"
cp -f "$PIN/arbiter/demeter-gpu" "$REPO/demeter-bootstrap/gpu-arbiter/"
chmod +x "$PIN/arbiter/demeter-gpu" "$PIN/arbiter/demeter-gpu-arbiter.py" \
  "$REPO/demeter-bootstrap/gpu-arbiter/demeter-gpu"

UNIT="$HOME/.config/systemd/user/demeter-gpu-arbiter.service"
cat > "$UNIT" << 'EOF'
[Unit]
Description=Demeter GPU Arbiter (LLM/ACE/Wan time-sharing) — Pinokio app
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/mnt/ia/pinokio/api/gpu-arbiter
Environment=PINOKIO_HOME=/mnt/ia/pinokio
Environment=IA_ROOT=/mnt/ia
Environment=DEMETER_REPO=%h/Documents/devforge
Environment=GPU_ARBITER_HOST=0.0.0.0
Environment=GPU_ARBITER_PORT=8790
Environment=GPU_ARBITER_DEFAULT=llm
Environment=GPU_ARBITER_IDLE_S=900
Environment=GPU_ARBITER_STEAM_PRIORITY=1
Environment=GPU_ARBITER_STEAM_POLL_S=5
Environment=GPU_ARBITER_STEAM_VRAM_MIN_MIB=400
Environment=GPU_ARBITER_STEAM_CLEAR_S=30
Environment=GPU_ARBITER_UI_DIST=/mnt/ia/pinokio/api/gpu-arbiter/ui/dist
Environment=GPU_ARBITER_LOG=/mnt/ia/logs/gpu-arbiter.log
ExecStart=/usr/bin/python3 /mnt/ia/pinokio/api/gpu-arbiter/arbiter/demeter-gpu-arbiter.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

cp -f "$UNIT" "$PIN/arbiter/demeter-gpu-arbiter.service"
cp -f "$UNIT" "$REPO/demeter-bootstrap/gpu-arbiter/demeter-gpu-arbiter.service"
cp -f "$UNIT" "$REPO/pinokio-gpu-arbiter/arbiter/demeter-gpu-arbiter.service"

# CLI always points at Pinokio arbiter binary helper in bootstrap (same API)
ln -sfn "$REPO/demeter-bootstrap/gpu-arbiter/demeter-gpu" "$HOME/.local/bin/demeter-gpu"

systemctl --user daemon-reload
systemctl --user enable demeter-gpu-arbiter.service
systemctl --user restart demeter-gpu-arbiter.service
sleep 2

echo "=== STATUS ==="
systemctl --user is-enabled demeter-gpu-arbiter.service
systemctl --user is-active demeter-gpu-arbiter.service
systemctl --user show demeter-gpu-arbiter.service -p ExecStart,WorkingDirectory --no-pager
ps -u bobdivx -o pid,cmd | grep demeter-gpu-arbiter | grep -v grep || true

echo "=== SMOKE ==="
curl -sf http://127.0.0.1:8790/health
echo
curl -sf http://127.0.0.1:8790/ | head -c 100
echo
curl -sf http://127.0.0.1:8790/status | head -c 200
echo
demeter-gpu status 2>/dev/null | head -c 300 || true
echo
journalctl --user -u demeter-gpu-arbiter.service -n 5 --no-pager
echo "OK — runtime = Pinokio app + systemd auto-start"
