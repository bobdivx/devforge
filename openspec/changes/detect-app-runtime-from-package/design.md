## Context

DevForge (UI Coolify `/devforge`) permet déjà de lire le source GitHub d’une app (`ApplicationSourceService`) et de lire/écrire les paramètres Coolify (`ApplicationRuntimeSettingsService`). L’agent peut aussi déduire un `publish_directory` depuis les logs (`AgentDirectives::inferStaticPublishDirectory`), mais uniquement en réparation post-échec.

Les utilisateurs qui déploient des apps Node/Astro/Vite/Next doivent souvent corriger manuellement port, dossier de publish et commandes. Les indices sont dans le repo de **l’app déployée** (`package.json`, configs framework).

## Goals / Non-Goals

**Goals:**

- Une seule logique de détection (service backend) consommée par création, panneau runtime, et (idéalement) l’agent.
- Préremplir à la création pour réduire les premiers deploys ratés.
- Sur app existante : bouton qui remplit le draft ; sauvegarde + redeploy restent explicites.
- Couvrir les stacks Node courantes : Astro (static/SSR), Vite, Next, Nuxt, générique npm.

**Non-Goals:**

- Remplacer Nixpacks/Railpack (la détection complète les overrides Coolify, elle ne réécrit pas le build pack engine).
- Scanner le monorepo entier sans `base_directory` (on lit sous le base directory de l’app).
- Auto-apply silencieux + redeploy sans confirmation utilisateur sur apps existantes.
- Support non-Node en v1 (PHP Composer, Python, Go) — extensible plus tard.
- Modifier le Livewire legacy Coolify (hors DevForge).

## Decisions

### 1. Service unique `ApplicationRuntimeHintsService`

- **Choix** : parser pur côté PHP à partir de fichiers déjà accessibles via `ApplicationSourceService::readFile` / listing.
- **Pourquoi** : pas de dépendance npm côté backend ; testable unitairement ; même code pour UI et agent.
- **Alternative** : heuristiques uniquement dans le frontend — rejetée (duplication, pas d’outil agent).

### 2. Entrées lues (ordre)

1. `package.json` (scripts, dependencies/devDependencies, packageManager / lockfile hint)
2. Fichiers optionnels sous `base_directory` : `astro.config.*`, `vite.config.*`, `next.config.*`, `nuxt.config.*`, `nixpacks.toml` (si présents)
3. Défauts framework si config absente

Réutiliser / étendre les helpers existants dans `AgentDirectives` pour `publish_directory` afin d’éviter deux tables de vérité.

### 3. Forme de la réponse API

```json
{
  "available": true,
  "framework": "astro",
  "hints": {
    "install_command": { "value": "npm ci", "confidence": "high", "reason": "package-lock.json" },
    "build_command": { "value": "npm run build", "confidence": "high", "reason": "scripts.build" },
    "start_command": { "value": "node ./dist/server/entry.mjs", "confidence": "medium", "reason": "astro ssr" },
    "ports_exposes": { "value": "4321", "confidence": "medium", "reason": "astro default" },
    "publish_directory": { "value": "/dist", "confidence": "high", "reason": "astro outDir" },
    "is_static": { "value": false, "confidence": "high", "reason": "output server" },
    "build_pack": { "value": "nixpacks", "confidence": "low", "reason": "default" }
  },
  "sources_read": ["package.json", "astro.config.mjs"]
}
```

Chaque hint est optionnel. Le frontend n’applique que les champs présents.

### 4. Endpoints

- `GET /api/devforge/applications/{uuid}/runtime-hints` — app persistée (source GitHub résolue).
- `POST /api/devforge/applications/runtime-hints/preview` — avant création : `{ github_app_uuid, git_repository|owner/repo, git_branch, base_directory? }` pour le modal de création.

Auth / team scoping identiques aux autres routes applications DevForge.

### 5. UX création vs édition

| Surface | Comportement |
|---------|--------------|
| `CreateApplicationModal` | Après sélection repo+branche, appeler preview ; préremplir draft local (port, publish, commands, is_static) ; transmis au create si l’API create le permet, sinon update runtime juste après create avant instant deploy. |
| `ApplicationRuntimeSettingsPanel` | Bouton « Détecter depuis le repo » → remplit le **draft** ; badge confiance / raison optionnels ; Enregistrer inchangé (redeploy explicite). |

**Merge policy édition** : par défaut appliquer au draft tous les hints ; si un champ a été modifié manuellement depuis le dernier sync serveur, le conserver sauf si l’utilisateur choisit « Remplacer tout ». V1 simplifiée : remplacer les champs du draft par les hints (l’utilisateur n’a pas encore sauvegardé) — acceptable car draft non persisté.

### 6. Création : timing du premier deploy

Si `instant_deploy: true`, appliquer les hints **avant** de lancer le deploy (create with settings, ou create puis patch runtime sans redeploy, puis deploy). Éviter un premier build avec mauvais `publish_directory`.

### 7. Agent

Ajouter un outil `suggest_application_runtime_settings` (ou enrichir `get_application_runtime_settings` avec `hints`) qui appelle le même service. L’agent continue d’appeler `update_application_runtime_settings` pour appliquer.

## Risks / Trade-offs

- **[Heuristique fausse]** → Mitigation : confidence + raisons visibles ; jamais auto-redeploy sans save ; tests sur fixtures package.json/config.
- **[GitHub rate limit / latence]** → Mitigation : lire seulement les fichiers candidats (pas arborescence profonde) ; cache court optionnel par `(app, commit_sha)`.
- **[Monorepo / mauvais base_directory]** → Mitigation : toujours résoudre paths relatifs à `base_directory` ; message si `package.json` introuvable.
- **[SSR vs static ambigu]** → Mitigation : privilégier config (`output: 'static'|'server'`) ; sinon deps + présence de `start` ; laisser `is_static` en medium confidence.
- **[Port uniquement dans env]** → Mitigation : défauts framework ; parser `-p` / `--port` / `PORT=` dans scripts si présents.

## Migration Plan

1. Ship service + API + tests (pas de changement de comportement sans UI).
2. Brancher le panneau runtime (bouton).
3. Brancher le modal de création + ordre create/hints/deploy.
4. Brancher l’outil agent.
5. Rollback = retirer le bouton / ne plus appeler l’API ; aucun schéma DB requis.

## Open Questions

- Faut-il persister les hints appliqués (audit) ? **Décision v1 : non.**
- Étendre à Docker Compose / Dockerfile detection en v1.1 ? **Hors scope v1.**
