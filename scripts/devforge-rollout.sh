#!/usr/bin/env bash
# Déploiement DevForge automatisé (Linux/macOS → NAS Docker Coolify)
#
# Usage:
#   ./scripts/devforge-rollout.sh bobdivx@10.1.0.58
#   ./scripts/devforge-rollout.sh bobdivx@10.1.0.58 --enable-agents
#   ./scripts/devforge-rollout.sh                    # build + artefact local seulement

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

NAS_HOST=""
CONTAINER_NAME="coolify"
ENV_FILE="/data/coolify/source/.env"
ENABLE_AGENTS="false"
SKIP_FRONTEND="false"
SKIP_BUILD="false"
KEEP_ARTIFACT="false"

if [[ $# -gt 0 && "${1}" != --* ]]; then
    NAS_HOST="$1"
    shift
fi

while [[ $# -gt 0 ]]; do
    case "$1" in
        --enable-agents) ENABLE_AGENTS="true" ;;
        --skip-frontend) SKIP_FRONTEND="true" ;;
        --skip-build) SKIP_BUILD="true" ;;
        --keep-artifact) KEEP_ARTIFACT="true" ;;
        --container) CONTAINER_NAME="$2"; shift ;;
        --env-file) ENV_FILE="$2"; shift ;;
        *) echo "Option inconnue: $1" >&2; exit 1 ;;
    esac
    shift
done

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ARTIFACT="${ROOT}/devforge-rollout-${TIMESTAMP}.tar.gz"
PATHS_FILE="${ROOT}/scripts/devforge-package.paths"
REMOTE_SCRIPT="${ROOT}/scripts/devforge-rollout-remote.sh"
NAS_DATA_DIR_SCRIPT="${ROOT}/scripts/devforge-nas-data-dir.sh"

log() { printf '==> %s\n' "$*"; }

collect_paths() {
    if command -v pwsh >/dev/null 2>&1; then
        pwsh -NoProfile -File "${ROOT}/scripts/Resolve-DevForgePackage.ps1" -Root "${ROOT}"
        return
    fi

    bash "${ROOT}/scripts/devforge-package-collect.sh"
}

if [[ "${SKIP_FRONTEND}" != "true" ]]; then
    log "Build Astro DevForge"
    if [[ -f "${ROOT}/package-lock.json" ]]; then
        npm ci
    else
        npm install
    fi
    npm run build:devforge
fi

if [[ "${SKIP_BUILD}" != "true" ]]; then
    log "Préparation artefact"
    mapfile -t package_paths < <(collect_paths)
    log "Fichiers dans le package: ${#package_paths[@]}"
    if [[ ${#package_paths[@]} -eq 0 ]]; then
        echo "Aucun fichier DevForge à empaqueter." >&2
        exit 1
    fi
    
    # Détecter le layout monorepo
    if [[ -f "${ROOT}/backend/artisan" ]]; then
        LARAVEL_ROOT="${ROOT}/backend"
    else
        LARAVEL_ROOT="${ROOT}"
    fi
    
    # Créer un répertoire de staging pour mapper les chemins correctement
    STAGING_DIR="$(mktemp -d)"
    trap "rm -rf '${STAGING_DIR}'" EXIT
    
    for deploy_path in "${package_paths[@]}"; do
        # Déterminer le chemin source réel
        if [[ "${deploy_path}" == "frontend" || "${deploy_path}" == frontend/* || "${deploy_path}" == scripts/* ]]; then
            src="${ROOT}/${deploy_path}"
        else
            src="${LARAVEL_ROOT}/${deploy_path}"
        fi
        
        # Vérifier que le fichier/dossier existe
        if [[ ! -e "${src}" ]]; then
            echo "ATTENTION: Fichier absent dans les sources: ${deploy_path} (${src})" >&2
            continue
        fi
        
        # Créer la structure dans staging
        dest="${STAGING_DIR}/${deploy_path}"
        dest_dir="$(dirname "${dest}")"
        mkdir -p "${dest_dir}"
        
        # Copier avec préservation des attributs
        if [[ -d "${src}" ]]; then
            cp -a "${src}" "${dest_dir}/"
        else
            cp -a "${src}" "${dest}"
        fi
    done
    
    tar -czf "${ARTIFACT}" -C "${STAGING_DIR}" .
    log "Artefact: ${ARTIFACT}"
fi

if [[ -z "${NAS_HOST}" ]]; then
    cat <<EOF
Mode local uniquement.
Pour déployer:
  ./scripts/devforge-rollout.sh bobdivx@10.1.0.58
  ./scripts/devforge-rollout.sh bobdivx@10.1.0.58 --enable-agents
EOF
    exit 0
fi

if [[ "${SKIP_BUILD}" == "true" && ! -f "${ARTIFACT}" ]]; then
    ARTIFACT="$(ls -t "${ROOT}"/devforge-rollout-*.tar.gz 2>/dev/null | head -1 || true)"
    [[ -n "${ARTIFACT}" ]] || { echo "Aucun artefact trouvé." >&2; exit 1; }
fi

REMOTE_DIR="/DATA/.devforge/staging/deploy-${TIMESTAMP}"
REMOTE_ARTIFACT="${REMOTE_DIR}/rollout.tar.gz"

log "Transfert vers ${NAS_HOST}"
ssh "${NAS_HOST}" "mkdir -p '${REMOTE_DIR}' /DATA/.devforge/backups"
scp "${ARTIFACT}" "${NAS_HOST}:${REMOTE_ARTIFACT}"
scp "${REMOTE_SCRIPT}" "${NAS_HOST}:${REMOTE_DIR}/remote.sh"
scp "${NAS_DATA_DIR_SCRIPT}" "${NAS_HOST}:${REMOTE_DIR}/devforge-nas-data-dir.sh"

log "Application sur le NAS"
ssh "${NAS_HOST}" "sed -i 's/\\r\$//' '${REMOTE_DIR}/remote.sh' '${REMOTE_DIR}/devforge-nas-data-dir.sh' && chmod +x '${REMOTE_DIR}/remote.sh' && bash '${REMOTE_DIR}/remote.sh' '${REMOTE_ARTIFACT}' '${CONTAINER_NAME}' '${ENV_FILE}' '${ENABLE_AGENTS}'"
ssh "${NAS_HOST}" "rm -rf '${REMOTE_DIR}'"

if [[ "${KEEP_ARTIFACT}" != "true" ]]; then
    rm -f "${ARTIFACT}"
fi

cat <<EOF

Déploiement terminé sur ${NAS_HOST}
Ouvrir: http://10.1.0.58:8080/devforge/
EOF
