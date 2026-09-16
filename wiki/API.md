# API

Base : `/api/v1`. Auth : `Authorization: Bearer df_…` (sauf health, webhooks, join cluster, SSO callback).

Le front utilise `PUBLIC_SERVER_URL` en dev. En image Docker, UI et API sont le même origin `:8000`.

## Transversal

| Route | Rôle |
|-------|------|
| `GET /health` | Santé + backends |
| `GET /bootstrap` | Session, onboarding, cluster role |
| `POST /auth/register` · `/login` · `/logout` | Auth locale |
| `GET /me` | User courant |
| `GET/POST /onboarding` · `POST /onboarding/complete` | Wizard |

## Produit (extrait)

- **Projects** `GET/POST /projects` · `POST /projects/scaffold` · CRUD par uuid
- **Deployments** `POST /projects/{uuid}/deployments` · `GET /deployments/{uuid}/logs`
- **Agent** `POST /agent/chat` · `GET /agent/tools` · `POST /agent/tools/{tool}`
- **Env** `/projects/{uuid}/env`
- **Git** `/projects/{uuid}/git` · diff · discard
- **Preview** `/projects/{uuid}/preview` · start · stop
- **GitHub** `/github/status` · connect · repos · detect
- **Webhooks** `POST /webhooks/github`
- **Cluster** voir [[Cluster]]
- **MCP** `/mcp/tools` · `/mcp/servers` · `POST /mcp`
- **LLM** `/llm/catalog` · providers · connect
- **Runners** `/runners`
- **Tokens** `/tokens`
- **Update** `/update/check` · start · Cluster `/cluster/nodes/{id}/update` · `/cluster/update-workers`
- **Storage / backups** voir [[Stockage-et-sauvegardes]]
- **SSO** `/auth/sso/authorize` · `/callback` · `GET/PUT /settings/sso`

Admin : `/admin/overview` · patch workspace.

Worker : surface réduite (`/health`, `/bootstrap`, `/cluster/local`, `/internal/exec`, `/internal/update/*`).
