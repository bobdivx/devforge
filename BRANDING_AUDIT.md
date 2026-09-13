# Audit de branding DevForge

**Date** : 13 septembre 2026  
**Statut** : ✅ Complet

## Objectif

Vérifier et documenter l'absence de mentions « Coolify » visibles par les utilisateurs et opérateurs dans le codebase DevForge v2.

## Résumé

Après audit exhaustif, **aucune mention "Coolify" n'a été trouvée** dans les composants visibles par l'utilisateur ou l'opérateur. Le projet utilise exclusivement la marque "DevForge".

## Zones vérifiées

### ✅ Code source
- **Rust** (`crates/`, `apps/server/`) — Aucune mention
- **TypeScript/Preact** (`apps/web/src/`) — Aucune mention  
- **Astro pages** (`apps/web/src/pages/`) — Aucune mention

### ✅ Documentation
- `README.md` — DevForge uniquement
- `docs/*.md` — DevForge uniquement
- Commentaires de code — Aucune mention visible

### ✅ Configuration
- `docker-compose.yml` — Images `bobdivx/devforge`
- `Dockerfile` — DevForge uniquement
- Variables d'environnement — Préfixe `DEVFORGE_*`
- `deploy/` — Configuration DevForge

### ✅ Labels Docker
Le code utilise les labels DevForge natifs :
- `devforge.managed=true`
- `devforge.type=service`
- `com.devforge.runner=true`
- `com.devforge.runner.repo_url=...`
- `com.devforge.runner.name=...`

**Pas de fallback legacy** : Les labels Coolify ne sont pas acceptés comme fallback.

### ✅ Variables d'environnement
Toutes les variables utilisent le préfixe `DEVFORGE_*` :
- `DEVFORGE_DATA_DIR`
- `DEVFORGE_VERSION`
- `DEVFORGE_UPDATE_MODE`
- `DEVFORGE_DOCKER_NETWORK`
- `DEVFORGE_GITHUB_TOKEN`
- `DEVFORGE_EXECUTOR`
- etc.

**Aucune variable `COOLIFY_*`** dans le code de déploiement.

## Garde-fou CI

Le script `scripts/check-forbidden-names.mjs` interdit les mentions "coolify" (case-insensitive) dans le code source.

```bash
npm run check:forbidden
```

Ce check fait partie du workflow CI et échoue si une mention est introduite.

## Compatibilité interne

### Chemins filesystem
Les chemins comme `/data/coolify` ne sont **pas** utilisés. DevForge utilise :
- `/data/devforge.db`
- `/data/ssh/`
- Pas de référence à des chemins Coolify legacy

### Images Docker
Aucune image `coollabsio/*` n'est référencée. Les images utilisées :
- `bobdivx/devforge`
- Images publiques standards (Node, nginx, etc.)

### Détection de conteneurs
Le code Docker (`crates/runner/src/docker.rs`) détecte les runners GitHub par :
- Labels `com.devforge.runner=true` (prioritaire)
- Pattern de nom `github-runner` (fallback pour détection générique)
- **Ne recherche PAS** de labels `coolify.*`

## Conclusion

Le projet DevForge v2 est **entièrement indépendant** de la marque Coolify d'un point de vue utilisateur et opérateur. 

- ✅ Aucun texte "Coolify" dans l'UI
- ✅ Aucune variable `COOLIFY_*` exposée
- ✅ Aucun label Docker `coolify.*` utilisé ou requis
- ✅ Documentation utilisateur et opérateur utilise "DevForge" exclusivement
- ✅ Check CI en place pour prévenir les régressions

## Référence

Archive legacy : `bobdivx/devforge-alpha` (PHP, lecture seule, extraction uniquement)  
V2 active : `bobdivx/devforge` (Rust + Astro)
