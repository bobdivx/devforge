#!/usr/bin/env bash
set -euo pipefail
echo "=== 1. Force LLM (~21GB) ==="
curl -sf -X POST http://127.0.0.1:8790/acquire \
  -H 'Content-Type: application/json' \
  -d '{"slot":"llm","owner":"roundtrip","timeout_s":300,"start":true}' | head -c 350
echo
nvidia-smi --query-gpu=memory.used --format=csv,noheader
pgrep -af llama-server | head -2 || true

echo "=== 2. Pinokio-style prepare ACE (start=false) ==="
bash /mnt/ia/pinokio/bin/acquire-gpu-slot.sh ace pinokio-test
nvidia-smi --query-gpu=memory.used --format=csv,noheader
pgrep -af llama-server | head -1 || echo "llama stopped OK"

echo "=== 3. Start ACE ==="
ARBITER_SKIP_ACQUIRE=1 bash ~/Documents/devforge/scripts/demeter-bootstrap/start-ace-step-studio-pinokio.sh

echo "=== 4. Wait DiT ready (VRAM > 5GB or log) ==="
ok=0
for i in $(seq 1 60); do
  USED=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1 | tr -d ' ')
  if grep -q 'DiT model initialized successfully' /tmp/ace-studio-run.log 2>/dev/null; then
    # fresh success after our start — check last 30 lines
    if tail -40 /tmp/ace-studio-run.log | grep -q 'DiT model initialized successfully' \
      && ! tail -40 /tmp/ace-studio-run.log | grep -q 'OutOfMemoryError'; then
      echo "DiT OK at ${i}*3s VRAM=${USED}MiB"
      ok=1
      break
    fi
  fi
  if [[ "${USED:-0}" -gt 5000 ]] && curl -sf -o /dev/null http://127.0.0.1:8001/; then
    echo "VRAM loaded ${USED} MiB + UI up"
    ok=1
    break
  fi
  sleep 3
done
tail -25 /tmp/ace-studio-run.log | grep -E 'DiT|OOM|OutOfMemory|Error initializing|Server running' || tail -15 /tmp/ace-studio-run.log
curl -sf http://127.0.0.1:8790/status; echo
[[ "$ok" == 1 ]] || exit 1

echo "=== 5. Cursor hit should reclaim LLM ==="
curl -sf -o /dev/null -w "models:%{http_code}\n" http://127.0.0.1:4000/v1/models || true
sleep 2
curl -sf http://127.0.0.1:8790/status; echo
nvidia-smi --query-gpu=memory.used --format=csv,noheader
echo ROUNDTRIP_OK
