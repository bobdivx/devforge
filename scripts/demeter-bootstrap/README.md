# Demeter bootstrap — Pinokio + Homarr + agents (sans DevForge)

Stack cible sur le nouvel OS Linux :

```
Homarr :7575          ← portail unique (tu choisis Homarr)
  → Pinokio           ← launcher LLM, LiteLLM, ComfyUI, ACE
  → ComfyUI           ← Wan 2 (UI metier)
  → ACE-Step          ← musique (UI metier)
```

DevForge (NAS) = reconfigurer plus tard si besoin.

## Ce que tu fais (minimum)

### 1. Avant formatage

- [ ] `litellm-config.yaml` (cle API Cursor)
- [ ] Export tunnel Cloudflare
- [ ] Clone devforge accessible (GitHub ou NAS)
- [ ] Sauvegarde `api/` optionnelle (configs Pinokio)

### 2. Sur le nouvel OS

1. NVIDIA : `nvidia-smi`
2. IP fixe `10.1.0.88` si possible
3. OpenSSH + Docker
4. `git clone` devforge (ex. `~/Documents/devforge`) ou `git pull` si deja clone
5. Cursor Remote SSH → Demeter

### 3. Fichier local

```bash
cp scripts/demeter-bootstrap/demeter.local.env.example ~/demeter.local.env
nano ~/demeter.local.env
```

### 4. Prompt agent Cursor

Voir `AGENT-PROMPT.md` (inclut Homarr).

## Homarr

```bash
cd devforge/scripts/demeter-bootstrap
cp homarr.env.example homarr.env
openssl rand -hex 32   # coller dans SECRET_ENCRYPTION_KEY
docker compose -f docker-compose.homarr.yml --env-file homarr.env up -d
```

UI : **http://10.1.0.88:7575**

Tuiles suggerees : `homarr-tiles.md`

## Ce que l agent fait

| Etape | Action |
|-------|--------|
| Homarr | Docker compose + autostart |
| Pinokio | Install, apps LLM + LiteLLM |
| GGUF | Retelecharger, contexte 49152 |
| ComfyUI / ACE | Install via Pinokio ou natif + tuiles Homarr |
| Tunnel | Cloudflare → LiteLLM :4000 |
| Tests | health, /v1/models, agent.briseteia.me/cursor |

## Fichiers

- `bootstrap-linux.sh`
- `docker-compose.homarr.yml`
- `homarr-tiles.md`
- `AGENT-PROMPT.md`
