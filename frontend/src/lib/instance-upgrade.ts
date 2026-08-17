import type { InstanceUpgradeStatus } from './domain-api';

export const INSTANCE_UPGRADE_MAX_STEP = 6;

export function shouldShowInstanceUpgrade(status: InstanceUpgradeStatus | null | undefined): boolean {
    if (!status) {
        return false;
    }

    return status.available
        || status.status === 'in_progress'
        || status.status === 'complete'
        || status.status === 'error';
}

export function instanceUpgradeProgressPercent(status: InstanceUpgradeStatus | null | undefined): number {
    if (!status) {
        return 0;
    }

    if (status.status === 'complete') {
        return 100;
    }

    if (status.status === 'none' || status.status === 'error') {
        return 0;
    }

    return Math.max(0, Math.min(100, Math.round((status.step / INSTANCE_UPGRADE_MAX_STEP) * 100)));
}

export function instanceUpgradeLabel(status: InstanceUpgradeStatus): string {
    if (status.status === 'in_progress') {
        return 'Mise à jour…';
    }

    if (status.status === 'complete') {
        return 'Redémarrage…';
    }

    if (status.status === 'error') {
        return 'Échec de la mise à jour';
    }

    return status.latest_version
        ? `Mise à jour ${status.latest_version}`
        : 'Mise à jour disponible';
}
