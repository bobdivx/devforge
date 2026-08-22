#!/usr/bin/env bash
# Execute sur le NAS via SSH par devforge-rollout.ps1 / devforge-rollout.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/devforge-nas-data-dir.sh" ]]; then
    # shellcheck source=scripts/devforge-nas-data-dir.sh
    source "${SCRIPT_DIR}/devforge-nas-data-dir.sh"
elif [[ -f "$(dirname "${SCRIPT_DIR}")/scripts/devforge-nas-data-dir.sh" ]]; then
    source "$(dirname "${SCRIPT_DIR}")/scripts/devforge-nas-data-dir.sh"
else
    devforge_resolve_data_dir() { echo "${DEVFORGE_DATA_DIR:-/DATA/.devforge}"; }
    devforge_cleanup_stale_temp() { rm -rf /tmp/devforge-rollout-* /tmp/devforge-staging-* 2>/dev/null || true; }
fi

ARTIFACT="${1:?Chemin de l artefact tar.gz requis}"
CONTAINER="${2:-devforge-api}"
HOST_ENV_FILE="${3:-}"
if [[ "${HOST_ENV_FILE}" == "-" ]]; then
    HOST_ENV_FILE=""
fi
ENABLE_AGENTS="${4:-false}"

DATA_DIR="$(devforge_resolve_data_dir)"
BACKUP_DIR="${5:-${DATA_DIR}/backups}"
STAGING="${DATA_DIR}/staging/rollout-$$"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="${BACKUP_DIR}/devforge-backup-${TIMESTAMP}.tar.gz"
CONTAINER_ENV="/var/www/html/.env"

cleanup_staging() {
    rm -rf "${STAGING}" 2>/dev/null || true
}
trap cleanup_staging EXIT

log() { printf '==> %s\n' "$*"; }
fail() { printf 'ERREUR: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "docker introuvable sur le NAS"
docker ps --format '{{.Names}}' | grep -qx "${CONTAINER}" || fail "conteneur ${CONTAINER} introuvable"

log "Nettoyage des anciens fichiers temporaires DevForge"
devforge_cleanup_stale_temp "${DATA_DIR}"

mkdir -p "${BACKUP_DIR}" "${STAGING}"

log "Sauvegarde des fichiers DevForge dans le conteneur"
docker exec "${CONTAINER}" sh -c '
    cd /var/www/html
    tar -czf - \
        app/Http/Controllers/DevForgeController.php \
        app/Http/Controllers/DevForge \
        app/Jobs/ApplicationDeploymentJob.php \
        app/Jobs/Agent \
        app/Services/DevForge \
        config/devforge.php \
        routes/devforge-api.php \
        routes/devforge-applications.php \
        routes/devforge-databases.php \
        routes/devforge-database-backups.php \
        routes/devforge-s3-storages.php \
        routes/devforge-server-storage.php \
        routes/devforge-server-files.php \
        routes/devforge-server-settings.php \
        routes/devforge-agents.php \
        routes/devforge-core.php \
        routes/devforge-realtime.php \
        routes/devforge-simple.php \
        public/devforge \
        2>/dev/null || true
' > "${BACKUP}" || true

log "Extraction de ${ARTIFACT}"
tar --warning=no-timestamp -xzf "${ARTIFACT}" -C "${STAGING}"

log "Copie vers ${CONTAINER}:/var/www/html/"
docker cp "${STAGING}/." "${CONTAINER}:/var/www/html/"

WEB_CONTAINER="devforge-web"
if docker ps --format '{{.Names}}' | grep -qx "${WEB_CONTAINER}"; then
    if [[ -d "${STAGING}/public/devforge" ]]; then
        log "Copie SPA vers ${WEB_CONTAINER}:/usr/share/nginx/html/"
        docker cp "${STAGING}/public/devforge/." "${WEB_CONTAINER}:/usr/share/nginx/html/"
        echo "WEB_CONTAINER_UPDATED"
    else
        log "AVERTISSEMENT: ${STAGING}/public/devforge absent — ${WEB_CONTAINER} non mis a jour"
    fi
else
    fail "Conteneur ${WEB_CONTAINER} introuvable — impossible de mettre a jour l interface utilisateur"
fi

apply_proxy_nginx() {
    local src="${1:-}"
    local dest="/media/Docker/AppData/devforge/nginx/default.conf"
    if [[ -z "${src}" || ! -f "${src}" ]]; then
        return 0
    fi
    if ! grep -q '|mcp|webhooks)(/|$)' "${src}"; then
        log "AVERTISSEMENT: nginx.conf sans proxy /webhooks — ignore"
        return 0
    fi
    log "Mise a jour proxy nginx ${dest}"
    if [[ -f "${dest}" ]] || sudo test -f "${dest}" 2>/dev/null; then
        if sudo cp -f "${src}" "${dest}" 2>/dev/null || cp -f "${src}" "${dest}"; then
            docker exec devforge-proxy nginx -t
            docker exec devforge-proxy nginx -s reload
            echo "PROXY_NGINX_OK"
        else
            log "AVERTISSEMENT: impossible d ecrire ${dest}"
        fi
    else
        log "AVERTISSEMENT: ${dest} introuvable — proxy nginx non mis a jour"
    fi
}

BUNDLE_DIR="$(cd "$(dirname "${ARTIFACT}")" && pwd)"
if [[ -f "${BUNDLE_DIR}/nginx.conf" ]]; then
    apply_proxy_nginx "${BUNDLE_DIR}/nginx.conf"
elif [[ -f "${STAGING}/docker/devforge-proxy/nginx.conf" ]]; then
    apply_proxy_nginx "${STAGING}/docker/devforge-proxy/nginx.conf"
fi

set_env_in_container() {
    local key="$1"
    local value="$2"
    docker exec "${CONTAINER}" sh -c "
        if [ ! -f '${CONTAINER_ENV}' ]; then
            touch '${CONTAINER_ENV}'
        fi
        if grep -q '^${key}=' '${CONTAINER_ENV}'; then
            sed -i 's|^${key}=.*|${key}=${value}|' '${CONTAINER_ENV}'
        else
            echo '${key}=${value}' >> '${CONTAINER_ENV}'
        fi
    "
}

get_env_in_container() {
    local key="$1"
    docker exec "${CONTAINER}" printenv "${key}" 2>/dev/null || true
}

set_env_on_host() {
    local key="$1"
    local value="$2"
    local file="$3"
    local runner="$4"

    if [[ ! -f "${file}" ]]; then
        return 1
    fi

    if [[ "${runner}" == "sudo" ]]; then
        if sudo grep -q "^${key}=" "${file}"; then
            sudo sed -i "s|^${key}=.*|${key}=${value}|" "${file}"
        else
            echo "${key}=${value}" | sudo tee -a "${file}" >/dev/null
        fi
    else
        if grep -q "^${key}=" "${file}"; then
            sed -i "s|^${key}=.*|${key}=${value}|" "${file}"
        else
            echo "${key}=${value}" >> "${file}"
        fi
    fi
}

set_env_var() {
    local key="$1"
    local value="$2"
    local current

    current="$(get_env_in_container "${key}")"
    if [[ "${current}" == "${value}" ]]; then
        log "${key}=${value} (deja actif dans le conteneur)"
        return 0
    fi

    if set_env_in_container "${key}" "${value}"; then
        return 0
    fi

    if [[ -n "${HOST_ENV_FILE}" ]] && [[ -f "${HOST_ENV_FILE}" ]]; then
        set_env_on_host "${key}" "${value}" "${HOST_ENV_FILE}" "no" && return 0
    fi

    if [[ -n "${HOST_ENV_FILE}" ]] && sudo test -f "${HOST_ENV_FILE}" 2>/dev/null; then
        set_env_on_host "${key}" "${value}" "${HOST_ENV_FILE}" "sudo" && return 0
    fi

    fail "Impossible de mettre a jour ${key} dans ${CONTAINER_ENV} ni ${HOST_ENV_FILE}"
}

log "Mise a jour DEVFORGE_* dans le conteneur ${CONTAINER}"
set_env_var DEVFORGE_ENABLED true
if [[ "${ENABLE_AGENTS}" == "true" ]]; then
    set_env_var DEVFORGE_AGENTS_ENABLED true
    set_env_var DEVFORGE_AGENTS_AUTO_FALLBACK true
    set_env_var DEVFORGE_AGENTS_PER_DEPLOYMENT_MAX_RUNS 1

    HOST_IP="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.' | head -1)" || true
    if [[ -z "${HOST_IP}" ]]; then
        HOST_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}')" || true
    fi

    OLLAMA_URL=""

    if docker ps -a --format '{{.Names}}' | grep -qx ollama; then
        docker start ollama 2>/dev/null || true
        sleep 3
        OLLAMA_PORT="$(docker port ollama 11434/tcp 2>/dev/null | head -1 | sed 's/.*://')"
        if [[ -n "${OLLAMA_PORT}" ]] && curl -sf "http://127.0.0.1:${OLLAMA_PORT}/api/tags" >/dev/null 2>&1; then
            OLLAMA_URL="http://${HOST_IP:-127.0.0.1}:${OLLAMA_PORT}"
            log "Ollama detecte (conteneur Docker) sur ${OLLAMA_URL}"
        fi
    fi

    if [[ -z "${OLLAMA_URL}" ]]; then
        OLLAMA_URL="http://${HOST_IP:-127.0.0.1}:11434"
    fi

    if [[ -n "${OLLAMA_URL}" ]] && curl -sf "${OLLAMA_URL}/api/tags" >/dev/null 2>&1; then
        log "Ollama detecte sur ${OLLAMA_URL}"
        set_env_var DEVFORGE_OLLAMA_URL "${OLLAMA_URL}"
        set_env_var DEVFORGE_OLLAMA_HOST_IP "${HOST_IP}"
    else
        log "Ollama absent — installation pour fallback agents..."
        if ! command -v ollama >/dev/null 2>&1; then
            curl -fsSL https://ollama.com/install.sh | sh || true
        fi
        if command -v systemctl >/dev/null 2>&1; then
            sudo systemctl enable ollama 2>/dev/null || systemctl enable ollama 2>/dev/null || true
            sudo systemctl start ollama 2>/dev/null || systemctl start ollama 2>/dev/null || true
        fi
        sleep 5
        if curl -sf "${OLLAMA_URL}/api/tags" >/dev/null 2>&1; then
            log "Telechargement modele Ollama leger (llama3.2:3b)..."
            ollama pull llama3.2:3b 2>/dev/null || ollama pull llama3.2 2>/dev/null || true
            set_env_var DEVFORGE_OLLAMA_URL "${OLLAMA_URL}"
            set_env_var DEVFORGE_OLLAMA_HOST_IP "${HOST_IP}"
            log "Fallback Ollama configure : ${OLLAMA_URL}"
        else
            log "AVERTISSEMENT: Ollama indisponible — les agents echoueront si le quota Gemini est depasse"
        fi
    fi
else
    set_env_var DEVFORGE_AGENTS_ENABLED false
fi

log "Migrations Laravel"
docker exec -w /var/www/html "${CONTAINER}" php artisan migrate --force

log "Verification agents IA"
if ! docker exec -w /var/www/html "${CONTAINER}" php -r "require 'vendor/autoload.php'; exit(class_exists('App\\\\Models\\\\AiAgentMessage') ? 0 : 1);"; then
    fail "Modele AiAgentMessage absent dans le conteneur"
fi
if ! docker exec -w /var/www/html "${CONTAINER}" grep -q 'DeploymentBuildAgentDispatcher' /var/www/html/app/Jobs/ApplicationDeploymentJob.php 2>/dev/null; then
    fail "ApplicationDeploymentJob.php ne declenche pas les agents DevForge — relancez nas-fix-devforge.ps1"
fi
if ! docker exec -w /var/www/html "${CONTAINER}" test -f /var/www/html/app/Enums/TaskModelTier.php; then
    fail "TaskModelTier.php absent — rollout incomplet (agents IA)"
fi
echo "AGENT_DISPATCH_OK"

if [[ "${ENABLE_AGENTS}" == "true" ]]; then
    for migration in \
        database/migrations/2026_07_13_100000_add_fallback_provider_to_ai_agents_table.php \
        database/migrations/2026_07_13_110000_create_ai_agent_messages_table.php
    do
        if ! docker exec -w /var/www/html "${CONTAINER}" test -f "/var/www/html/${migration}"; then
            fail "Migration manquante dans le conteneur: ${migration}"
        fi
        docker exec -w /var/www/html "${CONTAINER}" php artisan migrate --force --path="${migration}"
    done
    echo "AGENTS_MIGRATIONS_OK"
fi

log "Vidage des caches"
docker exec -w /var/www/html "${CONTAINER}" php artisan config:clear
docker exec -w /var/www/html "${CONTAINER}" php artisan route:clear
docker exec -w /var/www/html "${CONTAINER}" php artisan optimize:clear 2>/dev/null || true
docker exec -w /var/www/html "${CONTAINER}" php artisan queue:restart 2>/dev/null || true
docker exec -w /var/www/html "${CONTAINER}" php artisan horizon:terminate 2>/dev/null || true

log "Verification des routes DevForge"
ROUTE_LIST_OUTPUT="$(docker exec -w /var/www/html "${CONTAINER}" php artisan route:list --path=devforge --except-vendor 2>&1)" || {
    echo "${ROUTE_LIST_OUTPUT}" >&2
    fail "Impossible de charger les routes DevForge - voir la sortie ci-dessus ou laravel.log"
}
echo "${ROUTE_LIST_OUTPUT}" | head -15 || true

log "Configuration"
docker exec -w /var/www/html "${CONTAINER}" php artisan config:show devforge.enabled
docker exec -w /var/www/html "${CONTAINER}" php artisan config:show devforge.agents_enabled

log "Build frontend"
if ! docker exec "${CONTAINER}" test -f /var/www/html/public/devforge/index.html; then
    fail "public/devforge/index.html manquant"
fi
echo "BUILD_OK"

log "Route SPA Coolify"
if docker exec "${CONTAINER}" grep -q "DevForgeController" /var/www/html/app/Providers/RouteServiceProvider.php; then
    echo "WEB_ROUTE_OK"
else
    echo "AVERTISSEMENT: RouteServiceProvider ne reference pas DevForgeController"
fi

rm -rf "${STAGING}"

HOST_IP="$(hostname -i 2>/dev/null | awk '{print $1}' | head -1)" || true
if [[ -z "${HOST_IP}" ]]; then
    HOST_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}')" || true
fi
if [[ -z "${HOST_IP}" ]]; then
    HOST_IP="10.1.0.58"
fi
printf '\nDeploiement DevForge termine.\n'
printf 'Donnees DevForge: %s\n' "${DATA_DIR}"
printf 'Sauvegarde: %s\n' "${BACKUP}"
printf 'API/Proxy: http://%s:8080/devforge/\n' "${HOST_IP:-10.1.0.58}"
printf 'UI (devforge-web): http://web.briseteia.me / http://%s:8080\n' "${HOST_IP:-10.1.0.58}"
