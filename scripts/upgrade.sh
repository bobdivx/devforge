#!/usr/bin/env bash
## DevForge Upgrade Script
## Usage: bash upgrade.sh [LATEST_IMAGE] [LATEST_HELPER_VERSION] [REGISTRY_URL] [SKIP_BACKUP]

set -euo pipefail

LATEST_IMAGE="${1:-latest}"
LATEST_HELPER_VERSION="${2:-latest}"
REGISTRY_URL="${3:-docker.io}"
SKIP_BACKUP="${4:-false}"

DEVFORGE_IMAGE="${DEVFORGE_IMAGE:-bobdivx/devforge}"
API_IMAGE="${DEVFORGE_IMAGE}:${LATEST_IMAGE}"
WEB_IMAGE="${DEVFORGE_IMAGE}:web"
REALTIME_IMAGE="${DEVFORGE_IMAGE}:realtime"
HELPER_IMAGE="${DEVFORGE_IMAGE}:helper"
PROXY_IMAGE="${DEVFORGE_PROXY_IMAGE:-nginx:1.27.5-alpine}"

# Find or initialize working directory
WORK_DIR="/data/devforge"
if [ -d "/data/coolify/source" ]; then
    WORK_DIR="/data/coolify/source"
elif [ -d "/DATA/AppData/devforge" ]; then
    WORK_DIR="/DATA/AppData/devforge"
elif [ -d "/media/Docker/AppData/devforge" ]; then
    WORK_DIR="/media/Docker/AppData/devforge"
fi
mkdir -p "${WORK_DIR}" /data/coolify/source /data/devforge /tmp 2>/dev/null || true

DATE=$(date +%Y-%m-%d-%H-%M-%S)
LOGFILE="${WORK_DIR}/upgrade-${DATE}.log"

# Status file locations to notify all listeners
STATUS_FILES=(
    "/data/coolify/source/.upgrade-status"
    "/data/devforge/.upgrade-status"
    "/tmp/.upgrade-status"
)
if [ -d "/DATA/AppData/devforge" ]; then
    STATUS_FILES+=("/DATA/AppData/devforge/.upgrade-status")
fi
if [ -d "/media/Docker/AppData/devforge" ]; then
    STATUS_FILES+=("/media/Docker/AppData/devforge/.upgrade-status")
fi

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOGFILE"
}

log_section() {
    echo "" >>"$LOGFILE"
    echo "============================================================" | tee -a "$LOGFILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOGFILE"
    echo "============================================================" | tee -a "$LOGFILE"
}

write_status() {
    local step="$1"
    local message="$2"
    local payload="${step}|${message}|$(date -Iseconds)"
    for sf in "${STATUS_FILES[@]}"; do
        mkdir -p "$(dirname "$sf")" 2>/dev/null || true
        echo "$payload" > "$sf" 2>/dev/null || true
    done
}

echo ""
echo "=========================================="
echo "   DevForge Upgrade - ${DATE}"
echo "=========================================="
echo "Target Version: ${LATEST_IMAGE}"
echo "Helper Version: ${LATEST_HELPER_VERSION}"
echo "Registry:       ${REGISTRY_URL}"
echo ""

log_section "Step 1/6: Preparing upgrade environment"
write_status "1" "Préparation de la mise à jour DevForge"

# Detect docker compose file if available
COMPOSE_FILE=""
for candidate in \
    "${WORK_DIR}/docker-compose.yml" \
    "${WORK_DIR}/docker-compose.prod.yml" \
    "/DATA/AppData/devforge/docker-compose.yml" \
    "/DATA/AppData/io.github.bobdivx.devforge/docker-compose.yml" \
    "/media/Docker/AppData/devforge/docker-compose.yml" \
    "/data/coolify/source/docker-compose.yml"; do
    if [ -f "$candidate" ]; then
        COMPOSE_FILE="$candidate"
        log "Found compose file: $COMPOSE_FILE"
        break
    fi
done

log_section "Step 2/6: Checking network configuration"
write_status "2" "Vérification des configurations réseau"

# Ensure docker network exists
if ! docker network inspect devforge >/dev/null 2>&1 && ! docker network inspect coolify >/dev/null 2>&1; then
    log "Creating devforge Docker network..."
    docker network create --attachable devforge 2>/dev/null || docker network create devforge 2>/dev/null || true
fi

# Fix SSH directory permissions if present
for ssh_dir in /data/devforge/ssh /data/coolify/ssh /DATA/AppData/devforge/ssh /media/Docker/AppData/devforge/ssh; do
    if [ -d "$ssh_dir" ]; then
        chmod -R 700 "$ssh_dir" 2>/dev/null || true
    fi
done

log_section "Step 3/6: Pulling Docker images"
write_status "3" "Téléchargement des images DevForge (${LATEST_IMAGE})"

log "Pulling API image: ${API_IMAGE}..."
docker pull "${API_IMAGE}" || docker pull "${DEVFORGE_IMAGE}:latest" || true

log "Pulling Web SPA image: ${WEB_IMAGE}..."
docker pull "${WEB_IMAGE}" || true

log "Pulling Realtime image: ${REALTIME_IMAGE}..."
docker pull "${REALTIME_IMAGE}" || true

log "Pulling Helper image: ${HELPER_IMAGE}..."
docker pull "${HELPER_IMAGE}" || true

log "Pulling Proxy image: ${PROXY_IMAGE}..."
docker pull "${PROXY_IMAGE}" || true

log_section "Step 4/6: Restarting containers (detached)"
write_status "4" "Redémarrage des conteneurs DevForge"

nohup bash -c "
    LOGFILE='${LOGFILE}'
    LATEST_IMAGE='${LATEST_IMAGE}'
    COMPOSE_FILE='${COMPOSE_FILE}'
    WORK_DIR='${WORK_DIR}'

    log() {
        echo \"[\$(date '+%Y-%m-%d %H:%M:%S')] \$1\" >>\"\$LOGFILE\"
    }

    write_status() {
        local step=\"\$1\"
        local message=\"\$2\"
        local payload=\"\${step}|\${message}|\$(date -Iseconds)\"
        for sf in '/data/coolify/source/.upgrade-status' '/data/devforge/.upgrade-status' '/tmp/.upgrade-status' '/DATA/AppData/devforge/.upgrade-status' '/media/Docker/AppData/devforge/.upgrade-status'; do
            mkdir -p \"\$(dirname \"\$sf\")\" 2>/dev/null || true
            echo \"\$payload\" > \"\$sf\" 2>/dev/null || true
        done
    }

    log 'Starting container reload...'
    write_status '5' 'Démarrage des nouveaux conteneurs et migrations'

    # If compose file exists, use docker compose
    if [ -n \"\$COMPOSE_FILE\" ] && [ -f \"\$COMPOSE_FILE\" ]; then
        log \"Using compose file: \$COMPOSE_FILE\"
        COMPOSE_DIR=\"\$(dirname \"\$COMPOSE_FILE\")\"
        cd \"\$COMPOSE_DIR\"
        LATEST_IMAGE=\"\${LATEST_IMAGE}\" docker compose pull --ignore-pull-failures 2>>\"\$LOGFILE\" || true
        LATEST_IMAGE=\"\${LATEST_IMAGE}\" docker compose up -d --remove-orphans 2>>\"\$LOGFILE\" || true
    else
        # Direct container recreation / restart
        for c in devforge-realtime devforge-web devforge-api devforge-proxy; do
            if docker ps -a --format '{{.Names}}' | grep -qx \"\$c\"; then
                log \"Restarting container: \$c\"
                docker restart \"\$c\" >>\"\$LOGFILE\" 2>&1 || true
            fi
        done
    fi

    # Wait for API container to come online
    log 'Waiting for DevForge API container...'
    API_C=\"devforge-api\"
    if ! docker ps --format '{{.Names}}' | grep -qx \"\$API_C\"; then
        if docker ps --format '{{.Names}}' | grep -qx 'api'; then
            API_C=\"api\"
        elif docker ps --format '{{.Names}}' | grep -qx 'coolify'; then
            API_C=\"coolify\"
        fi
    fi

    sleep 5
    for attempt in \$(seq 1 12); do
        if docker ps --format '{{.Names}}' | grep -qx \"\$API_C\"; then
            log \"API container \$API_C is running (attempt \$attempt)\"
            break
        fi
        sleep 3
    done

    # Run database migrations
    if docker ps --format '{{.Names}}' | grep -qx \"\$API_C\"; then
        log 'Running Laravel migrations...'
        docker exec -w /var/www/html \"\$API_C\" php artisan migrate --force >>\"\$LOGFILE\" 2>&1 || true

        log 'Clearing Laravel optimization and cache...'
        docker exec -w /var/www/html \"\$API_C\" php artisan optimize:clear >>\"\$LOGFILE\" 2>&1 || true
        docker exec -w /var/www/html \"\$API_C\" php artisan queue:restart >>\"\$LOGFILE\" 2>&1 || true
        docker exec -w /var/www/html \"\$API_C\" php artisan horizon:terminate >>\"\$LOGFILE\" 2>&1 || true
    fi

    log 'Step 6/6: Upgrade complete'
    write_status '6' 'Mise à jour terminée avec succès'
    log \"DevForge successfully upgraded to \${LATEST_IMAGE}\"

    sleep 15
    for sf in '/data/coolify/source/.upgrade-status' '/data/devforge/.upgrade-status' '/tmp/.upgrade-status'; do
        rm -f \"\$sf\" 2>/dev/null || true
    done
    log 'Status files cleaned up.'
" >>"$LOGFILE" 2>&1 &

sleep 2
echo "Upgrade process initiated in the background."
echo "Log file: ${LOGFILE}"
