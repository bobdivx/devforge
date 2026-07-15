#!/usr/bin/env bash
# Résout le répertoire de données DevForge sur le NAS (évite la partition racine 1,2 Go).
# Usage: source scripts/devforge-nas-data-dir.sh && devforge_resolve_data_dir

devforge_resolve_data_dir() {
    if [[ -n "${DEVFORGE_DATA_DIR:-}" ]]; then
        echo "${DEVFORGE_DATA_DIR}"
        return 0
    fi

    local candidate parent
    for candidate in /DATA/.devforge /data/.devforge; do
        parent="$(dirname "${candidate}")"
        if [[ -d "${parent}" ]]; then
            if [[ ! -d "${candidate}" ]]; then
                if mkdir -p "${candidate}/backups" "${candidate}/staging" 2>/dev/null; then
                    :
                elif command -v sudo >/dev/null 2>&1; then
                    sudo mkdir -p "${candidate}/backups" "${candidate}/staging"
                    sudo chown -R "$(whoami)":samba "${candidate}" 2>/dev/null \
                        || sudo chown -R "$(whoami)" "${candidate}" 2>/dev/null \
                        || true
                else
                    continue
                fi
            fi
            echo "${candidate}"
            return 0
        fi
    done

    echo "/tmp/devforge-fallback"
}

devforge_cleanup_stale_temp() {
    local data_dir="${1:-$(devforge_resolve_data_dir)}"

    rm -rf /tmp/devforge-rollout-* /tmp/devforge-staging-* /tmp/devforge-hotfix 2>/dev/null || true

    if [[ -d "${data_dir}/backups" ]]; then
        local backup
        local count=0
        while IFS= read -r backup; do
            count=$((count + 1))
            if [[ ${count} -gt 3 ]]; then
                rm -f "${backup}" 2>/dev/null || true
            fi
        done < <(ls -t "${data_dir}/backups"/devforge-backup-*.tar.gz 2>/dev/null || true)
    fi

    if [[ -d /tmp/devforge-backups ]]; then
        mv /tmp/devforge-backups/* "${data_dir}/backups/" 2>/dev/null || true
        rmdir /tmp/devforge-backups 2>/dev/null || true
    fi
}
