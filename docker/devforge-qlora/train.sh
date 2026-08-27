#!/usr/bin/env bash
# Entraîne le LoRA Relanceur sur l'hôte GPU (Windows/Linux) qui sert déjà Ollama.
# Le NAS / ZimaOS n'a pas de GPU : ne pas ajouter ce service au compose NAS.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="${QLORA_IMAGE:-devforge-qlora}"
CREATE_OLLAMA=0
DATA=""
OUT=""

usage() {
  cat <<EOF
Usage: ./train.sh [--ollama] [data.jsonl] [output-dir]

  --ollama     Après l'export GGUF, exécute: ollama create devforge-relanceur -f Modelfile
  data.jsonl   JSONL ChatML (défaut: ./data/agent-sft.jsonl)
  output-dir   Répertoire de sortie adapter + GGUF + Modelfile (défaut: ./output)

Variables:
  QLORA_IMAGE, QLORA_MAX_STEPS, QLORA_EPOCHS, QLORA_BATCH, QLORA_GRAD_ACCUM, QLORA_BASE_MODEL
  OLLAMA_HOST  (optionnel, CLI ollama locale ou distante — ne pas coder d'IP en dur)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --ollama)
      CREATE_OLLAMA=1
      shift
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "Option inconnue: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      if [[ -z "$DATA" ]]; then
        DATA="$1"
      elif [[ -z "$OUT" ]]; then
        OUT="$1"
      else
        echo "Argument en trop: $1" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

DATA="${DATA:-${QLORA_DATA:-$ROOT/data/agent-sft.jsonl}}"
OUT="${OUT:-${QLORA_OUT:-$ROOT/output}}"

if [[ ! -f "$DATA" ]]; then
  echo "JSONL introuvable: $DATA" >&2
  echo "Exporte d'abord: php artisan devforge:export-agent-sft --path=..." >&2
  exit 1
fi

mkdir -p "$OUT"
DATA_ABS="$(cd "$(dirname "$DATA")" && pwd)/$(basename "$DATA")"
OUT_ABS="$(cd "$OUT" && pwd)"

echo "[qlora] build image $IMAGE"
docker build -t "$IMAGE" "$ROOT"

echo "[qlora] train --gpus all"
docker run --rm --gpus all \
  -e QLORA_MAX_STEPS="${QLORA_MAX_STEPS:-60}" \
  -e QLORA_EPOCHS="${QLORA_EPOCHS:-0}" \
  -e QLORA_BATCH="${QLORA_BATCH:-2}" \
  -e QLORA_GRAD_ACCUM="${QLORA_GRAD_ACCUM:-4}" \
  -e QLORA_BASE_MODEL="${QLORA_BASE_MODEL:-unsloth/Qwen2.5-Coder-7B-Instruct-bnb-4bit}" \
  -e HF_HOME=/output/.cache/huggingface \
  -v "$DATA_ABS:/data/agent-sft.jsonl:ro" \
  -v "$OUT_ABS:/output" \
  "$IMAGE" \
  --input /data/agent-sft.jsonl \
  --output /output

if [[ "$CREATE_OLLAMA" -eq 1 ]]; then
  if ! command -v ollama >/dev/null 2>&1; then
    echo "ollama n'est pas dans le PATH. Installe la CLI sur l'hôte GPU, ou lance ollama create à la main :" >&2
    echo "  ollama create devforge-relanceur -f \"$OUT_ABS/Modelfile\"" >&2
    exit 1
  fi
  echo "[qlora] ollama create devforge-relanceur"
  (cd "$OUT_ABS" && ollama create devforge-relanceur -f ./Modelfile)
  echo "[qlora] modèle devforge-relanceur enregistré. Il apparaît dans le catalogue Ollama DevForge."
fi
