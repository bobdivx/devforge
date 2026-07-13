import type { LucideIcon } from 'lucide-preact';
import {
    Activity,
    CircleAlert,
    CircleCheck,
    CircleHelp,
    CirclePause,
    CircleX,
    Loader2,
    Play,
    Square,
} from 'lucide-preact';
import type { CoreResource } from './domain-api';

export type ResourceStatusTone = 'success' | 'warning' | 'error' | 'neutral';

export type ParsedResourceStatus = {
    raw: string;
    label: string;
    shortLabel: string;
    tone: ResourceStatusTone;
    Icon: LucideIcon;
    spin?: boolean;
};

export function resourceStatusInput(resource: CoreResource): string | {
    reachable: boolean;
    usable: boolean;
    validating: boolean;
} {
    return resource.status;
}

export function parseResourceStatus(status: string | {
    reachable: boolean;
    usable: boolean;
    validating: boolean;
}): ParsedResourceStatus {
    if (typeof status !== 'string') {
        if (status.validating) {
            return buildStatus('validating', 'Validation en cours', 'Validation', 'warning', Loader2, true);
        }
        if (status.reachable && status.usable) {
            return buildStatus('running:healthy', 'En ligne', 'En ligne', 'success', CircleCheck);
        }

        return buildStatus('unavailable', 'Indisponible', 'Hors ligne', 'error', CircleX);
    }

    const normalized = status.trim().toLowerCase();
    if (!normalized) {
        return buildStatus('unknown', 'État inconnu', 'Inconnu', 'neutral', CircleHelp);
    }

    const [primary, health] = normalized.split(':');

    if (primary === 'running') {
        if (health === 'healthy') {
            return buildStatus(status, 'En ligne et sain', 'Sain', 'success', CircleCheck);
        }
        if (health === 'unhealthy') {
            return buildStatus(status, 'En ligne mais dégradé', 'Dégradé', 'warning', CircleAlert);
        }
        if (health === 'unknown') {
            return buildStatus(status, 'En cours de fonctionnement', 'En cours', 'warning', Activity);
        }

        return buildStatus(status, 'En cours de fonctionnement', 'En cours', 'success', Play);
    }

    if (primary === 'starting' || primary === 'created') {
        return buildStatus(status, 'Démarrage en cours', 'Démarrage', 'warning', Loader2, true);
    }

    if (primary === 'paused') {
        return buildStatus(status, 'Service en pause', 'En pause', 'warning', CirclePause);
    }

    if (primary === 'exited' || primary === 'stopped' || primary === 'dead') {
        return buildStatus(status, 'Service arrêté', 'Arrêté', 'error', Square);
    }

    if (primary.includes('fail') || primary === 'unavailable' || primary === 'error') {
        return buildStatus(status, 'Service indisponible', 'Erreur', 'error', CircleX);
    }

    if (primary.includes('valid') || primary.includes('progress')) {
        return buildStatus(status, 'Validation en cours', 'Validation', 'warning', Loader2, true);
    }

    return buildStatus(status, formatStatusLabel(status), formatStatusLabel(status), 'neutral', CircleHelp);
}

export function resourceStatusTone(status: string): ResourceStatusTone {
    return parseResourceStatus(status).tone;
}

function buildStatus(
    raw: string,
    label: string,
    shortLabel: string,
    tone: ResourceStatusTone,
    Icon: LucideIcon,
    spin = false,
): ParsedResourceStatus {
    return { raw, label, shortLabel, tone, Icon, spin };
}

function formatStatusLabel(status: string): string {
    const [primary, health] = status.split(':');

    if (health) {
        return `${capitalize(primary)} (${health})`;
    }

    return capitalize(primary);
}

function capitalize(value: string): string {
    if (!value) {
        return 'Inconnu';
    }

    return value.charAt(0).toUpperCase() + value.slice(1);
}
