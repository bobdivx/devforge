# Homarr — tuiles a configurer dans l UI (http://10.1.0.88:7575)

Ports fixes — voir `DEMETER-PORTS.md`.

## Section « Demeter GPU »

| Nom | URL | Port |
|-----|-----|------|
| Pinokio | http://10.1.0.88:42000 | 42000 |
| Uncensored Studio | http://10.1.0.88:1420 | 1420 |
| LiteLLM | http://10.1.0.88:4000/health/liveliness | 4000 |
| llama-server (DevForge) | http://10.1.0.88:10086/v1 | 10086 |
| Wan 2 (Wan2GP) | http://10.1.0.88:8188 | 8188 |
| ACE-Step 1.5 | http://10.1.0.88:8001 | 8001 |

## Section « Externe »

| Nom | URL |
|-----|-----|
| Cursor (OpenAI API) | https://agent.briseteia.me/v1 |
| DevForge NAS | URL de ton instance DevForge |

## Vérifier les ports

```bash
bash scripts/demeter-bootstrap/verify-demeter-ports.sh
```

## VRAM

Homarr ne stoppe pas les process GPU. Utiliser Pinokio Stop avant changer LLM ↔ Wan / ACE.
