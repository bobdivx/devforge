## Why

Les apps déployées via DevForge exigent souvent des paramètres Coolify corrects (`publish_directory`, `ports_exposes`, commandes install/build/start, static vs SSR) que Nixpacks ne déduit pas toujours bien. Aujourd’hui ces champs sont saisis à la main (ou corrigés après un échec par l’agent), alors que le repo Git contient déjà les indices (`package.json`, configs framework).

## What Changes

- Introduire une détection proactive des paramètres build & runtime à partir du code source GitHub de l’app (pas DevForge lui-même).
- À la **création** d’application : préremplir les champs runtime avant le premier déploiement.
- Sur une **app existante** : bouton « Détecter depuis le repo » dans le panneau Paramètres de build & runtime, qui remplit le draft ; l’utilisateur valide via Enregistrer.
- Exposer la même logique via API (et éventuellement outil agent) pour éviter deux heuristiques divergentes.
- Comportement non silencieux : suggestions avec confiance / raisons ; sur app existante, ne pas écraser les valeurs personnalisées sans action explicite (préremplir le draft, champs vides/défauts prioritaires).

## Capabilities

### New Capabilities

- `devforge-runtime-detection`: détection des paramètres Coolify (install/build/start, ports, publish directory, is_static, build_pack hints) depuis `package.json` et configs framework du repo de l’app déployée ; exposition API + UX création et édition.

### Modified Capabilities

- _(aucune — pas encore de specs OpenSpec DevForge runtime dans ce dépôt)_

## Impact

- Backend : nouveau service d’hints (ex. `ApplicationRuntimeHintsService`) branché sur `ApplicationSourceService` (lecture GitHub).
- API DevForge : endpoint suggest/detect sur applications (+ optionnellement preview à la création avant `Application` persistée).
- Frontend Preact : `CreateApplicationModal`, `ApplicationRuntimeSettingsPanel`, client `domainApi`.
- Agent : réutiliser les hints (outil ou étape repair) pour aligner `update_application_runtime_settings` avec la détection UI.
- Tests Pest unitaires sur les heuristiques framework (Astro, Vite, Next, Nuxt, static) + feature API.
