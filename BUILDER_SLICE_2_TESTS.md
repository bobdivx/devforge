# Builder Slice 2 : Tests manuels

## Prérequis
- DevForge v2.0.25+ (avec PR #75)
- MCP GitHub configuré (Settings → MCP → GitHub)
- Token GitHub avec permissions `repo` (create, write)
- Projet scaffold créé via slice 1 (POST `/api/v1/projects/scaffold`)

## Test 1 : Créer un repo GitHub et l'attacher au projet

### Via API Agent
```bash
curl -X POST http://localhost:3000/api/v1/projects/{uuid}/chat \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_uuid": "{deploy_agent_uuid}",
    "message": "Crée un dépôt GitHub privé nommé \"test-devforge-app\" pour ce projet."
  }'
```

### Résultat attendu
- ✅ Nouveau repo créé sur GitHub : `{owner}/test-devforge-app`
- ✅ Projet DevForge mis à jour : `git_repository` = `https://github.com/{owner}/test-devforge-app.git`
- ✅ `git_branch` = `main`
- ✅ Réponse agent : "✓ Dépôt {owner}/test-devforge-app créé et attaché au projet DevForge"

## Test 2 : Écrire des fichiers en mode local

### Via API Agent
```bash
curl -X POST http://localhost:3000/api/v1/projects/{uuid}/chat \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_uuid": "{deploy_agent_uuid}",
    "message": "Écris un fichier package.json basique avec React et Vite, mode local."
  }'
```

### Résultat attendu
- ✅ Fichier créé : `{workdir}/package.json`
- ✅ Contenu : package.json valide avec React + Vite
- ✅ Réponse agent : "✓ Fichier écrit localement : package.json"

## Test 3 : Écrire des fichiers en mode GitHub

### Via API Agent
```bash
curl -X POST http://localhost:3000/api/v1/projects/{uuid}/chat \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_uuid": "{deploy_agent_uuid}",
    "message": "Pousse un README.md sur GitHub avec description du projet, mode github."
  }'
```

### Résultat attendu
- ✅ Commit créé sur GitHub : `feat: add README.md` (ou similaire)
- ✅ Fichier visible sur `https://github.com/{owner}/test-devforge-app/blob/main/README.md`
- ✅ Réponse agent : "✓ Fichier écrit sur GitHub : {owner}/test-devforge-app/README.md"

## Test 4 : Workflow scaffold complet

### Via API Agent
```bash
curl -X POST http://localhost:3000/api/v1/projects/{uuid}/chat \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_uuid": "{deploy_agent_uuid}",
    "message": "Scaffolde une application React + Vite complète : crée le repo GitHub, écris package.json, src/App.jsx, src/main.jsx, index.html, vite.config.js."
  }'
```

### Résultat attendu
- ✅ Repo GitHub créé et attaché
- ✅ Fichiers écrits (5+ fichiers)
- ✅ Structure projet valide :
  ```
  /
  ├── package.json
  ├── index.html
  ├── vite.config.js
  └── src/
      ├── main.jsx
      └── App.jsx
  ```
- ✅ Réponse agent : résumé des fichiers créés + URL du repo

## Test 5 : Erreur gracieuse sans GitHub MCP

### Setup
1. Désactiver temporairement MCP GitHub (Settings → MCP → GitHub → disable)

### Via API Agent
```bash
curl -X POST http://localhost:3000/api/v1/projects/{uuid}/chat \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_uuid": "{deploy_agent_uuid}",
    "message": "Crée un repo GitHub pour ce projet."
  }'
```

### Résultat attendu
- ✅ Réponse agent : "Serveur MCP GitHub non configuré. Configure GitHub dans Settings → MCP pour créer des dépôts."
- ✅ Pas de crash, pas de stack trace

## Notes
- **Mode local** : plus rapide, utile pour scaffolding initial (bulk writes)
- **Mode GitHub** : commit immédiat, utile pour modifications ponctuelles
- **Workflow recommandé** : local d'abord (scaffold), puis GitHub (PRs/fixes)
- **Sécurité** : validation paths (pas de `..`, pas de chemins absolus)

## Cas edge
- ❌ Path avec `..` → erreur validation
- ❌ Projet sans workdir + mode local → erreur gracieuse
- ❌ Projet sans git_repository + mode github → erreur gracieuse
- ✅ Repo déjà existant → utilise le repo existant (pas d'erreur)
