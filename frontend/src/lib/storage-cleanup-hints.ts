export function cleanupFreedNoSpace(message: string | null | undefined): boolean {
    if (!message) {
        return false;
    }

    const normalized = message.toLowerCase();

    if (normalized.includes('no cleanup needed')) {
        return true;
    }

    const beforeMatch = message.match(/disk usage before:\s*(\d+)%/i);
    const afterMatch = message.match(/disk usage after:\s*(\d+)%/i);

    if (beforeMatch && afterMatch) {
        return Number(afterMatch[1]) >= Number(beforeMatch[1]);
    }

    return normalized.includes('no disk space was saved');
}

export function criticalDiskHints(diskUsage: number | null): string[] {
    if (diskUsage === null || diskUsage < 90) {
        return [];
    }

    return [
        'Utilisez le bouton « Diagnostiquer l’espace » pour voir ce qui occupe le disque (Docker, données d’instance, logs…).',
        'Utilisez le bouton « Nettoyage agressif » : volumes inutilisés + suppression des anciennes images d’applications.',
        'Supprimez les déploiements en échec, previews et applications inutilisées.',
        'Vérifiez /data/devforge/backups et /var/log si le diagnostic montre peu d’espace récupérable dans Docker.',
    ];
}
