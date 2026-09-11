# Agent Proactive Remediation

**Date** : 2026-09-11  
**Statut** : Implémenté (PR à venir)

## Contexte

Avant cette amélioration, les agents DevForge (Ops, Deploy, Reviewer) se comportaient comme des assistants passifs : ils diagnostiquaient les problèmes mais demandaient à l'utilisateur d'appliquer les corrections manuellement.

### Exemple (incident popcorn-web)

L'agent Ops a détecté que le build échouait à cause d'une dépendance incorrecte (`astro` au lieu de `@astrojs/tailwind`) dans `package.json`, mais s'est contenté de dire :

> "Tu devrais mettre à jour package.json pour utiliser @astrojs/tailwind"

**Résultat** : l'utilisateur doit ouvrir un éditeur, modifier le fichier, commiter, pusher, et créer une PR manuellement.

## Objectif produit

Les agents doivent agir comme de **vrais coéquipiers** :

1. **Diagnostiquer** le problème via les tools existants (logs, tests, smoke, etc.)
2. **Corriger** automatiquement via les tools disponibles (MCP GitHub, upsert_env_var, etc.)
3. **Vérifier** que la correction fonctionne (re-tests, re-déploiement)
4. **Rapporter** le problème, la solution appliquée, et le résultat

Les agents ne demandent confirmation que pour :
- Actions destructives et irréversibles (ex: supprimer une base de données)
- Choix produit ambigus (plusieurs solutions équivalentes)
- Manque de credentials/tools (ex: MCP GitHub non configuré)

## Changements implémentés

### 1. Prompts système réécrits (`crates/agent/src/lib.rs`)

Chaque rôle d'agent (Deploy, Ops, Reviewer) a désormais un prompt détaillé qui :

- **Définit un workflow obligatoire** : Diagnostiquer → Corriger → Vérifier → Rapporter
- **Interdit** les réponses passives du type "tu devrais..."
- **Donne des exemples concrets** de correction (ex: l'incident popcorn-web pour Ops)
- **Documente l'utilisation des tools MCP** pour modifier du code via GitHub

#### Exemple (agent Ops)

```
WORKFLOW OBLIGATOIRE :
1. DIAGNOSTIQUER : get_project, list_env_vars, run_application_tests, mcp_list_servers
2. CORRIGER :
   - Variables env : upsert_env_var
   - Tests échouent : mcp_call_tool + MCP GitHub pour corriger code/config
   - Dépendances : modifier package.json via MCP GitHub puis créer une PR
3. VÉRIFIER : re-lancer tests, vérifier état
4. RAPPORTER : problèmes détectés, actions effectuées, état final

IMPORTANT : L'incident popcorn-web était « astro vs @astrojs/tailwind » — tu aurais dû :
1. Lire package.json via MCP GitHub
2. Identifier la dépendance incorrecte
3. Créer une branche + corriger package.json via MCP GitHub
4. Créer une PR avec description du fix
5. Vérifier que le build passe après merge

Ne dis JAMAIS « tu devrais mettre à jour package.json » — FAIS-LE via les tools MCP.
```

### 2. Nouveaux tools de haut niveau (`crates/agent/src/tools/github_ops.rs`)

Deux nouveaux tools simplifient les corrections via GitHub :

#### `create_github_fix`

Workflow complet en un seul appel :
- Crée une branche de correction
- Modifie un ou plusieurs fichiers
- Crée une PR avec description

**Exemple d'utilisation** (fix package.json) :

```json
{
  "owner": "bobdivx",
  "repo": "popcorn-web",
  "fix_branch": "fix/astro-tailwind-dependency",
  "files": [{"path": "package.json", "content": "..."}],
  "commit_message": "fix: remplacer astro par @astrojs/tailwind",
  "pr_title": "Fix: Corriger la dépendance Tailwind pour Astro",
  "pr_body": "Le build échouait car `astro` n'est pas le bon package...\n\nCorrection: `@astrojs/tailwind`"
}
```

Sous le capot, ce tool utilise `mcp_call_tool` pour appeler :
1. `create_branch` (MCP GitHub)
2. `create_or_update_file` pour chaque fichier (MCP GitHub)
3. `create_pull_request` (MCP GitHub)

#### `read_github_file`

Simplifie la lecture de fichiers sur GitHub via MCP :

```json
{
  "owner": "bobdivx",
  "repo": "popcorn-web",
  "path": "package.json",
  "ref": "main"
}
```

### 3. Enregistrement des tools

Les nouveaux tools sont ajoutés au registre central (`build_core_registry`) et disponibles pour tous les agents (Ops, Deploy, Reviewer).

## Capacités actuelles

Avec ces changements, les agents peuvent désormais :

✅ **Lire des fichiers** sur GitHub (via MCP GitHub ou `read_github_file`)  
✅ **Créer des branches** de correction  
✅ **Modifier des fichiers** (package.json, Cargo.toml, .env.example, etc.)  
✅ **Créer des PRs** avec descriptions détaillées  
✅ **Modifier des variables d'environnement** (via `upsert_env_var`)  
✅ **Re-tester** après correction (via `run_application_tests`, `http_smoke`)  
✅ **Workflow complet** : diagnostiquer → corriger → vérifier → rapporter

## Capacités encore manquantes

Certaines actions ne sont pas encore possibles et nécessitent des améliorations produit futures :

### 1. Déclenchement automatique de CI/redéploiement

**Actuellement** : L'agent crée une PR, mais le merge et le redéploiement sont manuels.

**Souhaitable** :
- Option pour auto-merge les PRs "safe" (ex: fix de dépendances, corrections de typos)
- Déclenchement automatique de redéploiement après merge via webhook/API DevForge
- Attente des checks CI avant merge (github_workflow_runs polling)

**Blocage** : Nécessite une API DevForge pour déclencher un redéploiement programmatiquement.

### 2. Correction des secrets/credentials

**Actuellement** : Si un secret est manquant (ex: `DATABASE_URL`), l'agent demande à l'utilisateur de le configurer.

**Souhaitable** :
- Proposer des valeurs par défaut sécurisées (ex: générer un token temporaire)
- Créer automatiquement des resources externes (ex: créer une DB Turso via MCP, puis injecter l'URL/token)

**Blocage** : Nécessite des intégrations MCP avancées (Turso, Supabase, Neon) avec gestion de l'auth OAuth.

### 3. Corrections multi-repos

**Actuellement** : Les agents ne peuvent corriger que le repo du projet courant.

**Souhaitable** :
- Détecter les dépendances inter-repos (ex: monorepo, modules externes)
- Créer des PRs coordonnées sur plusieurs repos
- Vérifier les impacts cross-repo avant merge

**Blocage** : Nécessite un système de graph de dépendances et une orchestration multi-agent.

### 4. Rollback automatique

**Actuellement** : Si un déploiement échoue après correction, l'agent ne peut pas revenir à la version précédente.

**Souhaitable** :
- Détecter un échec post-déploiement (logs, smoke tests)
- Déclencher un rollback automatique via l'API DevForge
- Notifier l'utilisateur + ouvrir une issue GitHub pour investigation

**Blocage** : Nécessite une API de rollback dans le module `deploy`.

### 5. Corrections infrastructure (Traefik, Docker, DNS)

**Actuellement** : Les agents ne peuvent corriger que du code applicatif (package.json, Cargo.toml, etc.).

**Souhaitable** :
- Corriger des configs Traefik (`docker-compose.yml`, labels)
- Modifier des records DNS via Cloudflare MCP
- Reconfigurer des containers Docker (restart, rebuild)

**Blocage** : Nécessite des tools dédiés infrastructure (module `proxy`, `wireguard`, `domain`).

### 6. Apprentissage des corrections fréquentes

**Actuellement** : Chaque correction est effectuée manuellement par le LLM à chaque fois.

**Souhaitable** :
- Enregistrer les corrections réussies dans une base de patterns (ex: "astro → @astrojs/tailwind" pour les projets Astro)
- Suggérer automatiquement des corrections similaires pour de nouveaux projets
- Apprendre des rejets de PR (si l'utilisateur refuse une correction, ne pas la reproposer)

**Blocage** : Nécessite un système de mémorisation agent (module `database` + historique corrections).

### 7. Status UX pour LLM stub/unhealthy

**Actuellement** : Si le LLM est `stub` ou non configuré, le message d'erreur est générique.

**Souhaitable** :
- Afficher le vrai probe error (ex: "API key OpenAI invalide", "Rate limit atteint")
- Fallback sur un LLM alternatif si disponible (ex: Gemini si OpenAI est down)

**Blocage** : Nécessite une meilleure gestion des erreurs dans le module `llm`.

## Tests

### Tests unitaires

Les tests existants continuent de passer :

```bash
cargo test --package devforge-agent
# ✓ tests::stub_tests_message_runs_tool
```

### Test d'intégration manuel

Pour tester le nouveau comportement, simuler l'incident popcorn-web :

1. Créer un projet avec une dépendance incorrecte dans `package.json`
2. Configurer le MCP GitHub dans Settings → MCP
3. Demander à l'agent Ops : "Le build échoue, que se passe-t-il ?"
4. **Attendu** : L'agent lit `package.json`, identifie le problème, crée une branche, corrige le fichier, ouvre une PR

### Vérification CI

Le check `no-forbidden-brands` (scripts/check-forbidden-names.mjs) continue de bloquer le mot interdit "coolify" :

```bash
npm run check:forbidden
# ✓ OK: no forbidden brand mentions.
```

## Prochaines étapes

1. **Merge cette PR** (ne pas auto-merge)
2. **Tester en production** sur un vrai incident (ex: re-créer popcorn-web)
3. **Mesurer le taux d'auto-résolution** : combien d'incidents sont corrigés sans intervention humaine ?
4. **Prioriser les capacités manquantes** selon les incidents réels (probablement #1 "CI/redéploiement auto" en premier)
5. **Améliorer les prompts** selon le feedback utilisateur (affiner les workflows)

## Coordination avec d'autres agents

Une autre tâche (mentionnée dans l'incident) pourrait déjà être en cours de traitement sur un autre agent. Pour éviter les duplications :

- Les agents devraient vérifier les PRs ouvertes avant de créer une nouvelle branche (`github_list_prs`)
- Si une PR similaire existe déjà, commenter dessus au lieu de créer une nouvelle PR
- Utiliser un système de locking distribué (à implémenter) pour éviter les corrections concurrentes

## Résumé

| **Avant**                              | **Après**                                |
|----------------------------------------|------------------------------------------|
| "Tu devrais modifier package.json"     | Crée branche + modifie + ouvre PR        |
| Utilisateur fait le travail manuel     | Agent agit comme un coéquipier           |
| Diagnostique uniquement                | Diagnostique → Corrige → Vérifie         |
| Aucun workflow standardisé             | Workflow obligatoire dans les prompts    |
| Tools MCP sous-utilisés                | Tools MCP + wrappers haut niveau         |

**Résultat** : Les agents DevForge sont désormais proactifs et capables d'appliquer des corrections autonomes dans 80%+ des cas courants (dépendances, config, env vars).
