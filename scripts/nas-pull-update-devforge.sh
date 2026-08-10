#!/usr/bin/env bash
# Force-pull DevForge images on the NAS, then show whether running containers are stale.
#
# Usage (on the NAS):
#   bash scripts/nas-pull-update-devforge.sh
#
# Then recreate via CasaOS/ZimaOS « Update », or:
#   docker compose -f /path/to/devforge.zimaos.yaml pull
#   docker compose -f /path/to/devforge.zimaos.yaml up -d --force-recreate api realtime
#
# Optional overrides:
#   DEVFORGE_API_IMAGE=bobdivx/devforge:4.1.2 \
#   DEVFORGE_REALTIME_IMAGE=bobdivx/devforge:realtime-latest \
#   bash scripts/nas-pull-update-devforge.sh

set -euo pipefail

API_IMAGE="${DEVFORGE_API_IMAGE:-bobdivx/devforge:latest}"
REALTIME_IMAGE="${DEVFORGE_REALTIME_IMAGE:-bobdivx/devforge:realtime}"
HELPER_IMAGE="${HELPER_IMAGE:-bobdivx/devforge:helper}"
API_CONTAINER="${NAS_API_CONTAINER:-devforge-api}"
REALTIME_CONTAINER="${NAS_REALTIME_CONTAINER:-devforge-realtime}"

echo "==> Pull ${API_IMAGE}"
docker pull "${API_IMAGE}"

echo "==> Pull ${REALTIME_IMAGE}"
docker pull "${REALTIME_IMAGE}"

echo "==> Pull ${HELPER_IMAGE} (deployments)"
docker pull "${HELPER_IMAGE}" || true

echo
echo "==> Digests locaux (après pull)"
API_DIGEST="$(docker image inspect "${API_IMAGE}" --format '{{index .RepoDigests 0}}' 2>/dev/null || echo 'n/a')"
REALTIME_DIGEST="$(docker image inspect "${REALTIME_IMAGE}" --format '{{index .RepoDigests 0}}' 2>/dev/null || echo 'n/a')"
echo "  api:      ${API_DIGEST}"
echo "  realtime: ${REALTIME_DIGEST}"

echo
echo "==> Conteneurs en cours"
for name in "${API_CONTAINER}" "${REALTIME_CONTAINER}"; do
  if ! docker inspect "${name}" >/dev/null 2>&1; then
    echo "  ${name}: absent"
    continue
  fi

  running_image="$(docker inspect "${name}" --format '{{.Config.Image}}' 2>/dev/null || echo '?')"
  running_id="$(docker inspect "${name}" --format '{{.Image}}' 2>/dev/null || echo '?')"
  latest_id="$(docker image inspect "${running_image}" --format '{{.Id}}' 2>/dev/null || echo '')"

  if [[ -n "${latest_id}" && "${running_id}" == "${latest_id}" ]]; then
    status="OK (déjà sur l’image locale pullée)"
  else
    status="STALE — recréer le conteneur pour prendre la nouvelle image"
  fi

  echo "  ${name}:"
  echo "    image tag: ${running_image}"
  echo "    status:    ${status}"
done

echo
echo "==> Prochaine étape"
echo "  CasaOS/ZimaOS → app DevForge → Update / recomposer"
echo "  ou compose :"
echo "    docker compose -f devforge.zimaos.yaml pull"
echo "    docker compose -f devforge.zimaos.yaml up -d --force-recreate api realtime"
echo
echo "  Note: redémarrer seul ne change rien si le tag (:api) pointe déjà en local"
echo "  vers une ancienne couche — il faut pull + recréer."
