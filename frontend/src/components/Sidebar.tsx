import { Info, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, X } from 'lucide-preact';
import { useMemo } from 'preact/hooks';
import type { BootstrapData } from '../lib/bootstrap';
import { DEVFORGE_BRAND_NAME, DEVFORGE_LOGO_URL } from '../lib/brand';
import { AGENTS_CHAT_PATH } from '../lib/agent-routes';
import {
    plusSidebarSection,
    primarySidebarNav,
    resolveActiveNavId,
    visibleSidebarNav,
    type SidebarNavLink,
    type SidebarNavSection,
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
        ? 'flex min-h-9 items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-[13px] transition-colors'
        : 'flex h-10 min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors';

    if (active) {
        return `${base} bg-[var(--devforge-sidebar-active-bg)] font-semibold text-[var(--devforge-sidebar-active-fg)]`;
    }

    return `${base} text-[var(--devforge-sidebar-muted)] hover:bg-[var(--devforge-sidebar-hover)] hover:text-[var(--devforge-sidebar-fg)] ${nested ? 'font-normal' : ''}`;
}

function NavLink({
    item,
    active,
    collapsed,
    nested,
    onNavigate,
}: {
    item: SidebarNavLink;
    active: boolean;
    collapsed: boolean;
    nested?: boolean;
    onNavigate: (event: MouseEvent, path: string) => void;
}) {
    const Icon = item.icon;

    return (
        <a
            class={linkClass(active, nested)}
            href={routeHref(item.path)}
            title={collapsed ? item.label : undefined}
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
            onClick={(event) => onNavigate(event, item.path)}
        >
            <Icon class="size-3.5 sm:size-4 shrink-0" aria-hidden />
            {!collapsed && <span class="truncate">{item.label}</span>}
        </a>
    );
}

function PlusSection({
    section,
    activeId,
    collapsed,
    onNavigate,
}: {
    section: SidebarNavSection;
    activeId: string | null;
    collapsed: boolean;
    onNavigate: (event: MouseEvent, path: string) => void;
}) {
    const childActive = section.items.some((item) => item.id === activeId);

    if (collapsed) {
        return (
            <li>
                <ul class="flex flex-col gap-0.5 p-0">
                    {section.items.map((item) => (
                        <li key={item.id}>
                            <NavLink
                                item={item}
                                active={activeId === item.id}
                                collapsed
                                onNavigate={onNavigate}
                            />
                        </li>
                    ))}
                </ul>
            </li>
        );
    }

    return (
        <li>
            <details class="group" open={childActive || undefined}>
                <summary
                    class={`${linkClass(childActive)} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
                >
                    <MoreHorizontal class="size-3.5 sm:size-4 shrink-0" aria-hidden />
                    <span class="truncate">Plus</span>
                </summary>
                <ul class="mt-1 flex flex-col gap-0.5 p-0 ps-1">
                    {section.items.map((item) => (
                        <li key={item.id}>
                            <NavLink
                                item={item}
                                active={activeId === item.id}
                                collapsed={false}
                                nested
                                onNavigate={onNavigate}
                            />
                        </li>
                    ))}
                </ul>
            </details>
        </li>
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
    const instanceAdmin = bootstrap.permissions.instance_admin;
    const entries = useMemo(
        () => visibleSidebarNav(agentsEnabled, instanceAdmin),
        [agentsEnabled, instanceAdmin],
    );
    const primary = useMemo(() => primarySidebarNav(entries), [entries]);
    const plus = useMemo(() => plusSidebarSection(entries), [entries]);
    const activeId = useMemo(() => resolveActiveNavId(entries, route), [entries, route]);
    const panelClass = collapsed ? 'w-[4.5rem]' : 'w-60';
    const aboutActive = route.page === 'about' || route.path === '/a-propos';

    return (
        <aside
            class={`devforge-sidebar z-40 flex shrink-0 flex-col transition-[width,transform] ${panelClass} ${
                mobileOpen
                    ? 'fixed inset-y-0 start-0 translate-x-0'
                    : 'fixed inset-y-0 start-0 -translate-x-full lg:static lg:translate-x-0'
            }`}
            aria-label="Navigation principale"
        >
            <div class={`flex h-16 items-center ${collapsed ? 'justify-center px-2' : 'px-4'}`}>
                <a
                    class="flex min-w-0 items-center gap-3"
                    href={routeHref('/')}
                    aria-label={`Accueil ${DEVFORGE_BRAND_NAME}`}
                    onClick={(event) => onNavigate(event, '/')}
                >
                    <img
                        src={DEVFORGE_LOGO_URL}
                        alt=""
                        class="size-8 shrink-0 rounded-xl object-cover"
                        width={32}
                        height={32}
                        aria-hidden
                    />
                    {!collapsed && (
                        <span class="truncate text-[15px] font-semibold tracking-tight text-[var(--devforge-sidebar-fg)]">
                            {DEVFORGE_BRAND_NAME}
                        </span>
                    )}
                </a>
                <button
                    class="btn btn-ghost btn-sm ms-auto text-[var(--devforge-sidebar-fg)] lg:hidden"
                    type="button"
                    aria-label="Fermer le menu"
                    onClick={onCloseMobile}
                >
                    <X class="size-4" aria-hidden />
                </button>
            </div>

            {agentsEnabled && (
                <div class={`px-2.5 pb-2 ${collapsed ? 'flex justify-center' : ''}`}>
                    <a
                        class={`btn btn-primary ${collapsed ? 'btn-square' : 'w-full'} h-10 min-h-10`}
                        href={routeHref(AGENTS_CHAT_PATH)}
                        title="Nouveau chat"
                        aria-label="Nouveau chat"
                        onClick={(event) => onNavigate(event, AGENTS_CHAT_PATH)}
                    >
                        <Plus class="size-4" aria-hidden />
                        {!collapsed && <span>Nouveau chat</span>}
                    </a>
                </div>
            )}

            <nav class="custom-scrollbar flex-1 overflow-y-auto overscroll-contain px-2.5 pb-2">
                <ul class="flex flex-col gap-0.5 p-0">
                    {primary.map((item) => (
                        <li key={item.id}>
                            <NavLink
                                item={item}
                                active={activeId === item.id}
                                collapsed={collapsed}
                                onNavigate={onNavigate}
                            />
                        </li>
                    ))}
                    {plus && (
                        <PlusSection
                            section={plus}
                            activeId={activeId}
                            collapsed={collapsed}
                            onNavigate={onNavigate}
                        />
                    )}
                </ul>
            </nav>

            <div class="grid shrink-0 gap-1 border-t border-[var(--devforge-sidebar-border)] p-2.5 pb-safe lg:pb-2.5">
                <a
                    class={linkClass(aboutActive)}
                    href={routeHref('/a-propos')}
                    title="À propos"
                    aria-label="À propos"
                    aria-current={aboutActive ? 'page' : undefined}
                    onClick={(event) => onNavigate(event, '/a-propos')}
                >
                    <Info class="size-3.5 sm:size-4 shrink-0" aria-hidden />
                    {!collapsed && <span class="truncate">À propos</span>}
                </a>
                <button
                    class="hidden h-10 min-h-10 items-center gap-2 sm:gap-3 rounded-xl px-3 text-xs text-[var(--devforge-sidebar-muted)] hover:bg-[var(--devforge-sidebar-hover)] hover:text-[var(--devforge-sidebar-fg)] lg:flex"
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
