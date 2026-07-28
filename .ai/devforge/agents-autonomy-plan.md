# Plan agents autonomes DevForge (Coolify)

> **Décision produit (2026-07-21)** : le dépôt **Forge / Ageton** sera **supprimé**.  
> **Coolify devient DevForge** (UI `/devforge` + branding). Toute capacité agent se porte **ici**, pas dans Forge.

## Objectif

Faire de DevForge un agent autonome opérationnel sur le PaaS Coolify : observer → diagnostiquer → corriger → redéployer → mémoriser → planifier → déléguer — avec un cadrage proche Cursor (modes, mémoire, until-done) sans recopier l’IDE Forge.

## État actuel (déjà livré)

| Capacité | Emplacement |
|----------|-------------|
| Boucle runner + chat tool-calling | `AgentRunner`, `AgentChatService` |
| Budget itérations | `IterationBudget`, `config/devforge.php` |
| Until-done + long-task | `AgentUntilDonePolicy`, `AgentChatLongTaskEnqueuer` |
| Mémoire agent / shared / project | `AgentMemoryService`, table `ai_agent_memories` |
| Permissions autonomous / tiered / plan_first | `AgentPermissionEngine` |
| Routing Gemini / Ollama / OpenAI / OpenRouter / Anthropic | `TaskModelRouter`, `LlmProviderFactory`, `LlmProviderRegistry` |
| ~45 outils Coolify + GitHub read | `AgentToolkit`, packages `core` / `github` |
| Dispatch deploy / build / readiness | `Deployment*Dispatcher` |
| Délégation `delegate_task` / `spawn_task` | `AgentDelegator` |
| MCP repair (opt-in) | `Mcp/Servers/DevForgeServer` |
| UI agents Preact | `frontend/src/pages/agents/`, `components/agents/` |

## Périmètre d’implémentation

### P0 — Cadrage autonomie (ce plan)

1. **Modes chat** `plan` | `build` | `debug` (prompt + filtre outils)
2. **Instructions layered** org / personnel / projet (config + injection prompt + API + UI minimale)
3. **Historique enrichi** (résumé des steps outils dans le contexte LLM)
4. **Compaction de contexte** (tronquer vieux tool results / messages)

### P1 — Puissance opérationnelle

5. **GitHub write** exposé LLM : create branch, write file, create/merge/comment PR
6. **Captures chat** : screenshot / annotation / élément (attachments → prompt)
7. **UI mémoire** : liste / ajout / clear (agent + shared)
8. **Approvals hors chat** : runs scheduled/event en `ask` → pause `awaiting_approval` (plus deny silencieux)

### P2 — Extension (après P0/P1)

9. ~~Streaming SSE token chat~~ **fait** (progression run via SSE + fallback polling)  
10. ~~Mission board bugs / features / veille~~ **fait** (`ai_agent_missions`, outils `mission_*`, UI Agents)  
11. ~~Watchers GitHub PR~~ **fait** · ~~tech-watch → demandes~~ **fait** (`agents:watch-tech`)  
12. ~~Providers OpenAI / Anthropic / OpenRouter~~ **fait**  
13. ~~Todo agent~~ **fait** · ~~web_search~~ **fait** · ~~délégation parallèle~~ **fait** (`tasks[]` + queue) · cron libre, MCP client dans la boucle  

### Hors scope (ne pas porter depuis Forge)

- Workspace disque / ZimaOS gateway / swarm `PARENT__APP_*`
- Self-modif HTTP catalogue Forge
- Economics AgentBudget Forge
- Branding / namespaces Docker `coolify` (inchangés techniquement)

## Capacités cibles produit

1. Observer infra équipe (apps, serveurs, DB, status, logs, métriques)  
2. Diagnostiquer échec build/deploy  
3. Corriger (env, settings, branche, permissions, patch code)  
4. Redeployer (1× max, traçable)  
5. Lire **et écrire** GitHub (PR, commentaires, fichiers)  
6. Mémoriser (agent / équipe / projet)  
7. Planifier avant mutation (mode Plan / plan_first)  
8. Demander clé ou approbation humaine  
9. Déléguer une sous-tâche  
10. Continuer une grosse tâche jusqu’à `[DEVFORGE_DONE]`  
11. Tourner en autonomie (planning + événements deploy)  

## Fichiers pivots à toucher

```
backend/app/Services/DevForge/Agent/
backend/app/Http/Controllers/DevForge/
backend/routes/devforge-agents.php
backend/config/devforge.php
backend/database/migrations/
frontend/src/components/agents/
frontend/src/pages/agents/
.ai/devforge/agents-autonomy-plan.md  ← ce document
```

## Critères de done P0+P1

- [x] Mode Plan bloque write/deploy ; Build/Debug autorisent mutations  
- [x] Instructions org/perso/projet injectées dans tout prompt agent  
- [x] Historique chat inclut résumé des tools des tours précédents  
- [x] Compaction active au-delà d’un seuil configurable  
- [x] Tools GitHub write dans package `github` + tests  
- [x] Chat accepte attachments capture → bloc prompt  
- [x] UI mémoire basique sur fiche agent  
- [x] Run event/scheduled en `ask` → `awaiting_approval` + API resolve  
- [x] Tests Pest Unit (écrits ; exécuter via Docker)  
- [x] Aucune dépendance runtime au dépôt Forge  
- [x] UI instructions layered (Paramètres → IA)  
- [x] UI captures chat (image / élément / annotation)  
- [x] Outils `todo_read` / `todo_write`  

## Migration / cutover Forge

1. Porter les concepts listés ici dans Coolify/DevForge (**fait pour P0/P1 + todo**).  
2. Vérifier DevForge en prod (`DEVFORGE_AGENTS_ENABLED=true`).  
3. Archiver puis **supprimer** le dépôt Forge.  
4. Mettre à jour docs : ce fichier + `.ai/README.md` (Forge hors périmètre = source d’inspiration **terminée**).

## Suivi d’implémentation

| Item | Statut |
|------|--------|
| P0 Modes Plan/Build/Debug | fait |
| P0 Instructions layered | fait (+ UI Paramètres → IA) |
| P0 Historique enrichi | fait |
| P0 Compaction contexte | fait |
| P1 GitHub write tools | fait |
| P1 Captures chat | fait (+ UI toolbar) |
| P1 UI mémoire | fait |
| P1 Approvals hors chat | fait |
| P2 Todo agent | fait |
| P2 web_search | fait |
| P2 Streaming SSE (progression run) | fait |
| P2 Providers OpenAI / OpenRouter / Anthropic | fait |
| P2 Watcher GitHub PR | fait (`agents:watch-github-prs`) |
| P2 Mission board | fait (`ai_agent_missions` + UI) |
| P2 Tech-watch → missions | fait (`agents:watch-tech`) |
| P2 Délégation parallèle / batch | fait (`tasks[]` spawn/delegate) |
| P2 Cron libre / MCP client | backlog |
