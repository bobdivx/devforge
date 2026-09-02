#!/usr/bin/env bash
# Migre les donnees IA vers le disque monte (label IA, ex. /mnt/ia).
# Usage sur Demeter: bash scripts/demeter-bootstrap/migrate-to-ia-disk.sh
# Variables: IA_ROOT=/mnt/ia (defaut)
set -euo pipefail

IA_ROOT="${IA_ROOT:-/mnt/ia}"
USER_NAME="${USER:-bobdivx}"
HOME_DIR="/home/${USER_NAME}"
OLD_PINOKIO="${PINOKIO_HOME:-$HOME_DIR/pinokio}"
NEW_PINOKIO="${IA_ROOT}/pinokio"
NEW_HOMARR="${IA_ROOT}/homarr/appdata"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OLD_HOMARR_REL="$SCRIPT_DIR/homarr-appdata"

if [[ ! -d "$IA_ROOT" ]] || ! mountpoint -q "$IA_ROOT" 2>/dev/null; then
  echo "ERREUR: $IA_ROOT absent ou non monte (label IA attendu)." >&2
  exit 1
fi

echo ">> Arret services IA"
pkill -f "bootstrap-demeter-final.sh" 2>/dev/null || true
pkill -f "litellm --config" 2>/dev/null || true
pkill -f "scripts/server/serve.cjs" 2>/dev/null || true
sleep 2

echo ">> Structure sur $IA_ROOT"
mkdir -p "$NEW_PINOKIO" "$NEW_HOMARR" "$IA_ROOT/logs"

if [[ -L "$OLD_PINOKIO" ]]; then
  echo "   pinokio deja un symlink — rien a deplacer"
elif [[ -d "$OLD_PINOKIO" ]] && [[ "$(realpath "$OLD_PINOKIO")" != "$(realpath "$NEW_PINOKIO")" ]]; then
  echo ">> Deplacement pinokio vers $NEW_PINOKIO"
  rsync -aH --info=progress2 "$OLD_PINOKIO/" "$NEW_PINOKIO/"
  mv "$OLD_PINOKIO" "${OLD_PINOKIO}.bak.$(date +%Y%m%d%H%M%S)"
  ln -sfn "$NEW_PINOKIO" "$OLD_PINOKIO"
elif [[ ! -e "$OLD_PINOKIO" ]]; then
  ln -sfn "$NEW_PINOKIO" "$OLD_PINOKIO"
fi

if [[ -d "$OLD_HOMARR_REL" ]] && [[ ! -L "$OLD_HOMARR_REL" ]]; then
  echo ">> Homarr appdata vers $NEW_HOMARR"
  rsync -aH "$OLD_HOMARR_REL/" "$NEW_HOMARR/"
  mv "$OLD_HOMARR_REL" "${OLD_HOMARR_REL}.bak.$(date +%Y%m%d%H%M%S)"
fi
ln -sfn "$NEW_HOMARR" "$OLD_HOMARR_REL" 2>/dev/null || true

echo ">> demeter.local.env"
ENV="$HOME_DIR/demeter.local.env"
touch "$ENV"
grep -q '^IA_ROOT=' "$ENV" 2>/dev/null || echo "IA_ROOT=$IA_ROOT" >> "$ENV"
sed -i "s|^PINOKIO_HOME=.*|PINOKIO_HOME=$NEW_PINOKIO|" "$ENV"
sed -i "s|^LITELLM_CONFIG=.*|LITELLM_CONFIG=$NEW_PINOKIO/litellm-config.yaml|" "$ENV"
sed -i "s|^HOMARR_DATA_DIR=.*|HOMARR_DATA_DIR=$NEW_HOMARR|" "$ENV"

echo ">> fstab (si UUID IA absent)"
UUID=$(blkid -s UUID -o value /dev/sdb1 2>/dev/null || true)
if [[ -n "$UUID" ]] && ! grep -q "$UUID" /etc/fstab 2>/dev/null; then
  echo "   Ajouter manuellement si besoin:"
  echo "   UUID=$UUID  $IA_ROOT  ext4  noatime  0  2"
fi

echo ">> Redemarrage Homarr"
if [[ -f "$SCRIPT_DIR/homarr.env" ]] && command -v docker >/dev/null 2>&1; then
  docker compose -f "$SCRIPT_DIR/docker-compose.homarr.yml" --env-file "$SCRIPT_DIR/homarr.env" up -d
fi

echo ">> Redemarrage LiteLLM + serve.cjs"
LITELLM_VENV="$NEW_PINOKIO/api/litellm-cursor-proxy/env/bin/litellm"
if [[ -x "$LITELLM_VENV" ]]; then
  nohup "$LITELLM_VENV" --config "$NEW_PINOKIO/litellm-config.yaml" --host 0.0.0.0 --port 4000 \
    >> "$IA_ROOT/logs/litellm.log" 2>&1 &
fi
SERVE="$NEW_PINOKIO/api/uncensored-local-studio/app/scripts/server/serve.cjs"
if [[ -f "$SERVE" ]]; then
  cd "$(dirname "$SERVE")/.."
  nohup node scripts/server/serve.cjs >> "$IA_ROOT/logs/uncensored-serve.log" 2>&1 &
fi

echo ""
echo "Termine."
echo "  Pinokio : $NEW_PINOKIO (symlink $OLD_PINOKIO)"
echo "  Homarr  : $NEW_HOMARR"
echo "  Logs IA : $IA_ROOT/logs"
df -h "$IA_ROOT"
