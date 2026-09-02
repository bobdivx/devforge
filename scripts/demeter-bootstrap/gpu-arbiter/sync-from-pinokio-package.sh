#!/usr/bin/env bash
# Synchronise demeter-bootstrap/gpu-arbiter depuis scripts/pinokio-gpu-arbiter (source of truth)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PKG="$REPO/scripts/pinokio-gpu-arbiter"

if [[ ! -f "$PKG/arbiter/demeter-gpu-arbiter.py" ]]; then
  echo "Package manquant: $PKG" >&2
  exit 1
fi

cp -f "$PKG/arbiter/demeter-gpu-arbiter.py" "$SCRIPT_DIR/"
cp -f "$PKG/arbiter/demeter-gpu" "$SCRIPT_DIR/"
cp -f "$PKG/arbiter/demeter-gpu-arbiter.service" "$SCRIPT_DIR/" 2>/dev/null || true
chmod +x "$SCRIPT_DIR/demeter-gpu" "$SCRIPT_DIR/demeter-gpu-arbiter.py"

# Build UI if needed
if [[ ! -f "$PKG/ui/dist/index.html" ]]; then
  echo "Build UI Astro…"
  (cd "$PKG/ui" && npm install && npm run build)
fi

# Drop-in UI next to systemd script (fallback si GPU_ARBITER_UI_DIST non défini)
mkdir -p "$SCRIPT_DIR/ui"
rm -rf "$SCRIPT_DIR/ui/dist"
cp -a "$PKG/ui/dist" "$SCRIPT_DIR/ui/dist"

echo "OK — arbiter + ui/dist synchronisés depuis pinokio-gpu-arbiter"
echo "  UI: $SCRIPT_DIR/ui/dist"
echo "  Lance: bash $SCRIPT_DIR/install-gpu-arbiter.sh"
