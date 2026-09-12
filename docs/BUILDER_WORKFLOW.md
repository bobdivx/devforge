# Builder Workflow — Scaffold → Deploy

Documentation du workflow complet de création de projet avec auto-déploiement.

## Vue d'ensemble

Le builder DevForge permet de créer un projet complet depuis un prompt utilisateur, avec déploiement automatique :

1. **Scaffold** : `POST /api/v1/projects/scaffold` crée le projet et seed l'agent deploy
2. **Auto-kick** : Le premier tour de l'agent démarre automatiquement après scaffold
3. **Workflow agent** : L'agent exécute `create_github_repo` → `write_project_file` → `trigger_deploy`
4. **Feedback** : Le statut est visible dans l'UI Workspace (agents panel + preview)

## Slices implémentées

### Slice 1 : Scaffold API + Seed
- Route : `POST /api/v1/projects/scaffold`
- Input : `{ title, prompt }`
- Crée le projet (status `draft`)
- Seed l'agent deploy avec un message utilisateur initial
- **Bug initial** : ne lançait PAS l'agent, juste l'INSERT du message

### Slice 2 : Agent Tools (GitHub + Files)
- `create_github_repo` : crée un dépôt GitHub via MCP et l'attache au projet
- `write_project_file` : écrit des fichiers dans le repo (mode local ou GitHub)

### Slice 3 : Auto-Deploy + Agent Kick
- **Fix du bug** : `trigger_agent_turn()` lance automatiquement le tour après scaffold
- `trigger_deploy` : outil agent pour déclencher le déploiement
- Système prompt mis à jour avec le workflow complet

## Détails techniques

### Backend : Auto-kick après scaffold

```rust
// apps/server/src/routes.rs - scaffold_project()

// Après avoir créé le seed message :
let state_clone = state.clone();
let uuid_clone = uuid.clone();
let agent_uuid_clone = agent_uuid.clone();
tokio::spawn(async move {
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    if let Err(e) = trigger_agent_turn(&state_clone, &uuid_clone, &agent_uuid_clone).await {
        eprintln!("[scaffold] Erreur auto-kick agent : {}", e);
    }
});
```

**Logique idempotente** : `trigger_agent_turn()` vérifie qu'il n'y a pas déjà de réponse assistant avant de lancer le LLM.

### Agent Tool : trigger_deploy

```rust
// crates/agent/src/tools/deploy.rs

pub struct TriggerDeployTool {
    pub store: Arc<dyn ProjectStore>,
}

// Déclenche le cycle complet : git sync → build → start
// Utilise l'infrastructure existante (DeployFacade, DeployRequest)
```

**Pré-requis** :
- `git_repository` configuré (fait par `create_github_repo`)
- `workdir` défini (par défaut `/data/devforge/applications/{slug}`)
- Fichiers écrits dans le repo

### Prompt système mis à jour

L'agent deploy a maintenant une section explicite pour le workflow scaffold :

```
SCAFFOLD DEPUIS PROMPT (builder slices 1+2+3) :
Si tu dois scaffolder un nouveau projet depuis un prompt utilisateur :
1. CRÉER LE REPO : utilise create_github_repo
2. ÉCRIRE LES FICHIERS : utilise write_project_file (mode='local' ou 'github')
3. CONFIGURER : ajoute les variables d'environnement avec upsert_env_var
4. DÉPLOYER : utilise trigger_deploy pour lancer le premier déploiement

Exemple workflow scaffold complet :
- create_github_repo → write_project_file (tous les fichiers) → 
  upsert_env_var (si nécessaire) → trigger_deploy → 
  get_deployment_logs → http_smoke
```

## Workflow utilisateur

### Côté utilisateur

1. **Créer un projet** : NewBuilderWizard → saisir titre + prompt
2. **Redirection** : vers `/app/projects/view?uuid={uuid}&tab=workspace`
3. **Agent démarre** : le chat agent montre immédiatement l'activité
4. **Suivi** : messages de l'agent + tools appelés visibles en temps réel
5. **Preview** : dès que le deploy réussit, l'iframe preview charge l'app

### Côté agent (automatique)

```
[user] Nouveau projet DevForge : Mon App
       Objectif : Application Next.js avec Tailwind

[assistant] 
✓ create_github_repo → user/mon-app créé
✓ write_project_file → package.json, app/page.tsx, tailwind.config.js...
✓ trigger_deploy → déploiement lancé (deployment_uuid: abc-123)
✓ get_deployment_logs → build nixpacks OK, conteneur démarré
✓ http_smoke → https://mon-app.example.com répond 200

Projet prêt ! 🚀
```

## Sécurités et gestion d'erreurs

### Idempotence
- `trigger_agent_turn()` vérifie `COUNT(*) role='assistant'` avant de lancer
- Évite les double-runs si l'utilisateur refresh la page

### Erreurs gérées
- **Git repo manquant** : `trigger_deploy` retourne `{"ok": false, "error": "git_repository manquant"}`
- **Workdir manquant** : idem, avec hint pour configurer
- **MCP GitHub absent** : `create_github_repo` guide vers Settings → MCP
- **LLM stub** : l'UI affiche un badge "LLM non configuré" mais l'agent peut quand même tourner en mode readonly

### Timeout
- Le tour d'agent n'a pas de timeout explicite (géré par LLM provider)
- Si le déploiement échoue, l'agent rapporte l'erreur et propose des corrections

## État du projet pendant le scaffold

| Étape                  | Status projet | Agent status | Messages                          |
|------------------------|---------------|--------------|-----------------------------------|
| Scaffold API           | `draft`       | `idle`       | 1 user (seed)                     |
| Auto-kick lancé        | `draft`       | `working`    | 1 user                            |
| Agent crée repo        | `draft`       | `working`    | 1 user, outils en cours           |
| Agent écrit fichiers   | `draft`       | `working`    | 1 user, outils en cours           |
| Agent deploy           | `deploying`   | `working`    | 1 user, outils en cours           |
| Deploy réussi          | `live`        | `idle`       | 1 user, 1 assistant (complet)     |
| Deploy échoué          | `failed`      | `idle`       | 1 user, 1 assistant (avec erreur) |

## Frontend

### ProjectAgentsPanel
- Affiche les agents du projet (ops, deploy, reviewer)
- Chat en temps réel avec messages + tools appelés
- Badge LLM status (ready / stub / offline)

### ProjectWorkspace
- Split view : chat à gauche, preview + logs à droite
- Preview iframe charge `production_url` dès que `status = 'live'`
- Logs de déploiement visibles dans le panneau de droite

### Auto-refresh (optionnel)
Le frontend **ne** déclenche **pas** de tour agent supplémentaire au chargement.
L'auto-kick backend est suffisant et idempotent.

## Déploiement

### Infrastructure existante réutilisée
- `DeployFacade::deploy()` : orchestration complète
- `DeployRequest` : struct avec tous les paramètres
- Routes `/api/v1/projects/{uuid}/deployments` : créer/lister déploiements
- `devforge-deploy` crate : git sync, build (nixpacks/dockerfile/static), conteneur Docker

### Aucune duplication
Le `trigger_deploy` tool **réutilise** exactement la même logique que `POST /api/v1/projects/{uuid}/deployments`.

## Tests manuels

### Cas nominal
```bash
# 1. Créer un projet via wizard
curl -X POST http://localhost:3030/api/v1/projects/scaffold \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"Test App","prompt":"Next.js simple avec Tailwind"}'

# 2. Observer l'agent dans l'UI
# → GET /api/v1/projects/{uuid}/agents/{agent}/messages
# → messages apparaissent en temps réel

# 3. Vérifier le déploiement
# → GET /api/v1/projects/{uuid}/deployments
# → status 'success', logs contiennent "Build successful"
```

### Cas d'erreur : MCP GitHub absent
```
[assistant]
❌ create_github_repo → KO
Serveur MCP GitHub non configuré. 
Configure GitHub dans Settings → MCP pour créer des dépôts.
```

### Cas d'erreur : build échoue
```
[assistant]
✓ create_github_repo → OK
✓ write_project_file → OK
✓ trigger_deploy → démarré
❌ get_deployment_logs → build failed: missing dependency 'react'

Je corrige package.json...
✓ write_project_file → package.json mis à jour
✓ trigger_deploy → nouveau déploiement...
✓ Projet prêt !
```

## Métriques de succès

| Métrique                          | Cible   |
|-----------------------------------|---------|
| Scaffold → premier tour agent     | < 1s    |
| Scaffold → deploy lancé           | < 30s   |
| Scaffold → app live (simple)      | < 2min  |
| Taux de succès premier déploiement| > 80%   |

## Améliorations futures

- [ ] Streaming LLM dans l'UI (SSE déjà en place côté API)
- [ ] Progress bar synthétique (étapes du workflow)
- [ ] Retry auto si deploy échoue avec erreur connue
- [ ] Pré-validation du prompt (détection stack tech)
- [ ] Suggestions de frameworks populaires dans le wizard
- [ ] Templates prédéfinis (Next.js, Astro, Laravel, etc.)

## Architecture complète

```
NewBuilderWizard (UI)
    ↓ POST /api/v1/projects/scaffold
scaffold_project() (Rust)
    ├─ INSERT project (draft)
    ├─ seed_required_agents() → agent deploy
    ├─ INSERT agent_messages (user seed)
    └─ tokio::spawn → trigger_agent_turn()
         ↓
trigger_agent_turn()
    ├─ Vérifie idempotence (COUNT assistant = 0)
    ├─ Charge contexte (project_brief, history)
    ├─ UPDATE agent status = 'working'
    ├─ agent.handle_with_context(seed_message)
    │    ↓
    │  AgentRunner + LLM
    │    ├─ create_github_repo (MCP GitHub)
    │    ├─ write_project_file (MCP GitHub)
    │    └─ trigger_deploy
    │         ↓
    │       trigger_deploy() (SqliteProjectStore)
    │         ├─ INSERT deployments (running)
    │         ├─ UPDATE projects (deploying)
    │         ├─ DeployFacade::deploy()
    │         │    ├─ git clone/pull
    │         │    ├─ nixpacks build
    │         │    └─ docker run
    │         ├─ UPDATE deployments (success/failed)
    │         └─ UPDATE projects (live/failed)
    │
    ├─ INSERT agent_messages (assistant reply)
    └─ UPDATE agent status = 'idle'

ProjectWorkspace (UI)
    ├─ ProjectAgentsPanel → affiche messages
    └─ Preview iframe → charge production_url
```

## Fichiers modifiés (slice 3)

### Backend
- `apps/server/src/routes.rs` : `trigger_agent_turn()`, auto-kick dans `scaffold_project()`
- `apps/server/src/state.rs` : `SqliteProjectStore::trigger_deploy()`
- `crates/agent/src/lib.rs` : prompt système mis à jour avec workflow deploy
- `crates/agent/src/tools/deploy.rs` : nouveau tool `TriggerDeployTool`
- `crates/agent/src/tools/mod.rs` : export `TriggerDeployTool`

### Frontend
- Aucun changement nécessaire (auto-kick backend suffit)
- `ProjectAgentsPanel.tsx` : déjà prêt pour afficher les messages en temps réel

## Support production

### Logs à surveiller
```bash
# Backend scaffold + agent
grep "scaffold" /var/log/devforge/server.log
grep "trigger_agent_turn" /var/log/devforge/server.log

# Déploiements
grep "deploy" /var/log/devforge/server.log
```

### Debugging
```sql
-- Vérifier que l'agent a bien répondu
SELECT role, content, created_at 
FROM agent_messages 
WHERE agent_uuid = 'xxx' 
ORDER BY id DESC LIMIT 5;

-- Vérifier les déploiements
SELECT uuid, status, git_sha, created_at 
FROM deployments 
WHERE project_id = (SELECT id FROM projects WHERE uuid = 'xxx')
ORDER BY id DESC LIMIT 3;
```

### Rollback
Si le feature flag doit être désactivé temporairement :
```rust
// apps/server/src/routes.rs - scaffold_project()
// Commenter le tokio::spawn qui lance trigger_agent_turn()
```
Le scaffold fonctionnera en mode "dormant" comme avant (slice 1 seule).
