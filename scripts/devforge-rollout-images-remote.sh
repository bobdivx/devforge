#!/usr/bin/env bash
# Remote apply for DevForge *image* stack (compose), called from Windows rollout.
# Args: CONTEXT_DIR ENABLE_AGENTS
set -euo pipefail

CONTEXT_DIR="${1:?context dir required}"
ENABLE_AGENTS="${2:-true}"
COMPOSE_DIR="${DEVFORGE_COMPOSE_DIR:-/media/Docker/AppData/devforge/source}"
DATA_ROOT="${DEVFORGE_DATA_ROOT:-/media/Docker/AppData/devforge}"
ENV_FILE="${COMPOSE_DIR}/.env"
TAG="${DEVFORGE_IMAGE_TAG:-local}"

fail() { echo "ERROR: $*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "docker introuvable"
[[ -d "${CONTEXT_DIR}" ]] || fail "context manquant: ${CONTEXT_DIR}"

ensure_dir() {
  local dir="$1"
  if mkdir -p "${dir}" 2>/dev/null; then
    return 0
  fi
  if command -v sudo >/dev/null 2>&1 && sudo mkdir -p "${dir}"; then
    sudo chown -R "$(id -u):$(id -g)" "${dir}" 2>/dev/null || true
    return 0
  fi
  fail "impossible de creer ${dir} (permission denied — NAS_USE_SUDO / droits root)"
}

ensure_dir "${COMPOSE_DIR}"
ensure_dir "${DATA_ROOT}/ssh"
ensure_dir "${DATA_ROOT}/applications"
ensure_dir "${DATA_ROOT}/databases"
ensure_dir "${DATA_ROOT}/services"
ensure_dir "${DATA_ROOT}/backups"
ensure_dir "${DATA_ROOT}/data"
ensure_dir "${DATA_ROOT}/postgres"
ensure_dir "${DATA_ROOT}/redis"

echo "==> Sync compose + docker configs"
cp -f "${CONTEXT_DIR}/docker-compose.yml" "${COMPOSE_DIR}/"
cp -f "${CONTEXT_DIR}/docker-compose.prod.yml" "${COMPOSE_DIR}/"
mkdir -p "${COMPOSE_DIR}/docker"
cp -a "${CONTEXT_DIR}/docker/devforge-proxy" "${COMPOSE_DIR}/docker/" 2>/dev/null || true
cp -a "${CONTEXT_DIR}/docker/devforge-web" "${COMPOSE_DIR}/docker/" 2>/dev/null || true
cp -a "${CONTEXT_DIR}/docker/devforge-api" "${COMPOSE_DIR}/docker/" 2>/dev/null || true
cp -a "${CONTEXT_DIR}/docker/devforge-realtime" "${COMPOSE_DIR}/docker/" 2>/dev/null || true
cp -a "${CONTEXT_DIR}/docker/production" "${COMPOSE_DIR}/docker/" 2>/dev/null || true

ENV_FILE="${COMPOSE_DIR}/.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  if [[ -f "${CONTEXT_DIR}/.env.devforge.example" ]]; then
    cp -f "${CONTEXT_DIR}/.env.devforge.example" "${ENV_FILE}"
    echo "Created ${ENV_FILE} from .env.devforge.example — edit secrets before production use."
  elif [[ -f "${CONTEXT_DIR}/.env.example" ]]; then
    cp -f "${CONTEXT_DIR}/.env.example" "${ENV_FILE}"
  else
    fail "missing ${ENV_FILE}"
  fi
fi

# Force agents flag
if grep -q '^DEVFORGE_AGENTS_ENABLED=' "${ENV_FILE}"; then
  sed -i "s/^DEVFORGE_AGENTS_ENABLED=.*/DEVFORGE_AGENTS_ENABLED=${ENABLE_AGENTS}/" "${ENV_FILE}"
else
  echo "DEVFORGE_AGENTS_ENABLED=${ENABLE_AGENTS}" >> "${ENV_FILE}"
fi
grep -q '^DEVFORGE_ENABLED=' "${ENV_FILE}" || echo 'DEVFORGE_ENABLED=true' >> "${ENV_FILE}"
sed -i 's/^DEVFORGE_ENABLED=.*/DEVFORGE_ENABLED=true/' "${ENV_FILE}"

# Image tags in env
sed -i "s|^DEVFORGE_API_IMAGE=.*|DEVFORGE_API_IMAGE=devforge-api:${TAG}|" "${ENV_FILE}" || true
grep -q '^DEVFORGE_API_IMAGE=' "${ENV_FILE}" || echo "DEVFORGE_API_IMAGE=devforge-api:${TAG}" >> "${ENV_FILE}"
sed -i "s|^DEVFORGE_WEB_IMAGE=.*|DEVFORGE_WEB_IMAGE=devforge-web:${TAG}|" "${ENV_FILE}" || true
grep -q '^DEVFORGE_WEB_IMAGE=' "${ENV_FILE}" || echo "DEVFORGE_WEB_IMAGE=devforge-web:${TAG}" >> "${ENV_FILE}"
sed -i "s|^DEVFORGE_REALTIME_IMAGE=.*|DEVFORGE_REALTIME_IMAGE=devforge-realtime:${TAG}|" "${ENV_FILE}" || true
grep -q '^DEVFORGE_REALTIME_IMAGE=' "${ENV_FILE}" || echo "DEVFORGE_REALTIME_IMAGE=devforge-realtime:${TAG}" >> "${ENV_FILE}"

cd "${CONTEXT_DIR}"

echo "==> Build images"
docker build -f docker/devforge-api/Dockerfile -t "devforge-api:${TAG}" .
docker build -f docker/devforge-web/Dockerfile -t "devforge-web:${TAG}" .
docker build -f docker/devforge-realtime/Dockerfile -t "devforge-realtime:${TAG}" .

cp -f docker-compose.yml docker-compose.prod.yml "${COMPOSE_DIR}/"

echo "==> Compose up"
cd "${COMPOSE_DIR}"
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "${ENV_FILE}" up -d --remove-orphans

echo "==> Migrations + cache"
docker exec -w /var/www/html devforge-api php artisan migrate --force || true
docker exec -w /var/www/html devforge-api php artisan config:clear || true
docker exec -w /var/www/html devforge-api php artisan route:clear || true
docker exec -w /var/www/html devforge-api php artisan view:clear || true
docker exec -w /var/www/html devforge-api php artisan queue:restart || true

echo "==> Disk prune"
if [[ -f "${CONTEXT_DIR}/scripts/devforge-disk-prune.sh" ]]; then
  bash "${CONTEXT_DIR}/scripts/devforge-disk-prune.sh" || true
elif [[ -f /DATA/.devforge/scripts/devforge-disk-prune.sh ]]; then
  bash /DATA/.devforge/scripts/devforge-disk-prune.sh || true
fi

echo "==> Health"
docker ps --filter name=devforge --format '{{.Names}} {{.Status}}'
curl -fsS -o /dev/null -w 'proxy:%{http_code}\n' "http://127.0.0.1:${DEVFORGE_HTTP_PORT:-8080}/" || true
curl -fsS -o /dev/null -w 'health:%{http_code}\n' "http://127.0.0.1:${DEVFORGE_HTTP_PORT:-8080}/api/health" || true

echo "DevForge image stack deployed."
echo "UI: http://$(hostname -I 2>/dev/null | awk '{print $1}'):${DEVFORGE_HTTP_PORT:-8080}/"
