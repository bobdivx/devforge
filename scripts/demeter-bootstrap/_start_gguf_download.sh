#!/usr/bin/env bash
set -euo pipefail
MODEL_DIR="/mnt/ia/pinokio/api/uncensored-local-studio/app/app/llm-models"
LOG="/mnt/ia/logs/gguf-download.log"
mkdir -p "$MODEL_DIR" /mnt/ia/logs
REPO="n00b001/Qwen3-Coder-30B-A3B-Instruct-Q4_K_M-GGUF"
GGUF_FILE="qwen3-coder-30b-a3b-instruct-q4_k_m.gguf"
nohup hf download \
  "$REPO" \
  "$GGUF_FILE" \
  --local-dir "$MODEL_DIR" \
  >> "$LOG" 2>&1 &
echo "GGUF download started, log: $LOG"
