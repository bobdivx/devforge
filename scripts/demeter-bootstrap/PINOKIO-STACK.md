# Demeter — apps Pinokio et modeles a retélécharger

Checklist apres migration OS. Les GGUF / checkpoints **ne sont pas** dans la sauvegarde legere — tout doit etre retélécharge.

## Apps Pinokio (ordre recommande)

| Priorite | App | Repo launcher | Dossier `~/pinokio/api/` (→ `/mnt/ia/pinokio/api/`) | Role |
|----------|-----|---------------|--------------------------|------|
| 1 | **Uncensored Local Studio** | `cocktailpeanut/uncensored-local-studio.pinokio` | `uncensored-local-studio` | LLM local `:10086` — agents DevForge |
| 2 | **LiteLLM Cursor Proxy** | scripts devforge `pinokio-litellm-cursor-proxy` | `litellm-cursor-proxy` | Proxy `:4000` — Cursor Agent |
| 3 | **Wan 2** (video) | `pinokiofactory/wan` | `wan` | Wan2GP — generation video |
| 4 | **ACE-Step 1.5** | `cocktailpeanut/ace-step.pinokio` | `ace-step.pinokio` | Musique locale |
| 5 | **ACE-Step Studio** (optionnel) | `timoncool/ACE-Step-Studio-pinokio` | `ace-step-studio-pinokio` | UI studio musique / clips |

Dans Pinokio : **Install → Start → Launch at startup** pour chaque app (apres clone).

Clone automatique (sans Install Pinokio) :

```bash
bash scripts/demeter-bootstrap/clone-pinokio-apps.sh
```

Puis ouvrir Pinokio et cliquer **Install** sur chaque app (telecharge modeles + venv).

## Modeles LLM — agents DevForge + Cursor

| Usage | Modele | Format | Contexte | Port |
|-------|--------|--------|----------|------|
| **DevForge agents** (NAS) | `Qwen3-Coder-30B-A3B-Instruct` | GGUF **Q4_K_M** | **49152** min (charger via DevForge / Pinokio) | `10086` |
| **Cursor Agent** | alias LiteLLM `demeter-qwen3-coder` | meme GGUF via llama-server | **49152** | tunnel → `:4000` |

### Retéléchargement GGUF (Uncensored Local Studio)

1. Pinokio → Uncensored Local Studio → **Start**
2. UI studio → telecharger **Qwen3-Coder-30B-A3B-Instruct Q4_K_M** (Hugging Face, ~18 GB)
3. **Ne pas** lancer `llama-server` a la main — utiliser **Charger sur GPU** (DevForge ou UI)
4. Contexte : **49152** tokens (obligatoire pour Cursor Agent)
5. Desactiver auto-load dans `serve.cjs` si un ancien modele revient au boot :

```bash
SERVE=~/pinokio/api/uncensored-local-studio/app/scripts/server/serve.cjs
# editer serve.cjs ou retirer les blocs auto-load manuellement
```

Voir `docs/wiki/pinokio-uncensored-llm-setup.md` (chemins Linux : `~/pinokio`).

### LiteLLM (`~/pinokio/litellm-config.yaml`)

- `master_key` : cle Cursor (ex. `sk-demeter-cursor-2026`)
- `api_base` : `http://127.0.0.1:10086/v1`
- Modele alias : `demeter-qwen3-coder`

Cursor : `https://agent.briseteia.me/cursor` + `master_key`.

## Modeles Wan 2 (video)

- App **wan** (Wan2GP) : modeles telecharges au **premier Install/Start** dans Pinokio
- VRAM : arreter LLM avant Wan (3090 24 GB — un seul gros modele GPU a la fois)
- Tuile Homarr : port UI Wan (souvent dynamique — copier depuis Pinokio)

## Modeles ACE-Step (musique)

- **ACE-Step 1.5** : modeles Hugging Face au premier run (`ace-step.pinokio`)
- API optionnelle : `http://127.0.0.1:8001` (acestep-api)
- **ACE-Step Studio** : pull modeles au premier Install (PyTorch 2.7 + ACE-Step 1.5 XL)

## VRAM RTX 3090 (24 GB)

```
LLM Qwen3-Coder Q4 + ctx 49152  ≈ 20–23 GB  → pas de Wan/ACE en parallele
```

Workflow : **Stop** LLM dans Pinokio → Start Wan ou ACE-Step → Stop avant recharger LLM.

## Verification finale

```bash
curl -s http://127.0.0.1:7575          # Homarr
curl -s http://127.0.0.1:4000/health/liveliness   # LiteLLM
curl -s http://127.0.0.1:10086/v1/models          # llama-server (apres GGUF charge)
curl -s https://agent.briseteia.me/cursor/health/liveliness  # tunnel Cursor
```

## DevForge NAS (apres Demeter OK)

- URL studio Pinokio : port dynamique (~`42065`)
- URL LLM agents : `http://10.1.0.88:10086/v1`
- Parametres → AI → Demeter / Pinokio → `studio_base_url` + charger modele 49152
