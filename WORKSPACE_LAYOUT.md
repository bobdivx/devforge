# Workspace Layout — Documentation

Cette PR ajoute un nouvel onglet **Workspace** dans la vue projet pour DevForge (plateforme self-hosted PaaS **+ builder**).

## Architecture DevForge Workspace

### 1. Layout côte à côte (side-by-side)
Le workspace utilise un layout split-panel pour maximiser la productivité :
- **Gauche** : Chat agent (agents ops/deploy/reviewer)
- **Droite** : Preview production + logs déploiements

Sur desktop, les deux panneaux sont visibles simultanément pour voir l'état de l'app pendant qu'on interagit avec les agents. Sur mobile, des tabs permettent de basculer entre Chat et Preview pour économiser l'espace.

### 2. Architecture self-hosted PaaS + Builder
DevForge est une plateforme **web self-hosted** combinant :
- **PaaS** : Déploiement d'apps, gestion runners/domaines/env/backups
- **Builder** : Agents IA qui scaffoldent projets et éditent le code

**Dans cette v1** : Focus PaaS — affiche la **production URL** (app déployée), logs viennent des **déploiements Git** passés. Les agents actuels (ops/deploy/reviewer) répondent aux questions et suggèrent des changements dans le chat.

**Direction future** (hors scope v1) : Les agents pourront directement éditer le code dans le repo Git, déclencher des builds, et le preview se rafraîchira automatiquement — expérience builder complète dans le contexte web self-hosted de DevForge.

### 3. Agents existants (ProjectAgentsPanel)
Le panel gauche réutilise `ProjectAgentsPanel`, composant déjà présent dans DevForge. Les agents sont pré-seedés (ops, deploy, reviewer, custom) pour chaque projet.

### 4. Preview = iframe de production_url (v1 PaaS-focused)
Dans cette première itération, l'iframe pointe vers l'app déployée en production (`project.production_url`), ou affiche un message "configurer domaine" si absent.

**Évolution builder future** : Le workspace pourra prévisualiser des branches de travail ou des preview deployments éphémères avant le merge en production.

### 5. Logs de déploiement historiques
Le panel logs affiche les 5 derniers déploiements (SHA, statut, timestamp) et permet de sélectionner un déploiement pour voir ses logs. C'est une vue forensic post-déploiement, pas un flux live de compilation.

### 6. Design system PandaOS-inspired
Le workspace suit le design system DevForge existant (home grid, nav, cards) avec le style "PandaOS-like" et couleurs custom `var(--color-*)`. L'identité visuelle DevForge est cohérente dans tout le produit.

## Fichiers créés/modifiés

### Nouveaux
- `apps/web/src/components/ProjectWorkspace.tsx` : Composant principal du workspace
- `WORKSPACE_LAYOUT.md` : Documentation du layout et de l'architecture

### Modifiés
- `apps/web/src/components/ProjectDetailPage.tsx` : Ajout du tab 'workspace'
- `apps/web/src/lib/nav.ts` : Ajout de l'entrée "Workspace" dans `projectNav()`
- `AGENTS.md` : Direction produit PaaS + Builder

## Utilisation

1. Ouvrir un projet : `/app/projects/view?uuid=...`
2. Cliquer sur l'onglet **Workspace** dans la sidebar projet
3. Voir :
   - Gauche (desktop) : Chat agent (agents ops/deploy/reviewer)
   - Droite (desktop) : Preview production + Logs déploiements récents
   - Mobile : Tabs pour basculer entre Chat et Preview

## Limites v1

- Pas de polling auto des logs (statique, clic "Rafraîchir" pour reload)
- Pas de console interactive : les logs sont read-only
- Preview uniquement sur production_url (pas de preview branches)

## Prochaines étapes — Évolution builder (hors scope v1)

Cette PR pose les fondations du workspace. **Direction produit approuvée** : DevForge devient PaaS + builder web self-hosted. Prochaines itérations possibles :

### Builder core
- **Scaffold from prompt** : Agent crée un nouveau projet depuis une description
- **Iterative edit** : Agent modifie directement les fichiers du repo Git via l'interface
- **Preview branches** : Preview deployments éphémères pour les branches de travail (pas seulement production)
- **Code editor intégré** : Monaco/CodeMirror dans le workspace pour édition manuelle

### Amélioration workspace
- Auto-reload de l'iframe preview si nouveau déploiement détecté
- Streaming logs SSE pour les déploiements en cours
- Filtres logs (erreurs seulement, recherche)
- Panel responsive resizable (react-resizable-panels)
- Console interactive (exécuter des commandes, pas seulement lire les logs)

### Architecture technique
DevForge est une plateforme **self-hosted web** avec :
- Déploiement sur runners distants (pas seulement localhost)
- Multi-projets, multi-users, SSO
- Intégration GitHub native pour CI/CD
- MCP servers pour étendre les capabilities agent
