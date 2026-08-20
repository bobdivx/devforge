export function dayGreeting(name: string, date = new Date()): string {
    const firstName = name.trim().split(/\s+/)[0] || 'là';
    const hours = date.getHours();

    if (hours < 12) {
        return `Bonjour, ${firstName}`;
    }

    if (hours < 18) {
        return `Bon après-midi, ${firstName}`;
    }

    return `Bonsoir, ${firstName}`;
}

export function formatDashboardDate(date = new Date()): string {
    return new Intl.DateTimeFormat('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
    }).format(date);
}
