# Mises à jour

Self-update réel (plus de stub) : crate `update`.

UI : `/app/update` (+ écran d’attente `/app/update/wait`), et **Cluster** pour les workers.

Modes (`DEVFORGE_UPDATE_MODE`) :

| Mode | Comportement |
|------|----------------|
| `compose` | `docker compose pull/up` sur le fichier monté (image officielle) |
| `docker` | Recrée le conteneur `DEVFORGE_SELF_CONTAINER` |
| `binary` | Télécharge l’assistant Windows ou le Flatpak Linux (un ancien zip reste accepté) |
| `auto` | Détecte compose vs docker vs binary |

API : `GET /api/v1/update/check` · `status` · `POST /api/v1/update/start`.

## Cluster

Chaque nœud applique **sa** self-update (même pipeline compose/docker/binary). Le leader ne pousse pas l’image à la place du worker : il déclenche `POST {advertise_url}/internal/update/start` (secret de nœud).

- **Leader** — Paramètres → Mise à jour, ou fiche Cluster → *Mise à jour du leader* (redémarre l’UI).
- **Worker** — fiche nœud → *Mettre à jour ce nœud*, ou bouton *Mettre à jour N workers* si plusieurs sont en retard. Les apps Docker déjà lancées sur le worker **ne sont pas** recréées.
- Un worker trop ancien (sans `/internal/update`) doit être mis à jour **une première fois** sur la machine (Paramètres du nœud, ou `docker pull` + recreate). Ensuite le leader pilote les suivantes.
- Version reportée via le heartbeat (`metrics.software_version`).

Les pushes `main` publient une release (bump patch si la version Cargo est déjà taguée), images Hub + GHCR. L’assistant Windows et le Flatpak sont construits une fois par jour. Voir `.github/workflows/release.yml` et `images.yml`.
