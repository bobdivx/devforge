# Prompt Cursor — session Remote SSH sur Demeter (Linux)

Coller dans une conversation Cursor connectee a Demeter (`~/Documents/devforge`) :

---

Tu es sur **Demeter** — CachyOS, RTX 3090, `10.1.0.88`. **Linux only** (`~/pinokio`).

**Ne pas utiliser DevForge** pour cette tache. **Ne pas utiliser** les scripts `*.ps1` / `*.bat` Windows.

Lire :
- `scripts/demeter-bootstrap/README.md`
- `scripts/demeter-bootstrap/PINOKIO-STACK.md` ← apps + modeles obligatoires
- `scripts/demeter-bootstrap/homarr-tiles.md`
- `~/demeter.local.env` si present

Executer en autonomie sur Demeter :
1. `nvidia-smi`, Docker, `paru -S pinokio-bin` si besoin
2. `bash scripts/demeter-bootstrap/bootstrap-demeter-full.sh`
3. `bash scripts/demeter-bootstrap/clone-pinokio-apps.sh`
4. Pinokio UI : **Install + Start** pour :
   - Uncensored Local Studio (LLM `:10086`)
   - LiteLLM Cursor Proxy (`:4000`)
   - Wan 2 (`pinokiofactory/wan`)
   - ACE-Step 1.5 + ACE-Step Studio
5. **Retélécharger** GGUF Qwen3-Coder Q4_K_M, contexte **49152**
6. Cloudflare tunnel → LiteLLM `:4000`
7. Tuiles Homarr
8. Tests curl + `https://agent.briseteia.me/cursor`

Cursor : `master_key` dans `~/pinokio/litellm-config.yaml`.

---
