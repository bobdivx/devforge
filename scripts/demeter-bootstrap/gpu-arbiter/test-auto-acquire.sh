#!/usr/bin/env bash
set -euo pipefail
echo "=== 1. Switch to ACE ==="
curl -sf -X POST http://127.0.0.1:8790/acquire \
  -H 'Content-Type: application/json' \
  -d '{"slot":"ace","owner":"proxy-test","timeout_s":180}' | head -c 500
echo
sleep 3
python3 - <<'PY'
import json,urllib.request
d=json.load(urllib.request.urlopen("http://127.0.0.1:8790/status"))
print("slot",d.get("slot"),"llama",d["procs"].get("llama"),"ace",d["procs"].get("ace"),"vram",d.get("vram_used_mib"))
PY

echo "=== 2. Hit proxy /v1/models (auto-acquire llm) ==="
KEY=$(python3 - <<'PY'
import re
try:
    t=open("/mnt/ia/pinokio/litellm-config.yaml").read()
except Exception:
    t=""
m=re.search(r"master_key:\s*['\"]?([^'\"\s]+)", t)
print(m.group(1) if m else "")
PY
)
AUTH=()
if [[ -n "$KEY" ]]; then AUTH=(-H "Authorization: Bearer $KEY"); fi
START=$(date +%s)
curl -sf "${AUTH[@]}" http://127.0.0.1:4000/v1/models | head -c 400
echo
echo "elapsed_s=$(( $(date +%s) - START ))"

echo "=== 3. Status after ==="
python3 - <<'PY'
import json,urllib.request
d=json.load(urllib.request.urlopen("http://127.0.0.1:8790/status"))
print("slot",d.get("slot"),"owner",d.get("owner"),"llama",d["procs"].get("llama"),"ace",d["procs"].get("ace"),"vram",d.get("vram_used_mib"))
PY
echo "=== proxy log ==="
tail -10 /mnt/ia/logs/litellm-gpu-proxy.log 2>/dev/null || true
