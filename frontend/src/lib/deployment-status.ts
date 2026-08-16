import type { LucideIcon } from 'lucide-preact';
import {
    Ban,
    CheckCircle2,
    CircleHelp,
    Clock3,
    Loader2,
    Rocket,
    XCircle,
} from 'lucide-preact';

export type DeploymentStatusTone = 'success' | 'warning' | 'error' | 'neutral';

export type ParsedDeploymentStatus = {
    raw: string;
    label: string;
    shortLabel: string;
    tone: DeploymentStatusTone;
    Icon: LucideIcon;
    spin?: boolean;
};

export function parseDeploymentStatus(status: string): ParsedDeploymentStatus {
    const normalized = status.trim().toLowerCase();

    if (normalized === 'finished') {
        return build('finished', 'Déploiement terminé', 'Terminé', 'success', CheckCircle2);
    }

    if (normalized.includes('fail')) {
        return build(status, 'Déploiement échoué', 'Échec', 'error', XCircle);
    }

    if (normalized.includes('cancel')) {
        return build(status, 'Déploiement annulé', 'Annulé', 'neutral', Ban);
    }

    if (normalized.includes('progress') || normalized.includes('building') || normalized.includes('deploying')) {
        return build(status, 'Déploiement en cours', 'En cours', 'warning', Loader2, true);
    }

    if (normalized.includes('queue')) {
        return build(status, 'Déploiement en file d’attente', 'En attente', 'warning', Clock3);
    }

    if (normalized.includes('rollback')) {
        return build(status, 'Retour arrière en cours', 'Rollback', 'warning', Rocket);
    }

    return build(status, capitalize(status), capitalize(status), 'neutral', CircleHelp);
}

export function deploymentStatusTone(status: string): DeploymentStatusTone {
    return parseDeploymentStatus(status).tone;
}

export function isDeploymentActive(status: string): boolean {
    const normalized = status.trim().toLowerCase();

    if (normalized.includes('finish') || normalized.includes('fail') || normalized.includes('cancel')) {
        return false;
    }

    return normalized.includes('progress')
        || normalized.includes('building')
        || normalized.includes('deploying')
        || normalized.includes('queue')
        || normalized.includes('rollback');
}

/** Queued or in-progress deployments can be cancelled (ApplicationDeploymentStatus). */
export function isDeploymentCancellable(status: string): boolean {
    const normalized = status.trim().toLowerCase();

    return normalized === 'queued' || normalized === 'in_progress';
}

function build(
    raw: string,
    label: string,
    shortLabel: string,
    tone: DeploymentStatusTone,
    Icon: LucideIcon,
    spin = false,
): ParsedDeploymentStatus {
    return { raw, label, shortLabel, tone, Icon, spin };
}

function capitalize(value: string): string {
    if (!value) {
        return 'Inconnu';
    }

    return value.charAt(0).toUpperCase() + value.slice(1);
}
