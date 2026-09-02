#!/usr/bin/env bash
# Ports fixes Demeter — voir DEMETER-PORTS.md
set -euo pipefail

PINOKIO="${PINOKIO_HOME:-/mnt/ia/pinokio}"
API="$PINOKIO/api"

UNCENSORED_UI_PORT="${UNCENSORED_UI_PORT:-1420}"
LLM_PORT="${LLM_PORT:-10086}"
LITELLM_PORT="${LITELLM_PORT:-4000}"
WAN_PORT="${WAN_PORT:-8188}"
ACE_STEP_PORT="${ACE_STEP_PORT:-8001}"

patch_file() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  echo "  patch $f"
}

echo ">> Ports Pinokio fixes (Demeter)"
echo "   Uncensored UI=$UNCENSORED_UI_PORT LLM=$LLM_PORT LiteLLM=$LITELLM_PORT Wan=$WAN_PORT ACE=$ACE_STEP_PORT"

# Uncensored Local Studio
U="$API/uncensored-local-studio/start.js"
if [[ -f "$U" ]]; then
  cat >"$U" <<EOF
module.exports = {
  daemon: true,
  run: [
    {
      method: "local.set",
      params: {
        port: ${UNCENSORED_UI_PORT}
      }
    },
    {
      method: "shell.run",
      params: {
        env: {
          FRONTEND_PORT: "${UNCENSORED_UI_PORT}",
          LLM_PORT: "${LLM_PORT}",
          PORT: "${UNCENSORED_UI_PORT}"
        },
        path: "app",
        message: "{{platform === 'win32' ? path.join('app', 'tools', 'node-win', 'node.exe') : platform === 'darwin' ? './app/tools/node-mac/bin/node' : './app/tools/node-linux/bin/node'}} scripts/server/serve.cjs",
        on: [{
          event: "/backend.*ready/i",
          done: true
        }]
      }
    },
    {
      method: "local.set",
      params: {
        url: "http://localhost:${UNCENSORED_UI_PORT}"
      }
    }
  ]
}
EOF
  echo "  OK uncensored-local-studio/start.js"
fi

# Wan 2
W="$API/wan/start.js"
if [[ -f "$W" ]]; then
  cat >"$W" <<'EOF'
module.exports = async (kernel) => {
  const port = process.env.WAN_PORT || process.env.DEMETER_WAN_PORT || "8188"
  return {
    requires: {
      bundle: "ai",
    },
    daemon: true,
    run: [
      {
        method: "shell.run",
        params: {
          venv: "venv",
          env: {
            SERVER_NAME: "0.0.0.0",
            SERVER_PORT: port
          },
          path: "app",
          message: [
            "python wgp.py --multiple-images --advanced {{args.compile ? '--compile' : ''}}"
          ],
          on: [{
            "event": "/http:\/\/[0-9.:]+/",
            "done": true
          }]
        }
      },
      {
        method: "local.set",
        params: {
          url: `http://127.0.0.1:${port}`
        }
      }
    ]
  }
}
EOF
  echo "  OK wan/start.js (port 8188)"
fi

# ACE-Step 1.5
A="$API/ace-step.pinokio/start.js"
if [[ -f "$A" ]]; then
  cat >"$A" <<EOF
module.exports = {
  daemon: true,
  run: [
    {
      method: "local.set",
      params: {
        port: ${ACE_STEP_PORT}
      }
    },
    {
      method: "shell.run",
      params: {
        env: { },
        path: "app",
        message: [
          "uv run acestep --port ${ACE_STEP_PORT}{{platform === 'darwin' ? ' --init_service true --init_llm true --backend pt --lm_model_path acestep-5Hz-lm-1.7B' : ''}}"
        ],
        on: [{
          event: "/(http:\/\/[0-9.:]+)/",
          done: true
        }]
      }
    },
    {
      method: "local.set",
      params: {
        url: "http://localhost:${ACE_STEP_PORT}"
      }
    }
  ]
}
EOF
  echo "  OK ace-step.pinokio/start.js"
fi

# LiteLLM — déjà fixe dans devforge; synchroniser start.js local si besoin
L="$API/litellm-cursor-proxy/start.js"
REPO="${HOME}/Documents/devforge/scripts/pinokio-litellm-cursor-proxy/start.js"
if [[ -f "$REPO" ]] && [[ -d "$API/litellm-cursor-proxy" ]]; then
  cp -f "$REPO" "$L"
  echo "  OK litellm-cursor-proxy/start.js (depuis devforge, port ${LITELLM_PORT})"
fi

echo ""
echo "Termine. Redemarrer les apps dans Pinokio (Stop → Start)."
echo "Verifier: bash scripts/demeter-bootstrap/verify-demeter-ports.sh"
