# Demeter bootstrap — Pinokio + Homarr (CachyOS / Linux)

Machine GPU **Demeter** (`10.1.0.88`, RTX 3090) — **Linux uniquement**.

**Disque IA** : label `IA`, monté sur `/mnt/ia` (~900 Go).

```
/mnt/ia/pinokio/     ← apps Pinokio + modèles GGUF
/mnt/ia/homarr/      ← données Homarr
/mnt/ia/logs/        ← litellm, serve.cjs, gguf
```

`~/pinokio` → symlink vers `/mnt/ia/pinokio`.

## Démarrage rapide

```bash
cd ~/Documents/devforge && git pull

cp scripts/demeter-bootstrap/demeter.local.env.example ~/demeter.local.env
nano ~/demeter.local.env

# Première install ou réinstall complète
bash scripts/demeter-bootstrap/bootstrap-demeter-full.sh

# Après migration disque IA / stack stabilisée
bash scripts/demeter-bootstrap/bootstrap-demeter-final.sh
bash scripts/demeter-bootstrap/setup-demeter-boot.sh   # systemd user + linger
```

Ports fixes : **`DEMETER-PORTS.md`** · Apps + GGUF : **`PINOKIO-STACK.md`** · Homarr : **`homarr-tiles.md`**

## Services quotidiens

```bash
bash scripts/demeter-bootstrap/start-demeter-ai.sh      # Homarr + Uncensored + LiteLLM + GPU
bash scripts/demeter-bootstrap/verify-demeter-ports.sh  # health check
bash scripts/demeter-bootstrap/load-demeter-llm-gpu.sh  # charge Qwen3 49152 ctx
```

## DevForge (NAS)

**Paramètres AI → Providers & clés** : section **Local AI Studio (Pinokio)**

| Champ | Valeur |
|-------|--------|
| IP / hôte | `10.1.0.88` |
| Port Studio | `42000` |
| Port LLM | `10086` |

Ou provider **LiteLLM** : `https://agent.briseteia.me/v1` + modèle `demeter-qwen3-coder`.

## Fichiers

| Fichier | Rôle |
|---------|------|
| `bootstrap-demeter-full.sh` | Bootstrap initial (Docker, Homarr, clone apps, LiteLLM venv) |
| `bootstrap-demeter-final.sh` | Post-migration `/mnt/ia`, apps, GGUF, health |
| `bootstrap-linux.sh` | Homarr + app LiteLLM dans Pinokio |
| `setup-demeter-boot.sh` | systemd `demeter-ai.service`, patches serve.cjs |
| `start-demeter-ai.sh` | Démarre la stack AI |
| `stabilize-demeter.sh` | Correctifs Plasma X11, ports, sudo reboot |
| `clone-pinokio-apps.sh` | Clone Uncensored, LiteLLM, Wan, ACE-Step |
| `fix-demeter-pinokio-ports.sh` | Ports fixes dans `start.js` Pinokio |
| `verify-demeter-ports.sh` | Vérifie tous les ports |
| `load-demeter-llm-gpu.sh` | Charge le GGUF via API studio |
| `llm-start-gpu.json` | Paramètres GPU (49152 ctx, flash attn) |
| `litellm-config.demeter.yaml` | Config LiteLLM sans Postgres |
| `patch-serve-llm-host.sh` | `--host 0.0.0.0` dans serve.cjs |
| `patch-serve-context.sh` | Contexte max 49152 |
| `install-llama-cuda.sh` | Backend CUDA llama (Vulkan fallback) |
| `migrate-to-ia-disk.sh` | Migration vers `/mnt/ia` |
| `demeter.local.env.example` | Variables d'environnement |
| `legacy-windows/` | Anciens scripts PowerShell (Windows) — **ne pas utiliser sur Demeter** |

App Pinokio LiteLLM : `scripts/pinokio-litellm-cursor-proxy/`
