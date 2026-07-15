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

export function diskUsageLabel(usage: number | null): string {
    if (usage === null) {
        return 'Non mesuré';
    }

    return `${usage} % utilisés`;
}
