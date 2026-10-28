---
name: devforge
description: Piloter une instance DevForge (PaaS auto-hébergé + atelier de code) via son serveur MCP. Utiliser quand l'utilisateur parle de ses projets DevForge, d'un déploiement, de logs de production, de variables d'environnement, d'une preview d'atelier ou d'une PR de correction.
---

# DevForge

Le serveur MCP `devforge` expose les outils de l'instance DevForge de l'utilisateur.
La connexion passe par OAuth (compte DevForge) : ne demande jamais de jeton ni de mot de passe.

## Commencer

1. `list_projects` pour trouver le projet, puis `get_project` (statut, dépôt, URL, derniers déploiements).
2. Garde le `project_uuid` : la plupart des outils l'attendent.

## Outils par usage

| Besoin | Outils |
| --- | --- |
| État d'un projet | `list_projects`, `get_project`, `list_deployments`, `get_deployment_logs` |
| Panne en production | `get_container_logs` (lecture seule, secrets masqués), `http_smoke` |
| Déployer | `trigger_deploy`, `cancel_deployment` |
| Variables d'environnement | `list_env_vars` (valeurs masquées), `upsert_env_var` |
| Code de l'atelier | `list_project_files`, `read_project_file`, `write_project_file`, `run_workdir_command`, `run_application_tests` |
| Preview d'atelier | `start_local_preview`, `local_preview_status`, `stop_local_preview` |
| GitHub | `read_github_file`, `github_list_prs`, `github_workflow_runs`, `create_github_fix`, `create_github_repo`, `publish_to_github`, `sync_workdir_to_github` |
| Agents et routines DevForge | `list_project_agents`, `list_agent_messages`, `list_agent_tool_failures`, `create_project_agent`, `delegate_task`, `list_routines`, `create_routine`, `delete_routine` |
| Mémoire | `memory_search`, `memory_write`, `memory_forget` |
| Autres MCP branchés sur DevForge | `mcp_list_servers`, `mcp_list_remote_tools`, `mcp_call_tool` |
| Divers | `propose_plan`, `sdd_loop`, `review_project_security`, `ask_user` |

## Règles

- Lis avant d'écrire : diagnostique avec les outils de lecture (logs, déploiements, fichiers) avant toute action.
- Demande l'accord explicite de l'utilisateur avant `trigger_deploy`, `publish_to_github`, `create_github_fix`, `create_github_repo`, `sync_workdir_to_github`, `upsert_env_var`, `delete_routine` et `cancel_deployment`. Ces actions touchent la production ou un dépôt.
- N'affiche jamais une valeur de secret, même si un outil la renvoie.
- Pour le code du projet, utilise `read_project_file` / `write_project_file`, jamais `mcp_call_tool`.
- Après un déploiement, vérifie avec `list_deployments` puis `http_smoke` sur l'URL du projet, et rapporte le résultat réel.

## Si la connexion échoue

Un 401 signifie que l'autorisation OAuth a expiré ou a été révoquée (DevForge → Compte → Tokens → Applications connectées).
Demande à l'utilisateur de reconnecter le serveur `devforge`.
