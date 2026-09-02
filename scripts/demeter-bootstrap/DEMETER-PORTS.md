# Demeter — ports fixes (stack AI)

Toutes les apps doivent utiliser ces ports pour Homarr, DevForge et le LAN.

| Service | Port | URL LAN | Config |
|---------|------|---------|--------|
| **Homarr** | `7575` | http://10.1.0.88:7575 | `homarr.env` / docker-compose |
| **Pinokio UI** | `42000` | http://10.1.0.88:42000 | défaut Pinokio 8 |
| **Uncensored Studio** (UI) | `1420` | http://10.1.0.88:1420 | `FRONTEND_PORT` / `start.js` |
| **llama-server** (API OpenAI) | `10086` | http://10.1.0.88:10086/v1 | `LLM_PORT` / `serve.cjs` |
| **LiteLLM** (Cursor proxy) | `4000` | http://10.1.0.88:4000 | `LITELLM_PORT` / `start.js` |
| **Wan 2** (Wan2GP) | `8188` | http://10.1.0.88:8188 | `SERVER_PORT` / `wan/start.js` |
| **ACE-Step 1.5** | `8001` | http://10.1.0.88:8001 | `--server-name 0.0.0.0 --port` / `start.js` |
| **Cloudflare tunnel** | — | https://agent.briseteia.me/v1 | → LiteLLM `:4000` (Cursor : Override OpenAI Base URL) |

## Appliquer les ports Pinokio

```bash
bash scripts/demeter-bootstrap/fix-demeter-pinokio-ports.sh
```

Puis dans Pinokio : **Stop** puis **Start** chaque app (ou redémarrer Pinokio).

## Vérifier

```bash
bash scripts/demeter-bootstrap/verify-demeter-ports.sh
```

## VRAM

Un seul gros modèle GPU à la fois (LLM ≈ 21 GB). Stop LLM avant Wan / ACE-Step.

## Autostart (sans Pinokio)

`demeter-ai.service` lance Homarr + Uncensored (`1420`) + LiteLLM (`4000`) + load GPU sur `10086`.
Wan / ACE ne sont **pas** autostart — lancer via Pinokio quand besoin.
