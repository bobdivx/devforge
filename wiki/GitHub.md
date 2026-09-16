# GitHub

## Connexion instance

Settings → GitHub : coller un PAT (`ghp_…` ou fine-grained). Le server vérifie `GET /user` et recharge le client **sans restart**.

Scopes utiles :

- `repo` — clone privé, create repo (builder)
- `admin:repo_hook` — création auto des webhooks auto-deploy
- `workflow` — si tu manipules Actions

APIs :

| Route | Rôle |
|-------|------|
| `GET /api/v1/github/status` | connecté + user |
| `POST /api/v1/github/connect` | `{ "token": "…" }` admin |
| `DELETE /api/v1/github/connect` | déconnecter |
| `GET /api/v1/github/repos` | liste |
| `GET /api/v1/github/{owner}/{repo}/branches` | branches |
| `POST /api/v1/github/detect` | framework |

Priorité boot : `DEVFORGE_GITHUB_TOKEN` / `GITHUB_TOKEN`, sinon token Settings.

## Import projet

Projects → wizard repo → branche → detect → build pack.

## Builder

Tool `create_github_repo` (souvent via MCP GitHub). Sans MCP / PAT : l’agent indique Settings → MCP / GitHub.

## Actions

Onglet **Actions** du projet : résumé et runs GitHub Actions du repo.

## Runners self-hosted

Page **Runners** : enregistrement, sync, jobs, logs. Voir [[Runners]].

## GitHub App

L’alpha utilisait une GitHub App (JWT, installation, webhooks). **Pas encore porté** en v2 : PAT + webhooks repo.
