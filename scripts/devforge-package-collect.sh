#!/usr/bin/env bash
# Collecte et valide les chemins DevForge (parite avec Resolve-DevForgePackage.ps1)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATHS_FILE="${ROOT}/scripts/devforge-package.paths"
REQUIRED_FILE="${ROOT}/scripts/devforge-package.required"
CHECKS_FILE="${ROOT}/scripts/devforge-package.content-checks.json"

declare -A SEEN=()
PATHS=()

add_path() {
    local path="$1"
    path="${path//$'\r'/}"
    [[ -z "${path}" || "${path}" == \#* ]] && return 0
    path="${path//\\//}"
    [[ -n "${SEEN[$path]+x}" ]] && return 0
    [[ -e "${ROOT}/${path}" ]] || return 0
    SEEN["$path"]=1
    PATHS+=("$path")
}

expand_glob() {
    local pattern="${1#glob:}"
    local dir_part file_part parent
    file_part="$(basename "${pattern}")"
    dir_part="$(dirname "${pattern}")"
    parent="${ROOT}/${dir_part}"
    [[ -d "${parent}" ]] || return 0
    while IFS= read -r -d '' file; do
        add_path "${file#${ROOT}/}"
    done < <(find "${parent}" -type f -name "${file_part}" -print0 2>/dev/null || true)
}

read_list_file() {
    local file="$1"
    [[ -f "${file}" ]] || return 0
    while IFS= read -r line || [[ -n "${line}" ]]; do
        line="$(echo "${line}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
        [[ -z "${line}" || "${line}" == \#* ]] && continue
        if [[ "${line}" == glob:* ]]; then
            expand_glob "${line}"
        else
            add_path "${line}"
        fi
    done < "${file}"
}

read_list_file "${PATHS_FILE}"
read_list_file "${REQUIRED_FILE}"

for migration in \
    "${ROOT}"/database/migrations/2026_07_13_* \
    "${ROOT}"/database/migrations/*ai_agent* \
    "${ROOT}"/database/migrations/*ai_provider*
do
    [[ -e "${migration}" ]] || continue
    add_path "${migration#${ROOT}/}"
done

if command -v php >/dev/null 2>&1; then
    while IFS= read -r line || [[ -n "${line}" ]]; do
        add_path "${line}"
    done < <(php "${ROOT}/scripts/devforge-package-discover.php" "${ROOT}")
fi

if [[ ${#PATHS[@]} -eq 0 ]]; then
    echo "Aucun fichier DevForge a empaqueter." >&2
    exit 1
fi

if [[ -f "${REQUIRED_FILE}" ]]; then
    while IFS= read -r line || [[ -n "${line}" ]]; do
        line="$(echo "${line}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
        [[ -z "${line}" || "${line}" == \#* ]] && continue
        line="${line//\\//}"
        if [[ -z "${SEEN[$line]+x}" ]]; then
            echo "Rollout DevForge incomplet — fichier obligatoire absent: ${line}" >&2
            exit 1
        fi
    done < "${REQUIRED_FILE}"
fi

if [[ -f "${CHECKS_FILE}" ]] && command -v python3 >/dev/null 2>&1; then
    python3 - "${ROOT}" "${CHECKS_FILE}" <<'PY'
import json, sys
root, checks_file = sys.argv[1], sys.argv[2]
checks = json.load(open(checks_file, encoding="utf-8"))
for check in checks.get("checks", []):
    path = check["path"]
    full = f"{root}/{path}"
    try:
        content = open(full, encoding="utf-8").read()
    except OSError:
        print(f"Validation contenu impossible — fichier absent: {path}", file=sys.stderr)
        sys.exit(1)
    for needle in check.get("must_contain", []):
        if needle not in content:
            print(f"Validation contenu echouee: {path}\n  Attendu: {needle}\n  Contexte: {check.get('description','')}", file=sys.stderr)
            sys.exit(1)
PY
fi

printf '%s\n' "${PATHS[@]}"
