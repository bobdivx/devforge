#!/usr/bin/env bash
set -euo pipefail
LOG="$HOME/demeter-bootstrap-phase3.log"
exec > >(tee -a "$LOG") 2>&1
export PATH="/usr/bin:/usr/local/bin:$PATH"
PWD_FILE="$HOME/.demeter_sudo_pass"
SUDO() {
  if [[ -f "$PWD_FILE" ]]; then
    tr -d '\n' <"$PWD_FILE" | sudo -S "$@"
  else
    sudo "$@"
  fi
}

echo "=== Phase 3 $(date -Iseconds) ==="

echo ">> node/npm"
if ! command -v npm >/dev/null 2>&1; then
  SUDO pacman -S --noconfirm nodejs npm
fi
node -v
npm -v

echo ">> Pinokio (yay non-interactif)"
if ! command -v pinokio >/dev/null 2>&1; then
  yay -S --noconfirm --needed pinokio-bin \
    --answerclean All --answerdiff None --answerupgrade None --removemake --save 2>&1 | tail -15 || true
fi
command -v pinokio && pinokio --version 2>/dev/null || echo "pinokio: pas encore dans PATH"

APP="$HOME/pinokio/api/uncensored-local-studio/app"
echo ">> Uncensored setup.sh (retry)"
if [[ -f "$APP/scripts/setup/setup.sh" ]]; then
  cd "$APP"
  bash scripts/setup/setup.sh || echo "WARN: setup.sh exit non-zero — continuer"
fi

echo ">> npm install racine app"
cd "$APP"
if [[ -f package.json ]]; then npm install 2>&1 | tail -8; fi

echo ">> CUDA llama-server present?"
find "$APP/app/llm-backend" -path '*cuda*llama-server' 2>/dev/null | head -3 || echo "WARN: pas de binaire cuda encore"

echo ">> Demarrage serve.cjs"
pkill -f "scripts/server/serve.cjs" 2>/dev/null || true
cd "$APP"
nohup node scripts/server/serve.cjs >> "$HOME/pinokio/uncensored-serve.log" 2>&1 &
sleep 5
tail -5 "$HOME/pinokio/uncensored-serve.log" || true

echo ">> ACE-Step clone app"
A="$HOME/pinokio/api/ace-step.pinokio"
if [[ ! -d "$A/app" ]]; then
  git clone --depth 1 https://github.com/ace-step/ACE-Step-1.5.git "$A/app"
fi
if command -v uv >/dev/null 2>&1 && [[ -d "$A/app" ]]; then
  (cd "$A/app" && uv sync) 2>&1 | tail -5 || true
else
  SUDO pacman -S --noconfirm uv 2>/dev/null && (cd "$A/app" && uv sync) 2>&1 | tail -5 || true
fi

echo ">> Wan clone app"
W="$HOME/pinokio/api/wan"
if [[ ! -d "$W/app" ]]; then
  git clone --depth 1 https://github.com/deepbeepmeep/Wan2GP.git "$W/app" 2>&1 | tail -3 || true
fi

echo ">> Health"
for url in \
  "http://127.0.0.1:7575" \
  "http://127.0.0.1:4000/health/liveliness" \
  "http://127.0.0.1:10086/v1/models" \
  "http://127.0.0.1:1420/api/health"; do
  curl -sf -o /dev/null -w "%{url_effective} -> %{http_code}\n" "$url" 2>/dev/null || echo "$url -> FAIL"
done

echo "=== Phase 3 terminee ==="
