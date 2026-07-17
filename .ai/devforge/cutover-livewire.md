# Cutover Livewire → DevForge

Checklist pour retirer le code Livewire/Blade **après** colonne **X** validée en staging (`?legacy=0`).

## Domaines prêts pour X (staging)

| Domaine | Retrait Livewire proposé | Statut |
|---------|--------------------------|--------|
| tags | `app/Livewire/Project/Shared/Tags.php` + route `tags.show` (garder tags sur fiches app) | Prêt après smoke CRUD |
| destinations | `app/Livewire/Project/Shared/Destination.php`, `Server/Destinations.php` | Prêt après smoke |
| shared-variables | Livewire SharedVariables si présent ; routes web associées | Prêt après smoke |
| projects (liste) | Livewire Project index (pas sous-pages app) | Prêt après smoke |
| storages S3 | Livewire Storage si entièrement couvert par DevForge | Prêt après smoke |

Ne pas supprimer tant que `?legacy=1` est requis pour un rollback. Valider d’abord avec `DEVFORGE_*_ENABLED=true` et `?legacy=0`.

## Procédure par domaine

1. Forcer le domaine DevForge dans `config/devforge.php` (enabled, pas de fallback)
2. Smoke staging : liste + CRUD + 403 membre
3. Supprimer composants Livewire + vues Blade du domaine
4. Retirer routes `web.php` mortes
5. Garder `?legacy=1` global tant que d’autres domaines critiques restent

## Ne pas supprimer encore

- Auth Fortify / login Blade
- Terminal Livewire (filet) tant que le xterm DevForge n’est pas validé en prod
- Subscription Stripe Livewire
- Onglets serveur avancés (proxy/swarm)
- Détail service compose avancé

Voir [`frontend/MIGRATION.md`](../../frontend/MIGRATION.md).
