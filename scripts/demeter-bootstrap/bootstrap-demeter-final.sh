#!/usr/bin/env bash
# Bootstrap final Demeter — tout sur /mnt/ia
set -euo pipefail
LOG="$HOME/demeter-bootstrap-final.log"
exec > >(tee -a "$LOG") 2>&1

IA="/mnt/ia"
PINOKIO="$IA/pinokio"
REPO="$HOME/Documents/devforge"
H="$REPO/scripts/demeter-bootstrap"
PASS_FILE="$HOME/.demeter_sudo_pass"

sudo_cmd() {
  if [[ -f "$PASS_FILE" ]]; then
    tr -d '\n' <"$PASS_FILE" | sudo -S "$@"
  else
    sudo "$@"
  fi
}

echo "=== FINAL $(date -Iseconds) ==="
export PATH="/usr/bin:/usr/local/bin:$PATH"
export PINOKIO_HOME="$PINOKIO"

# Pinokio data sur disque IA
mkdir -p "$PINOKIO" "$IA/logs" "$IA/modeles"
ln -sfn "$PINOKIO" "$HOME/pinokio"
grep -q PINOKIO_HOME "$HOME/.bashrc" 2>/dev/null || \
  echo "export PINOKIO_HOME=$PINOKIO" >> "$HOME/.bashrc"

echo ">> Homarr SECRET_ENCRYPTION_KEY"
if [[ -f "$H/homarr.env" ]] && ! grep -q '^SECRET_ENCRYPTION_KEY=.\{32\}' "$H/homarr.env"; then
  KEY=$(openssl rand -hex 32)
  if grep -q '^SECRET_ENCRYPTION_KEY=' "$H/homarr.env"; then
    sed -i "s/^SECRET_ENCRYPTION_KEY=.*/SECRET_ENCRYPTION_KEY=$KEY/" "$H/homarr.env"
  else
    echo "SECRET_ENCRYPTION_KEY=$KEY" >> "$H/homarr.env"
  fi
fi
grep -q HOMARR_DATA_DIR "$H/homarr.env" || echo "HOMARR_DATA_DIR=$IA/homarr/appdata" >> "$H/homarr.env"

echo ">> Paquets systeme (pinokio)"
sudo_cmd pacman -S --noconfirm libnss_nis npm base-devel libvips 2>&1 | tail -5 || true
if ! command -v pinokio >/dev/null 2>&1; then
  yay -S --noconfirm --needed pinokio-bin \
    --answerclean All --answerdiff None --answerupgrade None --removemake --save \
    2>&1 | tail -20 || true
fi
command -v pinokio && pinokio --version 2>/dev/null || echo "WARN: pinokio absent"

echo ">> Clone apps si besoin"
bash "$H/clone-pinokio-apps.sh" 2>&1 | tail -10

U="$PINOKIO/api/uncensored-local-studio"
echo ">> Uncensored app + setup"
if [[ ! -d "$U/app" ]]; then
  git clone --depth 1 https://github.com/techjarves/Uncensored-Local-Studio.git "$U/app"
fi
cd "$U/app"
if [[ -f scripts/setup/setup.sh ]]; then
  bash scripts/setup/setup.sh || echo "WARN setup.sh partial"
fi
if [[ -f package.json ]]; then npm install 2>&1 | tail -5 || true; fi

echo ">> litellm venv"
L="$PINOKIO/api/litellm-cursor-proxy"
if [[ -d "$L" ]]; then
  cd "$L"
  [[ -x env/bin/litellm ]] || (python3 -m venv env && source env/bin/activate && pip install -q "litellm[proxy]>=1.97.0")
fi

if [[ ! -f "$PINOKIO/litellm-config.yaml" ]]; then
  cp -f "$REPO/scripts/pinokio-litellm-cursor-proxy/litellm-config.yaml.example" "$PINOKIO/litellm-config.yaml"
fi

echo ">> ACE-Step"
A="$PINOKIO/api/ace-step.pinokio"
[[ -d "$A/app" ]] || git clone --depth 1 https://github.com/ace-step/ACE-Step-1.5.git "$A/app"
command -v uv >/dev/null || sudo_cmd pacman -S --noconfirm uv 2>/dev/null || true
[[ -d "$A/app" ]] && (cd "$A/app" && uv sync 2>&1 | tail -3 || true)

echo ">> Wan"
W="$PINOKIO/api/wan"
[[ -d "$W/app" ]] || git clone --depth 1 https://github.com/deepbeepmeep/Wan2GP.git "$W/app" 2>&1 | tail -3 || true

echo ">> Demarrage services"
pkill -f "litellm --config" 2>/dev/null || true
pkill -f "scripts/server/serve.cjs" 2>/dev/null || true
sleep 2
if [[ -x "$L/env/bin/litellm" ]]; then
  nohup "$L/env/bin/litellm" --config "$PINOKIO/litellm-config.yaml" --host 0.0.0.0 --port 4000 \
    >> "$IA/logs/litellm.log" 2>&1 &
fi
if [[ -f "$U/app/scripts/server/serve.cjs" ]]; then
  cd "$U/app"
  nohup node scripts/server/serve.cjs >> "$IA/logs/uncensored-serve.log" 2>&1 &
fi
sleep 5

echo ">> Homarr docker"
cd "$H"
docker compose -f docker-compose.homarr.yml --env-file homarr.env up -d 2>&1 | tail -5

echo ">> GGUF Qwen3-Coder (si huggingface-cli dispo)"
MODEL_DIR="$U/app/app/llm-models"
mkdir -p "$MODEL_DIR"
GGUF="qwen3-coder-30b-a3b-instruct-q4_k_m.gguf"
if [[ ! -f "$MODEL_DIR/$GGUF" ]]; then
  sudo_cmd pacman -S --noconfirm huggingface-hub 2>/dev/null || pip install -q huggingface_hub 2>/dev/null || true
  if command -v huggingface-cli >/dev/null 2>&1; then
    huggingface-cli download Qwen/Qwen3-Coder-30B-A3B-Instruct-GGUF "$GGUF" \
      --local-dir "$MODEL_DIR" --local-dir-use-symlinks False 2>&1 | tail -10 &
    echo "GGUF download started in background"
  else
    echo "WARN: installer huggingface-hub pour GGUF"
  fi
else
  echo "GGUF deja present: $MODEL_DIR/$GGUF"
fi

echo ">> Health"
sleep 3
curl -sf -o /dev/null -w "homarr:%{http_code}\n" http://127.0.0.1:7575 || echo homarr:FAIL
curl -sf -o /dev/null -w "litellm:%{http_code}\n" http://127.0.0.1:4000/health/liveliness || echo litellm:FAIL
curl -sf -o /dev/null -w "llama:%{http_code}\n" http://127.0.0.1:10086/v1/models || echo llama:FAIL
curl -sf -o /dev/null -w "studio:%{http_code}\n" http://127.0.0.1:1420/api/health 2>/dev/null || echo studio:check_port

echo "=== DONE $(date -Iseconds) ==="
df -h "$IA" | tail -1
du -sh "$PINOKIO" 2>/dev/null
