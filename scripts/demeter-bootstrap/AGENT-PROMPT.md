# Prompt Cursor — session Remote SSH sur Demeter

Coller dans une conversation Cursor connectee a Demeter (workspace devforge) :

---

Tu es sur Demeter (RTX 3090), nouvelle install Linux.

**Ne pas utiliser DevForge** pour cette tache.

Stack cible : **Pinokio + Homarr** (portail http://10.1.0.88:7575).

Lire :
- `scripts/demeter-bootstrap/README.md`
- `scripts/demeter-bootstrap/homarr-tiles.md`
- `~/demeter.local.env` si present

Executer en autonomie :
1. `nvidia-smi`, Docker OK
2. `bash scripts/demeter-bootstrap/bootstrap-linux.sh`
3. Homarr : `cd scripts/demeter-bootstrap`, copier homarr.env, generer SECRET_ENCRYPTION_KEY, `docker compose -f docker-compose.homarr.yml --env-file homarr.env up -d`
4. Installer Pinokio Linux, restaurer api/ si BACKUP_API_PATH
5. Pinokio : Uncensored Local Studio + LiteLLM Cursor Proxy — Install, Start
6. Retelecharger GGUF, charger contexte **49152**
7. ComfyUI (Wan) + ACE-Step quand demande — tuiles Homarr selon homarr-tiles.md
8. Cloudflare tunnel → LiteLLM :4000
9. Tests curl + tunnel Cursor

Secrets : `~/demeter.local.env` et `homarr.env` — ne pas commiter.

Cursor : `https://agent.briseteia.me/cursor` + master_key litellm-config.yaml.

---
