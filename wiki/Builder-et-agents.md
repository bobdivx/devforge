# Builder et agents

Les agents sont **attachés à un projet**, pas à une nav globale.

```
Workspace
 └── Projet
      ├── Agents required (Ops, Deploy, Reviewer) — seed à la création
      ├── Agents custom (utilisateur)
      └── Sous-agents spawnés pour une tâche (parent requis)
```

Chat toujours scoped `project_uuid`. Historique persisté.

## Rôles

| Kind | Qui | Exemple |
|------|-----|---------|
| `required` | Système | deploy, ops, reviewer |
| `custom` | Toi | Agent métier |
| `subagent` | Spawn parent | Fix tests, audit env |

## Posture

Les agents **agissent** : diagnostiquer → corriger (fichiers, env, deploy) → vérifier → rapporter. Ils ne se contentent pas de « tu devrais… ». Confirmation seulement pour actions destructives, choix produit ambigus, ou credentials manquants.

## Scaffold depuis un prompt

1. Wizard builder → `POST /api/v1/projects/scaffold` `{ title, prompt }`
2. Projet `draft` + agent Deploy seedé
3. Auto-kick idempotent du tour LLM (~500 ms)
4. Outils typiques : `create_github_repo` → `write_project_file` → `upsert_env_var` → `trigger_deploy` → logs / smoke
5. Workspace : messages + preview dès que l’app est `live`

Si le LLM est en **stub** : badge dans l’UI, pas de génération réelle. Configure **Settings → Agents / LLM**.

## API

- `GET/POST /api/v1/projects/{uuid}/agents`
- messages : `GET/DELETE .../agents/{agent}/messages`
- `POST /api/v1/agent/chat` (contexte + ~20 derniers tours)
- `GET/POST/DELETE /api/v1/llm/*` — providers (admin, hot-reload)

Tools locaux listés : `GET /api/v1/agent/tools`. Extensions : [[MCP]].
