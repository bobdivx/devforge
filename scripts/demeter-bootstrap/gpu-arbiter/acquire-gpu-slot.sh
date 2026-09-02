#!/usr/bin/env bash
# Libère la VRAM pour un slot GPU sans forcément démarrer la stack (Pinokio Start).
# Usage: acquire-gpu-slot.sh ace|llm|wan [owner]
set -euo pipefail

SLOT="${1:-ace}"
OWNER="${2:-pinokio}"
ARBITER="${GPU_ARBITER_URL:-http://127.0.0.1:8790}"
TIMEOUT="${GPU_ACQUIRE_TIMEOUT_S:-600}"
START="${GPU_ACQUIRE_START:-false}"  # false = Pinokio lance l'app ensuite

if ! curl -sf --connect-timeout 2 "${ARBITER}/health" >/dev/null 2>&1 \
  && ! curl -sf --connect-timeout 2 "${ARBITER}/status" >/dev/null 2>&1; then
  echo "WARN: GPU arbiter unreachable at ${ARBITER} — continuing without acquire"
  exit 0
fi

echo ">> GPU acquire slot=${SLOT} start=${START} owner=${OWNER}"
RESP=$(curl -sf -X POST "${ARBITER}/acquire" \
  -H 'Content-Type: application/json' \
  -d "{\"slot\":\"${SLOT}\",\"owner\":\"${OWNER}\",\"timeout_s\":${TIMEOUT},\"start\":${START}}" \
  || true)

echo "$RESP" | head -c 500
echo

# Attendre VRAM libre si on prépare ACE
if [[ "$SLOT" == "ace" && "$START" == "false" ]]; then
  for _ in $(seq 1 60); do
    USED=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ' || echo 99999)
    # LLM ~21k MiB ; après stop on vise < 3 Go libres pour charger ACE
    if [[ "${USED:-99999}" -lt 4000 ]]; then
      echo "OK VRAM free enough: ${USED} MiB used"
      exit 0
    fi
    sleep 1
  done
  echo "WARN: VRAM still high (${USED:-?} MiB) — ACE may OOM"
fi
exit 0
