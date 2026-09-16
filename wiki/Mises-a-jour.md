# Mises à jour

Self-update réel (plus de stub) : crate `update`.

UI : `/app/update` (+ écran d’attente `/app/update/wait`).

Modes (`DEVFORGE_UPDATE_MODE`) :

| Mode | Comportement |
|------|----------------|
| `compose` | `docker compose pull/up` sur le fichier monté (image officielle) |
| `docker` | Recrée le conteneur `DEVFORGE_SELF_CONTAINER` |
| `binary` | Télécharge `devforge-server-<triple>.zip` depuis les releases |
| `auto` | Détecte compose vs docker vs binary |

API : `GET /api/v1/update/check` · `status` · `POST /api/v1/update/start`.

Les pushes `main` publient une release (bump patch si la version Cargo est déjà taguée), images Hub + GHCR, zips Linux/Windows. Voir le workflow `.github/workflows/release.yml`.
