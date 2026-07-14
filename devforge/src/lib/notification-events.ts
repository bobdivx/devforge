const EVENT_LABELS: Record<string, string> = {
    deployment_success: 'Déploiement réussi',
    deployment_failure: 'Échec de déploiement',
    status_change: 'Changement de statut',
    backup_success: 'Sauvegarde réussie',
    backup_failure: 'Échec de sauvegarde',
    scheduled_task_success: 'Tâche planifiée réussie',
    scheduled_task_failure: 'Échec de tâche planifiée',
    docker_cleanup_success: 'Nettoyage Docker réussi',
    docker_cleanup_failure: 'Échec de nettoyage Docker',
    server_disk_usage: 'Utilisation disque serveur',
    server_reachable: 'Serveur joignable',
    server_unreachable: 'Serveur injoignable',
    server_patch: 'Correctifs serveur',
    traefik_outdated: 'Traefik obsolète',
};

const EVENT_KEY_PATTERN = /_(?:email|discord|slack|telegram|pushover|webhook)_notifications$/;

export function notificationEventLabel(eventKey: string): string {
    const base = eventKey.replace(EVENT_KEY_PATTERN, '');

    return EVENT_LABELS[base] ?? base.replaceAll('_', ' ');
}

export function sortedNotificationEventKeys(events: Record<string, boolean>): string[] {
    return Object.keys(events).sort((left, right) => notificationEventLabel(left).localeCompare(notificationEventLabel(right), 'fr'));
}
