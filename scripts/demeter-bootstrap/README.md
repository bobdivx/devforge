# Demeter bootstrap — Pinokio + Homarr (CachyOS / Linux)

Machine GPU **Demeter** (`10.1.0.88`, RTX 3090) — **Linux uniquement** (`~/pinokio`, pas `D:\pinokio`).

```
Homarr :7575          ← portail
  → Pinokio           ← Uncensored LLM, LiteLLM, Wan 2, ACE-Step
```

DevForge (NAS) = reconfigurer apres Demeter OK.

## Sur Demeter (terminal ou Cursor Remote SSH)

```bash
cd ~/Documents/devforge
git pull

cp scripts/demeter-bootstrap/demeter.local.env.example ~/demeter.local.env
nano ~/demeter.local.env   # chemins Linux, tunnel Cloudflare si besoin

bash scripts/demeter-bootstrap/bootstrap-demeter-full.sh
```

Checklist apps + modeles a retélécharger : **`PINOKIO-STACK.md`**

## Homarr

```bash
cd ~/Documents/devforge/scripts/demeter-bootstrap
cp homarr.env.example homarr.env
openssl rand -hex 32   # SECRET_ENCRYPTION_KEY dans homarr.env
docker compose -f docker-compose.homarr.yml --env-file homarr.env up -d
```

UI : **http://10.1.0.88:7575** — tuiles : `homarr-tiles.md`

## Pinokio (CachyOS)

```bash
paru -S --noconfirm pinokio-bin    # ou AppImage depuis pinokio.co
bash scripts/demeter-bootstrap/clone-pinokio-apps.sh
pinokio   # UI → Install + Start sur chaque app
```

## SSH cle (optionnel — acces sans mot de passe)

Sur **Demeter** :

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N "" -C "demeter-local"
bash scripts/demeter-bootstrap/install-ssh-key-on-demeter.sh "$(cat ~/.ssh/id_ed25519.pub)"
```

Pour autoriser un **autre poste** (ex. PC Cursor) : coller sa cle publique avec le meme script.

## Fichiers

| Fichier | Role |
|---------|------|
| `bootstrap-demeter-full.sh` | Bootstrap tout-en-un Linux |
| `bootstrap-linux.sh` | Homarr + LiteLLM app |
| `clone-pinokio-apps.sh` | Clone wan, ace-step, uncensored, litellm |
| `PINOKIO-STACK.md` | Apps + GGUF / modeles obligatoires |
| `homarr-tiles.md` | Tuiles Homarr |
| `AGENT-PROMPT.md` | Prompt agent Cursor sur Demeter |

Scripts `*.ps1` / `*.bat` dans `scripts/` = ancienne machine **Windows** — ne pas utiliser sur Demeter.
