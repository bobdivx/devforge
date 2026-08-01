import { ChevronDown, PanelLeftClose, PanelLeftOpen, X } from 'lucide-preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { BootstrapData } from '../lib/bootstrap';
import { DEVFORGE_BRAND_NAME, DEVFORGE_LOGO_URL } from '../lib/brand';
import {
    flattenSidebarNav,
    isNavGroupActive,
    isNavPageActive,
    visibleSidebarNav,
    type SidebarNavEntry,
    type SidebarNavGroup,
} from '../lib/routing/sidebar-nav';
import { routeHref, type AppRoute } from '../lib/routes';

type SidebarProps = {
    route: AppRoute;
    bootstrap: BootstrapData;
    collapsed: boolean;
    mobileOpen: boolean;
    onNavigate: (event: MouseEvent, path: string) => void;
    onCloseMobile: () => void;
    onToggleCollapsed: () => void;
};

function linkClass(active: boolean, nested = false): string {
    const base = nested
        ? 'flex min-h-9 items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors'
        : 'flex h-10 min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors';

    if (active) {
        return `${base} bg-primary/10 font-semibold text-primary shadow-sm ring-1 ring-primary/15`;
    }

    return `${base} text-base-content/55 hover:bg-base-200/80 hover:text-base-content ${nested ? 'font-normal' : ''}`;
}

function NavGroup({
    group,
    route,
    open,
    onToggle,
    onNavigate,
}: {
    group: SidebarNavGroup;
    route: AppRoute;
    open: boolean;
    onToggle: () => void;
    onNavigate: (event: MouseEvent, path: string) => void;
}) {
    const groupActive = isNavGroupActive(group, route.page);
    const Icon = group.icon;

    return (
        <li>
            <button
                type="button"
                class={`flex h-10 min-h-10 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${
                    groupActive && !open
                        ? 'bg-primary/10 text-primary'
                        : 'text-base-content/70 hover:bg-base-200/80 hover:text-base-content'
                }`}
                aria-expanded={open}
                aria-controls={`sidebar-group-${group.id}`}
                onClick={onToggle}
            >
                <Icon class="size-4 shrink-0" aria-hidden />
                <span class="min-w-0 flex-1 truncate text-start">{group.label}</span>
                <ChevronDown
                    class={`size-3.5 shrink-0 text-base-content/40 transition-transform ${open ? 'rotate-0' : '-rotate-90'}`}
                    aria-hidden
                />
            </button>
            {open && (
                <ul id={`sidebar-group-${group.id}`} class="mt-0.5 mb-1 ms-3 grid gap-0.5 border-s border-base-300/80 ps-2">
                    {group.items.map((item) => {
                        const active = isNavPageActive(item.pages, route.page);

                        return (
                            <li key={item.id}>
                                <a
                                    class={linkClass(active, true)}
                                    href={routeHref(item.path)}
                                    aria-current={active ? 'page' : undefined}
                                    onClick={(event) => onNavigate(event, item.path)}
                                >
                                    <span class="truncate">{item.label}</span>
                                </a>
                            </li>
                        );
                    })}
                </ul>
            )}
        </li>
    );
}

function NavEntries({
    entries,
    route,
    openGroups,
    onToggleGroup,
    onNavigate,
}: {
    entries: SidebarNavEntry[];
    route: AppRoute;
    openGroups: Record<string, boolean>;
    onToggleGroup: (id: string) => void;
    onNavigate: (event: MouseEvent, path: string) => void;
}) {
    return (
        <ul class="flex flex-col gap-1 p-0">
            {entries.map((entry) => {
                if (entry.type === 'group') {
                    return (
                        <NavGroup
                            key={entry.id}
                            group={entry}
                            route={route}
                            open={openGroups[entry.id] ?? false}
                            onToggle={() => onToggleGroup(entry.id)}
                            onNavigate={onNavigate}
                        />
                    );
                }

                const active = isNavPageActive(entry.pages, route.page);
                const Icon = entry.icon;

                return (
                    <li key={entry.id}>
                        <a
                            class={linkClass(active)}
                            href={routeHref(entry.path)}
                            aria-current={active ? 'page' : undefined}
                            onClick={(event) => onNavigate(event, entry.path)}
                        >
                            <Icon class="size-4 shrink-0" aria-hidden />
                            <span class="truncate">{entry.label}</span>
                        </a>
                    </li>
                );
            })}
        </ul>
    );
}

export function Sidebar({
    route,
    bootstrap,
    collapsed,
    mobileOpen,
    onNavigate,
    onCloseMobile,
    onToggleCollapsed,
}: SidebarProps) {
    const agentsEnabled = bootstrap.features?.agents_enabled ?? false;
    const entries = useMemo(() => visibleSidebarNav(agentsEnabled), [agentsEnabled]);
    const panelClass = collapsed ? 'w-16' : 'w-64';

    const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
        applications: true,
        agents: true,
    });

    useEffect(() => {
        setOpenGroups((current) => {
            let changed = false;
            const next = { ...current };

            for (const entry of entries) {
                if (entry.type !== 'group') {
                    continue;
                }

                if (isNavGroupActive(entry, route.page) && !next[entry.id]) {
                    next[entry.id] = true;
                    changed = true;
                }
            }

            return changed ? next : current;
        });
    }, [route.page, entries]);

    const toggleGroup = (id: string) => {
        setOpenGroups((current) => ({
            ...current,
            [id]: !current[id],
        }));
    };

    const collapsedLinks = useMemo(() => flattenSidebarNav(entries), [entries]);

    return (
        <aside
            class={`devforge-sidebar z-40 flex shrink-0 flex-col bg-base-100 shadow-sm transition-[width,transform] ${panelClass} ${
                mobileOpen
                    ? 'fixed inset-y-3 start-3 rounded-3xl translate-x-0'
                    : 'fixed inset-y-3 start-3 -translate-x-[calc(100%+1rem)] rounded-3xl lg:static lg:translate-x-0'
            }`}
            aria-label="Navigation principale"
        >
            <div class="flex h-14 items-center px-4">
                <a
                    class="flex min-w-0 items-center gap-3"
                    href={routeHref('/')}
                    aria-label={`Accueil ${DEVFORGE_BRAND_NAME}`}
                    onClick={(event) => onNavigate(event, '/')}
                >
                    <img
                        src={DEVFORGE_LOGO_URL}
                        alt=""
                        class="size-9 shrink-0 rounded-full object-cover shadow-sm"
                        width={36}
                        height={36}
                        aria-hidden
                    />
                    {!collapsed && <span class="truncate text-base font-bold tracking-tight">{DEVFORGE_BRAND_NAME}</span>}
                </a>
                <button class="btn btn-ghost btn-sm ms-auto lg:hidden" type="button" aria-label="Fermer le menu" onClick={onCloseMobile}>
                    <X class="size-4" aria-hidden />
                </button>
            </div>

            <nav class="custom-scrollbar flex-1 overflow-y-auto px-3 pb-2">
                {!collapsed && (
                    <p class="mb-3 px-2 text-[10px] font-semibold uppercase tracking-widest text-base-content/40">
                        Menu
                    </p>
                )}

                {collapsed ? (
                    <ul class="flex flex-col gap-1 p-0">
                        {collapsedLinks.map((item) => {
                            const active = isNavPageActive(item.pages, route.page);
                            const Icon = item.icon;

                            return (
                                <li key={item.id}>
                                    <a
                                        class={linkClass(active)}
                                        href={routeHref(item.path)}
                                        title={item.label}
                                        aria-label={item.label}
                                        aria-current={active ? 'page' : undefined}
                                        onClick={(event) => onNavigate(event, item.path)}
                                    >
                                        <Icon class="size-4 shrink-0" aria-hidden />
                                    </a>
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <NavEntries
                        entries={entries}
                        route={route}
                        openGroups={openGroups}
                        onToggleGroup={toggleGroup}
                        onNavigate={onNavigate}
                    />
                )}
            </nav>

            <div class="grid gap-1 border-t border-base-300/70 p-3">
                {!collapsed && (
                    <p class="px-2 pb-1 text-[10px] leading-relaxed text-base-content/40">
                        {DEVFORGE_BRAND_NAME}
                    </p>
                )}
                <button
                    class="btn btn-ghost btn-sm hidden justify-start rounded-xl px-3 text-xs lg:flex"
                    type="button"
                    aria-label={collapsed ? 'Déployer la barre latérale' : 'Réduire la barre latérale'}
                    onClick={onToggleCollapsed}
                >
                    {collapsed
                        ? <PanelLeftOpen class="size-4" aria-hidden />
                        : <PanelLeftClose class="size-4" aria-hidden />}
                    {!collapsed && <span>Réduire</span>}
                </button>
            </div>
        </aside>
    );
}
