#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/bin:/usr/bin:/usr/local/bin:$PATH"
echo ">> use llm"
demeter-gpu use llm
echo "==== status ===="
demeter-gpu status
echo "==== vram ===="
nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader
pgrep -af llama-server | head -3 || echo no-llama
