export function escapeChatHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

export function renderChatHtml(content: string): string {
    const escaped = escapeChatHtml(content);

    return escaped
        .replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\b(healthy|ok)\b/gi, '<span class="chat-status-ok">$1</span>')
        .replace(/\b(502|404|500|down)\b/g, '<span class="chat-status-bad">$1</span>')
        .replace(/(https?:\/\/[^\s<]+)/g, '<a class="chat-link" href="$1" target="_blank" rel="noreferrer">$1</a>')
        .replace(/\n/g, '<br />');
}

export function chatDayStamp(iso: string, now = new Date()): string {
    const date = new Date(iso);
    const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (date.toDateString() === now.toDateString()) {
        return `Aujourd’hui ${time}`;
    }

    return `${date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} ${time}`;
}

export function isNewChatDay(previousIso: string | null, currentIso: string): boolean {
    if (!previousIso) {
        return true;
    }

    return new Date(previousIso).toDateString() !== new Date(currentIso).toDateString();
}

export function firstNameFrom(fullName: string | null | undefined): string {
    const trimmed = (fullName ?? '').trim();
    if (trimmed === '') {
        return '';
    }

    return trimmed.split(/\s+/)[0] ?? trimmed;
}
