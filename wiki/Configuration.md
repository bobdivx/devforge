# Configuration serveur

La config **métier** (domaine, GitHub, LLM, SSO, S3 backups, SSH) est dans l’**UI**. Les variables ci-dessous sont pour le process, Docker, et les overrides rares.

## Toujours utiles

| Variable | Défaut | Rôle |
|----------|--------|------|
| `DATABASE_URL` | `sqlite:devforge.db?mode=rwc` | En prod Docker : `sqlite:/data/devforge.db?mode=rwc` |
| `HOST` / `PORT` | `0.0.0.0` / `8000` | Bind API + UI servie |
| `DEVFORGE_DATA_DIR` | `data/` à côté du programme (Windows) ; dossier XDG (Flatpak) ; `/data` en Docker | SQLite workdirs, backups |
| `DEVFORGE_STATIC_DIR` | `web/` à côté du programme, ou `share/devforge/web` (Flatpak) ; `/app/web` en Docker | Front built |
| `DEVFORGE_NO_BROWSER` | — | Désactive l’ouverture auto du navigateur (installateur / Flatpak) |
| `PUBLIC_SERVER_URL` | `http://127.0.0.1:8000/api/v1` | Base API côté front **dev** |
| `DEVFORGE_DOCKER_NETWORK` | `devforge` | Réseau partagé Traefik |
| `DEVFORGE_CORS_ORIGINS` | vide | Origines autorisées en prod |
| `DEVFORGE_ALLOW_REGISTER` | `0` | Inscription ouverte |
| `DEVFORGE_FORCE_LOCAL_LOGIN` | — | Casser `hide_local_login` |

## GitHub / webhooks

| Variable | Rôle |
|----------|------|
| `DEVFORGE_GITHUB_TOKEN` | PAT au boot (sinon Settings) |
| `DEVFORGE_GITHUB_WEBHOOK_SECRET` | HMAC webhooks |
| `DEVFORGE_ALLOW_INSECURE_WEBHOOK` | Lab only |
| `DEVFORGE_AUTO_DEPLOY_POLL_SECS` | Intervalle poller (~90) |

## Executor

| Variable | Rôle |
|----------|------|
| `DEVFORGE_EXECUTOR` | `auto` / `local` / `ssh` — jamais de stub silencieux |
| `DEVFORGE_SSH_HOST` · `_USER` · `_PORT` · `_KEY` | SSH si executor ssh/auto |

Sans SSH : executor **local** (Docker de la machine).

## LLM (override env ; l’UI providers prime en général)

`DEVFORGE_LLM_PROVIDER` = `auto` \| `stub` \| `openai` \| `openrouter` \| `ollama`  
`DEVFORGE_LLM_API_KEY` / `OPENAI_API_KEY` · `DEVFORGE_LLM_MODEL` · `DEVFORGE_LLM_BASE_URL`

`XAI_API_KEY` : clé de repli pour un provider **xAI (Grok)** créé sans clé (Réglages → LLM).
Modèle par défaut `grok-4.7`, API `https://api.x.ai/v1`.

Agents autonomes (Coordinateur, auto-réparation, agents cron/événement) : interrupteur
**Agents autonomes** dans la fiche d’un provider — il passe en tête pour ces agents, les autres
restent en repli. API : `GET/PUT /api/v1/llm/agents-provider` `{ "provider_id": "…" | null }`.

## Self-update

`DEVFORGE_VERSION` · `DEVFORGE_UPDATE_MODE` (`compose` / `docker` / `binary` / `auto`)  
`DEVFORGE_UPDATE_IMAGE` · `DEVFORGE_SELF_CONTAINER` · `DEVFORGE_UPDATE_COMPOSE_FILE` · `_SERVICE` · `DEVFORGE_UPDATE_REPO` · `_CHANNEL`

## Cluster

**Aucune** variable `DEVFORGE_CLUSTER_*` / `DEVFORGE_ROLE`. Join = UX. Voir [[Cluster]].

## Ce qui n’est pas de l’env

Backups S3 instance : **Settings → Sauvegardes**.
