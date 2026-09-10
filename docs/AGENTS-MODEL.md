# Modèle agents DevForge

## Principe

Les **agents ne sont pas une app à part** dans la navigation.  
Ils sont **attachés à un project / une application**.

```
Team
 └── Project (app)
      ├── Agents obligatoires (créés à la création du project)
      ├── Agents utilisateur (optionnels)
      └── Sous-agents (spawnés à la demande pour une tâche)
```

## Rôles

| Kind | Qui | Exemple |
|------|-----|---------|
| `required` | Système, à la création du project | `deploy`, `ops`, `reviewer` |
| `custom` | Utilisateur | Agent métier dédié |
| `subagent` | Spawné par un agent parent pour une tâche | Fix tests, audit env |

## UX

- Nav globale : Accueil · Projects · Team · Settings (**pas** « Agent »)
- Nav project : Overview · Deployments · **Agents** · Domains · Env · Settings
- Chat agent = toujours dans le contexte d’un `project_uuid`

## Server

- `GET/POST /api/v1/projects/{uuid}/agents`
- `GET/DELETE /api/v1/projects/{uuid}/agents/{agent}/messages` — historique chat persisté
- `POST /api/v1/agent/chat` — contexte projet + historique LLM (20 derniers tours)
- `GET/POST/DELETE /api/v1/llm/*` — config provider (admin, hot-reload)
- Création project → seed des agents `required`
- Sous-agent : `POST .../agents` avec `kind=subagent` + `parent_agent_id`
