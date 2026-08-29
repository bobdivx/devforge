export const COMMAND_PALETTE_EVENT = 'devforge-open-command-palette';

export function openCommandPalette(): void {
    window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_EVENT));
}

export type CommandPaletteItem = {
    id: string;
    label: string;
    hint?: string;
    path: string;
    keywords?: string[];
    group: 'navigation' | 'applications' | 'sessions';
};

export const commandPaletteNavigation: CommandPaletteItem[] = [
    { id: 'home', label: 'Accueil', hint: 'Tableau de bord', path: '/', keywords: ['home', 'dashboard', 'accueil'], group: 'navigation' },
    { id: 'apps', label: 'Applications', hint: 'Apps', path: '/applications', keywords: ['apps', 'applications'], group: 'navigation' },
    { id: 'assistant', label: 'Assistant', hint: 'Chat agent', path: '/agents/chat', keywords: ['assistant', 'chat', 'agent'], group: 'navigation' },
    { id: 'new-chat', label: 'Nouveau chat', hint: 'Démarrer une conversation', path: '/agents/chat', keywords: ['nouveau', 'chat', 'new'], group: 'navigation' },
    { id: 'connexions', label: 'Connexions', path: '/connexions', keywords: ['github', 'mcp', 'clés'], group: 'navigation' },
    { id: 'settings', label: 'Réglages', path: '/settings', keywords: ['paramètres', 'settings', 'réglages'], group: 'navigation' },
    { id: 'deployments', label: 'Déploiements', path: '/deployments', keywords: ['pipeline', 'deploys'], group: 'navigation' },
    { id: 'databases', label: 'Bases de données', path: '/databases', keywords: ['sql', 'turso', 'postgres'], group: 'navigation' },
    { id: 'store', label: 'Store', path: '/store', keywords: ['catalogue'], group: 'navigation' },
    { id: 'docker', label: 'Docker', path: '/docker', keywords: ['conteneurs'], group: 'navigation' },
    { id: 'monitoring', label: 'Supervision', path: '/monitoring', keywords: ['santé', 'métriques'], group: 'navigation' },
    { id: 'storage', label: 'Stockage', path: '/storage', keywords: ['disque'], group: 'navigation' },
    { id: 'servers', label: 'Serveurs', path: '/settings/servers', keywords: ['infra'], group: 'navigation' },
    { id: 'about', label: 'À propos', path: '/a-propos', keywords: ['credits', 'about'], group: 'navigation' },
];

export function filterCommandItems(items: CommandPaletteItem[], query: string): CommandPaletteItem[] {
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
        return items;
    }

    return items.filter((item) => {
        const haystack = [item.label, item.hint ?? '', item.path, ...(item.keywords ?? [])]
            .join(' ')
            .toLowerCase();

        return haystack.includes(normalized);
    });
}
