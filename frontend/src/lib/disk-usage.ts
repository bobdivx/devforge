export function diskUsageTone(
    usage: number | null,
    cleanupThreshold: number,
    alertThreshold: number,
): 'success' | 'warning' | 'error' | 'neutral' {
    if (usage === null) {
        return 'neutral';
    }

    if (usage >= alertThreshold) {
        return 'error';
    }

    if (usage >= cleanupThreshold) {
        return 'warning';
    }

    return 'success';
}

export function diskUsageLabel(usage: number | null, partition?: string | null): string {
    if (usage === null) {
        return 'Non mesuré';
    }

    if (partition) {
        return `${usage} % — ${partition}`;
    }

    return `${usage} % utilisés`;
}

export function workloadDiskLabel(partitions: Record<string, number> | null | undefined): string | null {
    if (partitions?.['/media/Docker'] !== undefined) {
        return '/media/Docker';
    }

    return partitions?.['/'] !== undefined ? 'racine /' : null;
}
