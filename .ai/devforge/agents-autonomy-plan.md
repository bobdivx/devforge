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
13. ~~Todo agent~~ **fait** · ~~web_search~~ **fait** · ~~délégation parallèle~~ **fait** (`tasks[]` + queue) · cron libre · MCP client → **P6**  
14. **P5** collaboration multi-rôles (inspiration HERCULES, natif — voir section P5) 

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
12. Composer une équipe de rôles à la volée (sans runtime externe)  
13. Produire un rapport de contributions multi-agents  
14. (Optionnel) Exécuter du code en sandbox Docker isolé  

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
| P2 Cron libre | fait (`schedule_cron` + `agents:run-scheduled`) |
| P2 MCP client dans la boucle | reporté → P6 (hors chemin critique équipe native) |
| P3.1 Spawn async + yield_wait + handoff + rôles | fait |
| P3.2 Pipeline deploy orchestrator → leafs | fait |
| P3.3 Chat sous-agents parallèles + UI | fait |
| P3.4 Standing orders + heartbeats | fait (`ai_agent_standing_orders`, `agents:heartbeat`) |
| P4.0 Pipeline missions cross-agent | fait (`mission_claim` / assignee_type / `agents:work-missions`) |
| P4.1 request_user_input + reprise | fait (étend `ai_agent_key_requests` + inbox UI) |
| P4.2 Playbooks VT / implementer / bugs + tests | fait (`run_application_tests`, leaf implement/test, spawn depth 2) |
| P4.3 Kanban « Travail de l’équipe » | fait (`MissionBoardPanel` + `AgentUserRequestsInbox`) |
| P5.0 Role factory dynamique | fait (`AgentRoleFactory`, `spawn_task` auto_roles/roles[]) |
| P5.1 Collaboration multi-rôles (tools + LLM par rôle) | fait (allowlists distinctes + tierForRole + model_override) |
| P5.2 Mode débat / speaker selection | fait (`AgentCollabOrchestrator`, orchestration=collab) |
| P5.3 Team report + timeline contributions | fait (`AgentTeamReporter`, panneau Contributions) |
| P5.4 Sandbox code-exec (Docker) | à faire (opt-in) |
| P6 MCP client dans la boucle | optionnel |

## P3 — Patterns OpenClaw (natifs, sans runtime OpenClaw)

### P3.1 Fondations
- `spawn_task` async par défaut (`wait=true` pour sync)
- `yield_wait` → `waiting_for_subagents` + dispatch leafs
- Handoff `[Subagent Completion]` via `ResumeAgentAfterSubagentsJob`
- Rôles `main` / `orchestrator` / `leaf` + `agents_max_spawn_depth`

### P3.2 Deploy autonome
- `DeploymentFailureAgentDispatcher` lance un orchestrateur
- Pipeline diagnose → fix → redeploy (profils leaf) + review obligatoire

### P3.3 Chat
- Spawn parallèle async + indicateur sous-tâches UI
- Reprise chat via `queueMessage` après handoff

### P3.4 Ops
- Table `ai_agent_standing_orders` + API `/ai/standing-orders`
- Cron libre `schedule_cron` sur `ai_agents`
- Heartbeats `heartbeat_enabled` + `agents:heartbeat` (HEARTBEAT_OK silencieux)

## P4 — Équipe autonome (natif, sans runtime OpenClaw)

Objectif : VT propose → implementer code/teste → debug corrige bugs, avec mémoire partagée/individuelle et HITL uniquement pour secrets/tokens.

### P4.0 Pipeline missions
- `mission_create` / `mission_update` : `assignee_agent_uuid` **ou** `assignee_type`
- `mission_claim` / `mission_show`
- Routage kind → type : `tech_watch`/`feature`→`devforge`, `bug`→`debug`, `ops`→`deployment`
- `MissionWorkDispatcher` + cron `agents:work-missions` (toutes les 2 min)
- VT `upsertTechWatch` assigne `assignee_type=devforge` (plus d’auto-assignation)

### P4.1 Demande utilisateur
- Outil `request_user_input` (kind secret|token|confirm|text) → run `waiting_for_input`, mission `blocked`
- Fulfill injecte env (shared ou application) **sans renvoyer le secret au LLM**
- `ResumeAgentAfterUserInputJob` reprend le travail
- Inbox UI Agents + page Connexions

### P4.2 Rôles + tests
- Playbooks VT / debug / devforge orientés missions
- Leaf profiles `implement`, `test`, `research`
- `run_application_tests` (composer/pest/npm/pnpm ou docker exec)
- `agents_max_spawn_depth` défaut **2**
- Scanner VT enrichi (Docker tags, Node legacy)

### P4.3 Suivi
- Kanban missions : Ouvert / En cours / Bloqué (toi) / Terminé
- Timeline courte + badge actions requises

## P5 — Collaboration multi-rôles (inspiration HERCULES, **natif**)

> **Décision (2026-08-10)** : s’inspirer des patterns de [zeuslabs-ai/hercules](https://github.com/zeuslabs-ai/hercules)
> (génération de rôles, outils, speaker selection, reporting, multi-LLM) **sans aucune dépendance**
> runtime (`zeuslab`, AutoGen, hercules-ci-agent, CrewAI, etc.).
> Tout reste dans Laravel : `AgentRunner` / `AgentDelegator` / `AgentToolkit` / jobs existants.
>
> [hercules-ci-agent](https://github.com/hercules-ci/hercules-ci-agent) (CI Nix) est **hors périmètre**.

Objectif : passer d’une équipe **ops à profils leaf fixes** à une équipe capable de **composer des rôles
à la volée** pour une tâche (recherche, analyse, fix, review), tout en restant autonome et self-hostable.

### Non-négociables

- Zéro package Python / runtime swarm externe sur le chemin critique
- Les rôles dynamiques sont des **leafs éphémères** (ou presets persistés optionnels), pas un second runtime
- Budgets (`IterationBudget`, `max_rounds`, depth) inchangés en esprit — pas de boucles infinies
- HITL / permissions (`plan_first`, approvals, `request_user_input`) s’appliquent aux rôles dynamiques
- Mode débat **désactivé** par défaut sur les pipelines deploy/fix (trop cher / trop bruyant)

### Mapping features HERCULES → DevForge

| Feature HERCULES | Cible DevForge native | Item |
|------------------|----------------------|------|
| Dynamic Agent Generation | `AgentRoleFactory` + `spawn_task` enrichi | P5.0 |
| Role-Based Collaboration | rôles métier + filtre tools + LLM par rôle | P5.1 |
| Intelligent Orchestration / speaker selection | mode `collab` optionnel (auto / round_robin) | P5.2 |
| Comprehensive Reporting | `AgentTeamReporter` + UI timeline | P5.3 |
| Advanced Tool Integration | déjà `AgentToolkit` ; étendre registry custom | (existant + P5.1) |
| Code Execution Support | outil `execute_code` sandbox Docker | P5.4 |
| Multi-LLM Support | déjà multi-provider ; model override **par rôle** | P5.1 |
| Flexible Configuration | flags `config/devforge.php` + standing orders | transversal |

### P5.0 — Role factory dynamique

**Quoi**
1. Analyser la tâche (LLM light ou heuristique kind/mission) → proposer 2–5 rôles
2. Générer un system prompt par rôle (ou reprendre `custom_prompts` / standing orders)
3. Matérialiser via `AgentDelegator::spawn` (éphémère) avec `leaf_profile` étendu **ou** `role_slug` libre
4. Cap : `agents_max_dynamic_roles` (défaut 4), depth inchangée

**Fichiers**
- Nouveau : `AgentRoleFactory.php`
- Toucher : `AgentDelegator.php`, `AgentSubagentCapabilities.php`, `AgentPromptBuilder.php`
- Config : `agents_dynamic_roles_enabled`, `agents_max_dynamic_roles`
- Outil : `spawn_task` accepte `roles[]` **ou** `auto_roles=true`

**Critères de done**
- [x] `auto_roles=true` sur une mission tech_watch crée Researcher + Analyst (+ Writer si rapport)
- [x] Rôles hors catalogue leaf actuel restent bornés (tools + depth + budget)
- [x] Tests Pest Unit sur la factory (heuristique + aliases + cap concurrent)

### P5.1 — Collaboration par rôles (tools + LLM)

**Quoi**
1. Catalogue de rôles métier (en plus des leaf ops) : `researcher`, `analyst`, `writer`, `reviewer`, `implementer`, `tester`…
2. Mapping rôle → package tools autorisés (réutiliser `AgentToolPackage` / filtres mode chat)
3. Override modèle optionnel par rôle via `TaskModelRouter` (ex. researcher=Heavy, writer=Standard)
4. Handoff existant enrichi : chaque leaf rapporte `role_slug` + contribution courte

**Fichiers**
- `AgentSubagentCapabilities.php` (profils + tool allowlists)
- `TaskModelRouter.php` / metadata run `model_override`
- `AgentSubagentHandoff.php`

**Critères de done**
- [x] Un orchestrateur peut spawner `researcher` + `implementer` avec allowlists distinctes
- [x] Le modèle résolu peut différer entre deux leafs du même parent
- [x] Tests sur allowlist + routing

### P5.2 — Mode débat / speaker selection (optionnel)

**Quoi** — **pas** un GroupChat AutoGen : une boucle native bornée.

1. Mode run `orchestration=pipeline` (défaut, actuel) | `collab`
2. En `collab` : rounds de messages entre rôles actifs, sélection suivante :
   - `auto` : LLM orchestrateur choisit le prochain `role_slug`
   - `round_robin` : tour de rôle
3. `max_collab_rounds` (défaut 8) + arrêt précoce si consensus / `[DEVFORGE_DONE]`
4. **Interdit** (ou ignore) sur dispatchers deploy failure / fix-ci — rester pipeline

**Fichiers**
- Nouveau : `AgentCollabOrchestrator.php`
- Toucher : `AgentRunner.php` / `RunAgentJob` metadata
- Config : `agents_collab_enabled`, `agents_max_collab_rounds`

**Critères de done**
- [x] Tech-watch / design en `collab` produit un transcript multi-rôles + synthèse
- [x] Deploy failure reste en pipeline (test de non-régression dispatcher)
- [x] Budget tokens / rounds respecté

### P5.3 — Team report

**Quoi**
1. Après handoff (ou fin de collab) : `AgentTeamReporter` agrège contributions leafs
2. Persister sur le run parent : `metadata.team_report` (rôles, outils utilisés, décisions, risques)
3. UI : panneau « Contributions » sur détail run / mission (Preact)

**Fichiers**
- Nouveau : `AgentTeamReporter.php`
- Toucher : `AgentSubagentHandoff.php`, API run show, `AgentRunDetail.tsx` / mission panel

**Critères de done**
- [x] Un run multi-leaf expose un rapport structuré (JSON + résumé markdown)
- [x] UI affiche qui a fait quoi sans rejouer tout le log brut

### P5.4 — Sandbox code-exec (opt-in)

**Quoi**
1. Outil `execute_code` (langages bornés : php/node/python) dans un conteneur éphémère
2. Désactivé par défaut (`agents_code_sandbox_enabled=false`) ; jamais sur host Coolify
3. Timeout, no network (ou allowlist), volume workspace jetable
4. Distinct de `exec_command` SSH (infra) et de `run_application_tests` (app)

**Fichiers**
- Nouveau : `AgentCodeSandbox.php` + tool dans `AgentToolkit`
- Config + policy `AgentPermissionEngine`

**Critères de done**
- [ ] Opt-in only ; deny si flag off
- [ ] Test feature (Docker) : script trivial → stdout capturé dans tool result
- [ ] Pas d’accès au socket Docker host hors sandbox prévu

### Ordre d’implémentation recommandé

```
P5.0 Role factory  →  P5.1 tools/LLM par rôle  →  P5.3 reporting
                 ↘  P5.2 collab (après 5.0/5.1 stables)
P5.4 sandbox      →  parallèle / après sécurité revue
P6 MCP client     →  seulement si besoin d’outils externes non couverts
```

### Hors scope P5

- Dépendance `zeuslab` / AutoGen / LangGraph / CrewAI
- Workspace disque type IDE / gateway ZimaOS swarm
- Speaker selection « manual » interactif type notebook (le HITL DevForge suffit)
- Remplacer le pipeline deploy orchestrator→leafs (il reste le chemin critique)

## P6 — MCP client (optionnel)

- Client MCP **dans** la boucle agent (outils distants déclarés)
- Hors chemin critique : l’équipe native (P3–P5) doit fonctionner sans MCP
- Serveur `DevForgeServer` (repair) déjà opt-in — ne pas confondre avec le client

