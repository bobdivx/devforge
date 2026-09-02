#!/usr/bin/env bash
# Alias — voir patch-serve-network.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$SCRIPT_DIR/patch-serve-network.sh"
