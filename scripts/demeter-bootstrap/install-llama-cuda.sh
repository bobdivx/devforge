#!/usr/bin/env bash
# CUDA prebuild officiel absent sur Linux — copie Vulkan (GPU NVIDIA via Vulkan)
set -euo pipefail
CUDA="/mnt/ia/pinokio/api/uncensored-local-studio/app/app/llm-backend/linux/cuda"
VULKAN="/mnt/ia/pinokio/api/uncensored-local-studio/app/app/llm-backend/linux/vulkan"
mkdir -p "$CUDA"
rm -rf "${CUDA:?}"/*
cp -a "$VULKAN"/. "$CUDA/"
chmod +x "$CUDA"/llama-server
"$CUDA/llama-server" --version | head -1
echo "GPU backend ready at $CUDA (Vulkan llama-server for NVIDIA)"

