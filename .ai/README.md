# Coolify / DevForge — Documentation AI

Point d’entrée pour les assistants (Cursor, Claude Code, etc.).

## Stack UI actuel

**DevForge** (Astro 7 + Preact + Tailwind 4) remplace progressivement l’UI Livewire/Blade.
Le cœur PaaS reste **Laravel** (models, jobs, SSH, Docker, policies).

| Couche | Emplacement |
|--------|-------------|
| Frontend (sources) | [`frontend/`](../frontend/) |
| Migration UI (source de vérité) | [`frontend/MIGRATION.md`](../frontend/MIGRATION.md) |
| Guide DevForge (ce dossier) | [`.ai/devforge/migration.md`](devforge/migration.md) |
| Build statique servi | [`backend/public/devforge/`](../backend/public/devforge/) (URL `/devforge`) |
| Docs produit | [`docs/`](../docs/) |
| API DevForge | `routes/devforge-*.php`, `app/Http/Controllers/DevForge/` |
| Flags / matrice routes | `config/devforge.php` |

## Navigation rapide

### DevForge
- **[Migration Livewire → DevForge](devforge/migration.md)** — phases, checklist domaines, monorepo
- **[Agents autonomes — plan](devforge/agents-autonomy-plan.md)** — P0–P4 livrés ; P5 collab multi-rôles (natif) ; P6 MCP optionnel
- **[Auth Fortify](devforge/authentication.md)** — login hors SPA
- **[Cutover Livewire](devforge/cutover-livewire.md)** — retrait domaine par domaine
- **[Monorepo backend/frontend](devforge/monorepo.md)** — layout `backend/` + `frontend/`
- Checklist MCP : [`frontend/MCP_DEVFORGE.md`](../frontend/MCP_DEVFORGE.md)

### Développement
- Commandes front : `cd frontend && npm test && npm run build` (ou `npm run test:frontend` à la racine)
- Tests API DevForge : `docker exec coolify php artisan test --compact --filter=DevForge`
- Format PHP : `vendor/bin/pint --dirty --format agent`

### Règles d’organisation front (dès maintenant)

```
frontend/src/pages/<domaine>/_<Domaine>Page.tsx
frontend/src/components/<domaine>/
frontend/src/lib/routing/   # helpers de routes
frontend/src/lib/api/       # client + façades domaine
```

Preact uniquement pour les composants interactifs. Pas de React.

## Décisions architecture (juillet 2026)

1. **Une seule UI cible** : DevForge ; Livewire retiré domaine par domaine (colonne **X** dans `MIGRATION.md`).
2. **Backend Laravel conservé** — pas de réécriture Node du PaaS.
3. **Repo Forge/Ageton** — **suppression prévue** ; capacités agents portées dans Coolify/DevForge (voir [agents-autonomy-plan.md](devforge/agents-autonomy-plan.md)). Ne plus ajouter de features agents dans Forge.
4. **Sources front** : dossier `frontend/` ; URL produit reste `/devforge` ; PHP `DevForge` inchangé.
5. **Monorepo** : Laravel dans `backend/`, UI dans `frontend/` — voir [monorepo.md](devforge/monorepo.md).
6. Branding utilisateur → DevForge ; namespaces PHP `App\` / images Docker Coolify inchangés pour l’instant.

## Liens legacy Coolify

La doc détaillée Coolify (stack versions, patterns Livewire, etc.) peut être enrichie ici au fil du temps.
Pour la migration UI, **toujours** commencer par [`frontend/MIGRATION.md`](../frontend/MIGRATION.md).
