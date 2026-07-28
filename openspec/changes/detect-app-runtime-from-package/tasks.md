## 1. Detection service

- [ ] 1.1 Créer `ApplicationRuntimeHintsService` (parse `package.json` + configs framework, sortie hints + confidence + reason)
- [ ] 1.2 Réutiliser / factoriser les helpers publish-directory depuis `AgentDirectives` pour une seule source de vérité
- [ ] 1.3 Couvrir fixtures unitaires : Astro static, Astro SSR, Vite, Next, Nuxt, générique npm, absence de `package.json`
- [ ] 1.4 Résoudre les chemins sous `base_directory` et lister les `sources_read`

## 2. API DevForge

- [ ] 2.1 Endpoint `GET applications/{uuid}/runtime-hints` (auth team, pas de mutation)
- [ ] 2.2 Endpoint `POST applications/runtime-hints/preview` (github app + repo + branch + base_directory optionnel)
- [ ] 2.3 Brancher routes + types frontend `domainApi` / `ApplicationRuntimeHints`
- [ ] 2.4 Feature tests Pest (happy path, unavailable, cross-team deny)

## 3. UI édition

- [ ] 3.1 Bouton « Détecter depuis le repo » dans `ApplicationRuntimeSettingsPanel`
- [ ] 3.2 Remplir le draft depuis les hints ; afficher raison/confiance légère si utile
- [ ] 3.3 Ne persister / redeploy qu’au clic Enregistrer existant

## 4. UI création

- [ ] 4.1 Après sélection repo+branche, appeler preview hints dans `CreateApplicationModal`
- [ ] 4.2 Préremplir le draft create (commands, ports, publish, is_static)
- [ ] 4.3 Garantir l’application des hints avant le premier deploy si `instant_deploy` (create payload ou patch runtime puis deploy)

## 5. Agent

- [ ] 5.1 Exposer hints via outil dédié ou enrichissement de `get_application_runtime_settings`
- [ ] 5.2 Mettre à jour le prompt repair pour privilégier ces hints avant `update_application_runtime_settings`

## 6. Vérification

- [ ] 6.1 Lancer les tests unit + feature concernés (`pest` / `php artisan test --compact` filtrés)
- [ ] 6.2 Smoke manuel : créer une app Astro + détecter sur une app existante
