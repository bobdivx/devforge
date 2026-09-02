# Homarr — tuiles a configurer dans l UI (http://10.1.0.88:7575)

Apres le premier login Homarr, ajouter ces liens (URLs LAN — adapter ports studio Pinokio).

## Section « Demeter GPU »

| Nom | URL | Notes |
|-----|-----|--------|
| Pinokio | `http://127.0.0.1:42000` ou port Pinokio UI | Launcher apps IA |
| LLM Studio | `http://10.1.0.88:42065` | Port studio dynamique — mettre a jour si Pinokio redemarre |
| LiteLLM health | `http://10.1.0.88:4000/health/liveliness` | Widget health si dispo |
| llama-server | `http://10.1.0.88:10086/v1/models` | Agents DevForge |
| ComfyUI (Wan) | `http://10.1.0.88:8188` | Apres install ComfyUI |
| ACE-Step | port UI ACE apres install | Repo ace-step/ACE-Step-1.5 |

## Section « Externe »

| Nom | URL |
|-----|-----|
| Cursor tunnel | `https://agent.briseteia.me/cursor` |
| DevForge NAS | URL de ton instance DevForge |

## Widgets utiles

- **Docker** : actif si socket monte (voir docker-compose.homarr.yml)
- Integrations Homarr : Uptime Kuma, etc. (optionnel)

## VRAM

Homarr ne stoppe pas les process GPU. Utiliser Pinokio Stop / script mode avant changer LLM <-> Wan.

## Autostart

`docker compose ... up -d` + Pinokio Launch at startup = dashboard + apps au boot.
