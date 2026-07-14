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
    tar -czf "${ARTIFACT}" -C "${ROOT}" "${package_paths[@]}"
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

REMOTE_ARTIFACT="/tmp/devforge-rollout-${TIMESTAMP}.tar.gz"
REMOTE_SCRIPT_PATH="/tmp/devforge-rollout-remote.sh"

log "Transfert vers ${NAS_HOST}"
scp "${ARTIFACT}" "${NAS_HOST}:${REMOTE_ARTIFACT}"
scp "${REMOTE_SCRIPT}" "${NAS_HOST}:${REMOTE_SCRIPT_PATH}"

log "Application sur le NAS"
ssh "${NAS_HOST}" "sed -i 's/\\r\$//' '${REMOTE_SCRIPT_PATH}' && chmod +x '${REMOTE_SCRIPT_PATH}' && bash '${REMOTE_SCRIPT_PATH}' '${REMOTE_ARTIFACT}' '${CONTAINER_NAME}' '${ENV_FILE}' '${ENABLE_AGENTS}'"
ssh "${NAS_HOST}" "rm -f '${REMOTE_ARTIFACT}' '${REMOTE_SCRIPT_PATH}'"

if [[ "${KEEP_ARTIFACT}" != "true" ]]; then
    rm -f "${ARTIFACT}"
fi

cat <<EOF

Déploiement terminé sur ${NAS_HOST}
Ouvrir: http://10.1.0.58:8080/devforge/
EOF
