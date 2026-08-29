import { Search, X } from 'lucide-preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { applicationPath } from '../lib/routes';
import { agentDetailPath } from '../lib/agent-routes';
import { COMMAND_PALETTE_EVENT, commandPaletteNavigation, filterCommandItems, type CommandPaletteItem } from '../lib/command-palette';
import { domainApi } from '../lib/domain-api';
import { navigateTo } from '../lib/use-navigate';

export function CommandPalette() {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const [dynamicItems, setDynamicItems] = useState<CommandPaletteItem[]>([]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                setOpen((current) => !current);
            }
        };

        const onOpen = () => setOpen(true);

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener(COMMAND_PALETTE_EVENT, onOpen);

        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener(COMMAND_PALETTE_EVENT, onOpen);
        };
    }, []);

    useEffect(() => {
        if (!open) {
            setQuery('');
            setActiveIndex(0);
            return;
        }

        let cancelled = false;

        void (async () => {
            try {
                const response = await domainApi.overview();
                const overview = response.data;
                const apps = (overview?.resource_statuses.applications ?? []).map((application) => ({
                    id: `app:${application.uuid}`,
                    label: application.name,
                    hint: 'Application',
                    path: applicationPath(application.uuid),
                    keywords: [application.name, 'app', 'application'],
                    group: 'applications' as const,
                }));
                const sessions = (overview?.agent_activity ?? []).flatMap((activity) => {
                    if (!activity.agent?.uuid) {
                        return [];
                    }

                    return [{
                        id: `session:${activity.uuid}`,
                        label: activity.agent.name,
                        hint: activity.summary || 'Session récente',
                        path: agentDetailPath(activity.agent.uuid),
                        keywords: [activity.agent.name, activity.summary ?? '', 'session', 'agent'],
                        group: 'sessions' as const,
                    }];
                });

                if (!cancelled) {
                    setDynamicItems([...apps, ...sessions]);
                }
            } catch {
                if (!cancelled) {
                    setDynamicItems([]);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [open]);

    const items = useMemo(
        () => filterCommandItems([...commandPaletteNavigation, ...dynamicItems], query),
        [dynamicItems, query],
    );

    useEffect(() => {
        setActiveIndex(0);
    }, [query, items.length]);

    const close = () => setOpen(false);

    const go = (item: CommandPaletteItem) => {
        close();
        navigateTo(item.path);
    };

    if (!open) {
        return null;
    }

    return (
        <div class="devforge-command-palette fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]">
            <button
                class="absolute inset-0 bg-neutral/40 backdrop-blur-[2px]"
                type="button"
                aria-label="Fermer la palette de commandes"
                onClick={close}
            />
            <div
                class="relative z-10 flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-base-100 shadow-2xl"
                role="dialog"
                aria-modal="true"
                aria-label="Palette de commandes"
            >
                <div class="flex items-center gap-2 border-b border-[#E5E7EB] px-4 py-3">
                    <Search class="size-4 text-base-content/40" aria-hidden />
                    <input
                        class="min-w-0 flex-1 bg-transparent text-sm outline-none"
                        type="search"
                        autoFocus
                        placeholder="Rechercher une app, une commande…"
                        value={query}
                        aria-label="Rechercher une commande"
                        onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                                event.preventDefault();
                                close();
                            }

                            if (event.key === 'ArrowDown') {
                                event.preventDefault();
                                setActiveIndex((current) => Math.min(current + 1, Math.max(items.length - 1, 0)));
                            }

                            if (event.key === 'ArrowUp') {
                                event.preventDefault();
                                setActiveIndex((current) => Math.max(current - 1, 0));
                            }

                            if (event.key === 'Enter' && items[activeIndex]) {
                                event.preventDefault();
                                go(items[activeIndex]!);
                            }
                        }}
                    />
                    <kbd class="hidden rounded-md border border-[#E5E7EB] px-1.5 py-0.5 text-[10px] text-base-content/45 sm:inline">
                        Échap
                    </kbd>
                    <button class="btn btn-ghost btn-xs btn-square" type="button" aria-label="Fermer" onClick={close}>
                        <X class="size-3.5" aria-hidden />
                    </button>
                </div>
                <ul class="custom-scrollbar max-h-80 overflow-y-auto p-2">
                    {items.length === 0 && (
                        <li class="px-3 py-6 text-center text-sm text-base-content/50">Aucun résultat.</li>
                    )}
                    {items.map((item, index) => (
                        <li key={item.id}>
                            <button
                                class={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                                    index === activeIndex
                                        ? 'bg-primary/10 text-primary'
                                        : 'hover:bg-base-200'
                                }`}
                                type="button"
                                onMouseEnter={() => setActiveIndex(index)}
                                onClick={() => go(item)}
                            >
                                <span class="min-w-0 truncate font-medium">{item.label}</span>
                                {item.hint && (
                                    <span class="shrink-0 truncate text-xs text-base-content/45">{item.hint}</span>
                                )}
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
