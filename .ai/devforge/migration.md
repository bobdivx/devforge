# DevForge — Migration & organisation

> **Source de vérité détaillée** : [`frontend/MIGRATION.md`](../../frontend/MIGRATION.md)  
> Mettre à jour le tableau d’état dans ce fichier à chaque PR domaine.

## Objectif

Remplacer complètement l’interface Coolify (Livewire/Blade) par DevForge (Astro + Preact), en conservant le backend Laravel.

« Couper le legacy » (colonne **X**) pour un domaine = routes `/devforge`, lecture + écriture API, UI sans `LegacyEditBanner`, tests, flag domaine, puis retrait Livewire/Blade.

## Checklist domaine (résumé)

| Code | Critère |
|------|---------|
| R | Routes front |
| P | Pages Preact |
| L | Lecture API |
| E | Écriture API |
| U | UI complète sans bannière legacy |
| T | Temps réel si besoin |
| A | Auth / policies |
| V | Tests Vitest |
| F | Tests Pest Feature |
| D | Flag domaine |
| X | Livewire/Blade retirables |

## Phases

1. **Parité** — vagues 1→4 dans `MIGRATION.md` (E → U → X)
2. **Organisation `frontend/src/`** — pages/composants/lib par domaine
3. **Cutover** — suppression Livewire + nettoyage middleware/flags
4. **Monorepo** — Laravel → `backend/` après ~70 % domaines en **X**

## Commandes

```bash
cd frontend && npm test && npm run build
# ou : npm run test:frontend && npm run build:frontend
docker exec coolify php artisan test --compact --filter=DevForge
vendor/bin/pint --dirty --format agent
```

## Hors périmètre

- Merger le repo Forge/Ageton
- Réécrire le PaaS en Node / Astro DB
- Big-bang « tout Livewire mort en un PR »
