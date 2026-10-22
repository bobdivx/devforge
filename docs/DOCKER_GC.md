# Nettoyage Docker

Admin → **Nettoyage Docker** (`/app/admin?tab=docker`). Exécuté par le leader sur
chaque nœud via l'executor du cluster (local ou `POST /internal/exec` des workers).

## Défauts

| Réglage | Défaut |
|---------|--------|
| Activé | oui |
| Planification | chaque jour à 03:00, heure de Paris (calculée explicitement en `Europe/Paris`, quel que soit le fuseau de l'hôte) |
| Rétention cache de build + images inutilisées | 24 h |
| Images gardées par projet (rollback) | 3 |
| Seuil d'alerte disque | 85 % → nettoyage d'urgence du nœud (au plus 1×/h) |
| Rotation des logs (`--log-opt`) | désactivée (proposée) |

## Ce qui est supprimé

- cache BuildKit : `docker buildx prune --builder <b> --filter until=<rétention>` par builder
  enregistré, et `buildctl prune --keep-duration <rétention>` dans chaque conteneur
  `buildx_buildkit_*` en cours (builders non enregistrés pour l'utilisateur, cas ZimaOS) ;
- images inutilisées (aucun conteneur) créées il y a plus que la rétention ;
- images d'anciens déploiements d'un projet au-delà des N plus récentes (chaque déploiement
  réussi pose un tag `df-<id>:r<timestamp>` en plus de `:latest`).

Une urgence vide tout le cache de build inutilisé (sans filtre d'âge) ; les règles des images
ne changent pas.

## Jamais touché

Volumes, conteneurs (même arrêtés) et les images qu'ils utilisent, `df-…:latest`.
Pas de `system prune`, `container prune`, `volume …` ni `image rm -f`.

## Environnement

- `DOCKER_CONFIG` non inscriptible (ZimaOS : `/root/.docker` en lecture seule) →
  `/tmp/devforge-docker-gc`.
- Ancien cron `/etc/cron.d/devforge-disk-guard` (pré-v2, cassé sous dcron et qui supprimait
  les conteneurs arrêtés) : déplacé vers `/DATA/.devforge/state/devforge-disk-guard.cron.disabled`
  au démarrage du leader quand l'hôte est visible. Si DevForge tourne en conteneur, l'admin le
  signale : à retirer à la main sur l'hôte.
- `daemon.json` n'est jamais modifié : l'admin affiche l'extrait à appliquer manuellement.
