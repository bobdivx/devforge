#!/usr/bin/env bash
# Vérifie que les ports fixes Demeter répondent
set -euo pipefail

HOST="${DEMETER_HOST:-127.0.0.1}"
FAIL=0

check() {
  local name="$1"
  local url="$2"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 "$url" 2>/dev/null || echo "000")
  if [[ "$code" =~ ^(200|301|302|307|404)$ ]]; then
    echo "OK  $name  $url  ($code)"
  else
    echo "FAIL $name  $url  ($code)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== verify-demeter-ports $(date -Iseconds) host=$HOST ==="

check "Homarr" "http://${HOST}:7575"
check "Pinokio" "http://${HOST}:42000"
check "Uncensored UI" "http://${HOST}:1420/"
check "LiteLLM" "http://${HOST}:4000/health/liveliness"
check "llama API" "http://${HOST}:10086/v1/models"
check "Wan" "http://${HOST}:8188"
check "ACE-Step" "http://${HOST}:8001"

echo "--- listening ---"
ss -tlnp 2>/dev/null | grep -E ':7575|:42000|:1420|:4000|:10086|:8188|:8001' || true

if [[ "$FAIL" -gt 0 ]]; then
  echo "WARN: $FAIL service(s) down (normal si app non demarree dans Pinokio)"
fi
