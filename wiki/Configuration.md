# Configuration serveur

La config **métier** (domaine, GitHub, LLM, SSO, S3 backups, SSH) est dans l’**UI**. Les variables ci-dessous sont pour le process, Docker, et les overrides rares.

## Toujours utiles

| Variable | Défaut | Rôle |
|----------|--------|------|
| `DATABASE_URL` | `sqlite:devforge.db?mode=rwc` | En prod Docker : `sqlite:/data/devforge.db?mode=rwc` |
| `HOST` / `PORT` | `0.0.0.0` / `8000` | Bind API + UI servie |
| `DEVFORGE_DATA_DIR` | `data` | Workdirs, pending-join worker, backups locaux |
| `DEVFORGE_STATIC_DIR` | — | Front built (`/app/web` dans l’image) |
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

## Self-update

`DEVFORGE_VERSION` · `DEVFORGE_UPDATE_MODE` (`compose` / `docker` / `binary` / `auto`)  
`DEVFORGE_UPDATE_IMAGE` · `DEVFORGE_SELF_CONTAINER` · `DEVFORGE_UPDATE_COMPOSE_FILE` · `_SERVICE` · `DEVFORGE_UPDATE_REPO` · `_CHANNEL`

## Cluster

**Aucune** variable `DEVFORGE_CLUSTER_*` / `DEVFORGE_ROLE`. Join = UX. Voir [[Cluster]].

## Ce qui n’est pas de l’env

Backups S3 instance : **Settings → Sauvegardes**.
