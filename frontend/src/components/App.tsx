import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { getBootstrap, switchTeam } from '../lib/api-client';
import type { BootstrapData } from '../lib/bootstrap';
import { findRoute, normalizeRoutePath, resolveResourceCanonicalLocation, routeHref } from '../lib/routes';
import {
    applyStoredAppearance,
    contentWidthClass,
    getAppearancePreferences,
    toggleResolvedTheme,
    type AppearancePreferences,
    type Theme,
} from '../lib/appearance';
import { TeamContext } from '../lib/team-context';
import { DomainPage } from '../pages/_router';
import { AuthGuard } from './AuthGuard';
import { Sidebar } from './Sidebar';
import { ToastRegion, type Toast } from './ToastRegion';
import { Topbar } from './Topbar';

type AppProps = {
    initialPath: string;
};

export function App({ initialPath }: AppProps) {
    const [pathname, setPathname] = useState(() => normalizeRoutePath(initialPath));
    const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<unknown>(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [theme, setTheme] = useState<Theme>('dark');
    const [appearance, setAppearance] = useState<AppearancePreferences>(() => getAppearancePreferences());
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [teamRevision, setTeamRevision] = useState(0);
    const route = useMemo(() => findRoute(pathname), [pathname]);

    const loadBootstrap = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const response = await getBootstrap();
            setBootstrap(response.data);
        } catch (bootstrapError) {
            setBootstrap(null);
            setError(bootstrapError);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const resolvedTheme = applyStoredAppearance();
        setTheme(resolvedTheme);
        setAppearance(getAppearancePreferences());

        const syncPathname = () => {
            const current = normalizeRoutePath(window.location.pathname);
            const canonical = resolveResourceCanonicalLocation(current);

            if (canonical) {
                window.history.replaceState({}, '', routeHref(canonical));
                setPathname(normalizeRoutePath(canonical));
                return;
            }

            setPathname(current);
        };

        syncPathname();
        void loadBootstrap();

        const onPopState = () => syncPathname();
        window.addEventListener('popstate', onPopState);
        const onAppearanceChange = () => setAppearance(getAppearancePreferences());
        window.addEventListener('devforge-appearance-changed', onAppearanceChange);

        return () => {
            window.removeEventListener('popstate', onPopState);
            window.removeEventListener('devforge-appearance-changed', onAppearanceChange);
        };
    }, [loadBootstrap]);

    useEffect(() => {
        document.title = `${route.label} · DevForge`;
    }, [route]);

    const navigate = (event: MouseEvent, targetPath: string) => {
        if (
            event.defaultPrevented
            || event.button !== 0
            || event.metaKey
            || event.ctrlKey
            || event.shiftKey
            || event.altKey
        ) {
            return;
        }

        event.preventDefault();
        window.history.pushState({}, '', routeHref(targetPath));
        setPathname(normalizeRoutePath(targetPath));
        setSidebarOpen(false);
        document.querySelector<HTMLElement>('#devforge-content')?.focus();
    };

    const toggleTheme = () => {
        setTheme((current) => {
            const nextTheme = toggleResolvedTheme(current);
            setAppearance(getAppearancePreferences());
            return nextTheme;
        });
    };

    const addToast = (message: string, tone: Toast['tone'] = 'info') => {
        const id = Date.now();
        setToasts((current) => [...current, { id, message, tone }]);
        window.setTimeout(() => {
            setToasts((current) => current.filter((toast) => toast.id !== id));
        }, 5000);
    };

    const handleSwitchTeam = async (teamId: number) => {
        try {
            const response = await switchTeam(teamId);
            setBootstrap(response.data);
            setTeamRevision((current) => current + 1);
            addToast(`Équipe active : ${response.data.current_team.name}`, 'success');
        } catch (switchError) {
            setError(switchError);
        }
    };

    return (
        <div class="dashboard-shell min-h-screen bg-base-200 text-base-content" style={{ zoom: appearance.zoom === '90' ? 0.9 : 1 }}>
            <a class="btn btn-primary fixed start-2 top-2 z-[60] -translate-y-16 focus:translate-y-0" href="#devforge-content">
                Aller au contenu
            </a>

            <AuthGuard loading={loading} error={error} bootstrap={bootstrap} onRetry={() => void loadBootstrap()}>
                {(bootstrapData) => {
                    return (
                        <TeamContext.Provider value={{
                            teamId: bootstrapData.current_team.id,
                            revision: teamRevision,
                            agentsEnabled: bootstrapData.features?.agents_enabled ?? false,
                        }}>
                            <div class="flex min-h-screen gap-3 p-3 md:gap-4 md:p-4">
                                {sidebarOpen && (
                                    <button
                                        class="fixed inset-0 z-30 bg-black/50 backdrop-blur-[1px] lg:hidden"
                                        type="button"
                                        aria-label="Fermer la navigation"
                                        onClick={() => setSidebarOpen(false)}
                                    />
                                )}

                                <Sidebar
                                    route={route}
                                    bootstrap={bootstrapData}
                                    collapsed={sidebarCollapsed}
                                    mobileOpen={sidebarOpen}
                                    onNavigate={navigate}
                                    onCloseMobile={() => setSidebarOpen(false)}
                                    onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
                                />

                                <div class="flex min-w-0 flex-1 flex-col gap-3 md:gap-4">
                                    <Topbar
                                        bootstrap={bootstrapData}
                                        theme={theme}
                                        onOpenMenu={() => setSidebarOpen(true)}
                                        onToggleTheme={toggleTheme}
                                    />
                                    <main
                                        id="devforge-content"
                                        class="custom-scrollbar devforge-panel min-w-0 flex-1 overflow-x-hidden overflow-y-auto rounded-2xl bg-base-100/70 p-4 shadow-sm outline-none md:p-6"
                                        tabIndex={-1}
                                    >
                                        <div class={`mx-auto grid min-w-0 ${contentWidthClass(appearance.pageWidth)} gap-5`}>
                                            <DomainPage
                                                key={`${bootstrapData.current_team.id}-${teamRevision}`}
                                                bootstrap={bootstrapData}
                                                route={route}
                                                onSwitchTeam={handleSwitchTeam}
                                            />
                                        </div>
                                    </main>
                                </div>
                            </div>

                            <ToastRegion
                                toasts={toasts}
                                onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))}
                            />
                        </TeamContext.Provider>
                    );
                }}
            </AuthGuard>
        </div>
    );
}
