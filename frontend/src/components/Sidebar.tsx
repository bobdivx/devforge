import { Info, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, X } from 'lucide-preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { BootstrapData } from '../lib/bootstrap';
import { DEVFORGE_BRAND_NAME, DEVFORGE_LOGO_URL } from '../lib/brand';
import {
    buildSidebarSessions,
    groupSessionsByApplication,
    hasRunningSidebarSession,
    newChatHref,
    sessionHref,
    formatRelativeSessionTime,
    type SidebarAgentSession,
} from '../lib/agent-sessions';
import { pandaAppDotClass } from '../lib/pandaos-app-state';
import { domainApi } from '../lib/domain-api';
import {
    plusSidebarSection,
    primarySidebarNav,
    resolveActiveNavId,
    visibleSidebarNav,
    type SidebarNavLink,
    type SidebarNavSection,
} from '../lib/routing/sidebar-nav';
import { extractApplicationUuid, routeHref, type AppRoute } from '../lib/routes';

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
    activityDot,
    onNavigate,
}: {
    item: SidebarNavLink;
    active: boolean;
    collapsed: boolean;
    nested?: boolean;
    activityDot?: boolean;
    onNavigate: (event: MouseEvent, path: string) => void;
}) {
    const Icon = item.icon;

    return (
        <a
            class={`${linkClass(active, nested)} relative`}
            href={routeHref(item.path)}
            title={collapsed ? item.label : undefined}
            aria-label={item.label}
            aria-current={active ? 'page' : undefined}
            onClick={(event) => onNavigate(event, item.path)}
        >
            <span class="relative shrink-0">
                <Icon class="size-3.5 sm:size-4" aria-hidden />
                {activityDot && (
                    <span
                        class="absolute -end-0.5 -top-0.5 size-1.5 rounded-full bg-success"
                        aria-hidden
                    />
                )}
            </span>
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

function SessionRow({
    session,
    active,
    onNavigate,
}: {
    session: SidebarAgentSession;
    active: boolean;
    onNavigate: (event: MouseEvent, path: string) => void;
}) {
    const href = sessionHref(session);

    return (
        <a
            class={`flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5 text-[12px] transition-colors ${
                active
                    ? 'bg-[var(--devforge-sidebar-active-bg)] text-[var(--devforge-sidebar-active-fg)]'
                    : 'text-[var(--devforge-sidebar-muted)] hover:bg-[var(--devforge-sidebar-hover)] hover:text-[var(--devforge-sidebar-fg)]'
            }`}
            href={routeHref(href)}
            title={session.title}
            onClick={(event) => onNavigate(event, href)}
        >
            <span
                class={`mt-1.5 size-1.5 shrink-0 rounded-full ${pandaAppDotClass(session.status)}`}
                aria-hidden
            />
            <span class="min-w-0 flex-1">
                <span class="block truncate font-medium">{session.title}</span>
                <span class="block truncate text-[10px] opacity-70">
                    {formatRelativeSessionTime(session.lastActivityAt)}
                </span>
            </span>
        </a>
    );
}

function SessionsNavigator({
    sessions,
    activeSessionUuid,
    onNavigate,
}: {
    sessions: SidebarAgentSession[];
    activeSessionUuid: string | null;
    onNavigate: (event: MouseEvent, path: string) => void;
}) {
    const grouped = useMemo(() => groupSessionsByApplication(sessions), [sessions]);

    if (grouped.length === 0) {
        return (
            <p class="px-2 py-2 text-[11px] text-[var(--devforge-sidebar-muted)]">
                Aucune conversation
            </p>
        );
    }

    return (
        <div class="flex flex-col gap-3 px-0.5 pb-2">
            {grouped.map((group) => (
                <section key={group.applicationUuid ?? group.applicationName} class="min-w-0">
                    <h3 class="truncate px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--devforge-sidebar-muted)]">
                        {group.applicationName}
                    </h3>
                    {group.buckets.map((bucket) => (
                        <div key={bucket.id} class="min-w-0">
                            <p class="px-2 pt-1 text-[10px] font-medium text-[var(--devforge-sidebar-muted)]">
                                {bucket.label}
                            </p>
                            <ul class="flex flex-col p-0">
                                {bucket.sessions.map((session) => (
                                    <li key={session.uuid}>
                                        <SessionRow
                                            session={session}
                                            active={activeSessionUuid === session.uuid}
                                            onNavigate={onNavigate}
                                        />
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </section>
            ))}
        </div>
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
    const applicationUuid = route.page === 'application-detail' ? extractApplicationUuid(route.path) : null;
    const newChatPath = newChatHref(applicationUuid);
    const [sessions, setSessions] = useState<SidebarAgentSession[]>([]);
    const activeSessionUuid = typeof window === 'undefined'
        ? null
        : new URLSearchParams(window.location.search).get('session');
    const assistantBusy = hasRunningSidebarSession(sessions);

    useEffect(() => {
        if (!agentsEnabled) {
            setSessions([]);
            return;
        }

        let cancelled = false;

        const load = async () => {
            try {
                const [agentsResponse, applicationsResponse] = await Promise.all([
                    domainApi.agents(),
                    domainApi.coreResources('applications').catch(() => ({ data: [] as Array<{ uuid: string; name: string }> })),
                ]);

                if (cancelled) {
                    return;
                }

                const sessionsByAgent: Record<string, Awaited<ReturnType<typeof domainApi.agentSessions>>['data']> = {};
                await Promise.all(agentsResponse.data.map(async (agent) => {
                    try {
                        const response = await domainApi.agentSessions(agent.uuid);
                        sessionsByAgent[agent.uuid] = response.data;
                    } catch {
                        sessionsByAgent[agent.uuid] = [];
                    }
                }));

                if (cancelled) {
                    return;
                }

                setSessions(buildSidebarSessions(
                    agentsResponse.data,
                    sessionsByAgent,
                    applicationsResponse.data.map((application) => ({
                        uuid: application.uuid,
                        name: application.name,
                    })),
                ));
            } catch {
                if (!cancelled) {
                    setSessions([]);
                }
            }
        };

        void load();

        return () => {
            cancelled = true;
        };
    }, [agentsEnabled, bootstrap.current_team.id]);

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
                        href={routeHref(newChatPath)}
                        title="Nouveau chat"
                        aria-label="Nouveau chat"
                        onClick={(event) => onNavigate(event, newChatPath)}
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
                                activityDot={item.id === 'assistant' && assistantBusy}
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
                {agentsEnabled && !collapsed && (
                    <div class="mt-3 border-t border-[var(--devforge-sidebar-border)] pt-3">
                        <SessionsNavigator
                            sessions={sessions}
                            activeSessionUuid={activeSessionUuid}
                            onNavigate={onNavigate}
                        />
                    </div>
                )}
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
