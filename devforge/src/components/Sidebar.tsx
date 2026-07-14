import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-preact';
import type { BootstrapData } from '../lib/bootstrap';
import { DEVFORGE_BRAND_NAME, DEVFORGE_LOGO_URL } from '../lib/brand';
import { legacyCoolifyUrl } from '../lib/migration';
import { routeHref, visibleRoutes, type AppRoute } from '../lib/routes';

type SidebarProps = {
    route: AppRoute;
    bootstrap: BootstrapData;
    collapsed: boolean;
    mobileOpen: boolean;
    onNavigate: (event: MouseEvent, path: string) => void;
    onCloseMobile: () => void;
    onToggleCollapsed: () => void;
};

export function Sidebar({
    route,
    bootstrap,
    collapsed,
    mobileOpen,
    onNavigate,
    onCloseMobile,
    onToggleCollapsed,
}: SidebarProps) {
    const navigationRoutes = visibleRoutes(bootstrap.features?.agents_enabled ?? false);
    const coolifyLegacyUrl = legacyCoolifyUrl(bootstrap.migration.legacy_base_url);

    const panelClass = collapsed ? 'w-16' : 'w-64';

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
                <p class={`mb-3 px-2 text-[10px] font-semibold uppercase tracking-widest text-base-content/40 ${collapsed ? 'sr-only' : ''}`}>
                    Plateforme
                </p>
                <ul class="flex flex-col gap-1 p-0">
                    {navigationRoutes.map(({ path, label, icon: Icon, page }) => {
                        const active = route.page === page;

                        return (
                            <li key={path}>
                                <a
                                    class={`flex h-10 min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${
                                        active
                                            ? 'bg-primary/10 font-semibold text-primary shadow-sm ring-1 ring-primary/15'
                                            : 'text-base-content/55 hover:bg-base-200/80 hover:text-base-content'
                                    }`}
                                    href={routeHref(path)}
                                    title={collapsed ? label : undefined}
                                    aria-label={collapsed ? label : undefined}
                                    aria-current={active ? 'page' : undefined}
                                    onClick={(event) => onNavigate(event, path)}
                                >
                                    <Icon class="size-4 shrink-0" aria-hidden />
                                    {!collapsed && <span class="truncate">{label}</span>}
                                </a>
                            </li>
                        );
                    })}
                </ul>
            </nav>

            <div class="grid gap-1 border-t border-base-300/70 p-3">
                {!collapsed && (
                    <p class="px-2 pb-1 text-[10px] leading-relaxed text-base-content/40">
                        Interface DevForge · Basé sur{' '}
                        <a
                            class="link link-hover font-medium text-base-content/55"
                            href={coolifyLegacyUrl}
                            title="Ouvrir l'interface Coolify d'origine"
                        >
                            Coolify
                        </a>
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
