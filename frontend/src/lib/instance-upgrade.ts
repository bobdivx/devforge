import type { InstanceUpgradeStatus } from './domain-api';

export const INSTANCE_UPGRADE_MAX_STEP = 6;
export const INSTANCE_UPGRADE_CHANGED_EVENT = 'devforge:instance-upgrade-changed';
export const INSTANCE_HEALTH_URL = '/api/health';
export const INSTANCE_UPGRADE_SUCCESS_COUNTDOWN = 3;

export const INSTANCE_UPGRADE_UI_STEPS = [
    { id: 1, label: 'Préparation' },
    { id: 2, label: 'Helper' },
    { id: 3, label: 'Image' },
    { id: 4, label: 'Redémarrage' },
] as const;

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

export function mapInstanceUpgradeStepToUi(apiStep: number): number {
    if (apiStep <= 0) {
        return 0;
    }

    if (apiStep <= 2) {
        return 1;
    }

    if (apiStep === 3) {
        return 2;
    }

    if (apiStep <= 5) {
        return 3;
    }

    return 4;
}

export function instanceUpgradeUiStep(input: {
    status?: InstanceUpgradeStatus | null;
    unreachable?: boolean;
    complete?: boolean;
    starting?: boolean;
}): number {
    if (input.complete || input.status?.status === 'complete') {
        return 5;
    }

    if (input.unreachable) {
        return 4;
    }

    if (input.starting && (input.status?.step ?? 0) <= 0) {
        return 1;
    }

    return mapInstanceUpgradeStepToUi(input.status?.step ?? 0);
}

export function formatInstanceUpgradeElapsed(seconds: number): string {
    const minutes = Math.floor(Math.max(0, seconds) / 60);
    const rest = Math.max(0, seconds) % 60;

    return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

export function instanceUpgradeReviveMessage(elapsedMinutes: number, attempts: number): string {
    if (elapsedMinutes <= 0) {
        return `En attente du retour de DevForge… (tentative ${attempts})`;
    }

    if (elapsedMinutes < 2) {
        return `En attente du retour de DevForge… (${elapsedMinutes} min)`;
    }

    if (elapsedMinutes < 5) {
        return `Mise à jour en cours, cela peut prendre plusieurs minutes… (${elapsedMinutes} min)`;
    }

    if (elapsedMinutes < 10) {
        return `Les mises à jour importantes peuvent prendre plus de 10 minutes. Patience… (${elapsedMinutes} min)`;
    }

    return `Toujours en cours. Au-delà de 15 minutes, consultez les logs serveur (upgrade*)… (${elapsedMinutes} min)`;
}

export function notifyInstanceUpgradeChanged(): void {
    if (typeof window === 'undefined') {
        return;
    }

    window.dispatchEvent(new Event(INSTANCE_UPGRADE_CHANGED_EVENT));
}

export async function checkInstanceHealth(): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 5_000);

    try {
        const response = await fetch(INSTANCE_HEALTH_URL, {
            credentials: 'include',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        });

        return response.ok;
    } catch {
        return false;
    } finally {
        window.clearTimeout(timeoutId);
    }
}
