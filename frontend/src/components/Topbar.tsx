import { LogOut, Menu, Moon, Sun, User } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { logout } from '../lib/api-client';
import type { BootstrapData } from '../lib/bootstrap';
import { routeHref } from '../lib/routes';
import type { Theme } from '../lib/theme';
import { useNavigate } from '../lib/use-navigate';
import { DeploymentsIndicator } from './DeploymentsIndicator';
import { InstanceUpdateIndicator } from './InstanceUpdateIndicator';
import { TeamSwitcher } from './TeamSwitcher';

type TopbarProps = {
    bootstrap: BootstrapData;
    theme: Theme;
    onOpenMenu: () => void;
    onToggleTheme: () => void;
    onSwitchTeam: (teamId: number) => Promise<void>;
};

export function Topbar({ bootstrap, theme, onOpenMenu, onToggleTheme, onSwitchTeam }: TopbarProps) {
    const onNavigate = useNavigate();
    const [menuOpen, setMenuOpen] = useState(false);
    const [loggingOut, setLoggingOut] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const initials = bootstrap.user.name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase();

    useEffect(() => {
        if (!menuOpen) {
            return;
        }

        const onPointerDown = (event: PointerEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setMenuOpen(false);
            }
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setMenuOpen(false);
            }
        };

        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);

        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [menuOpen]);

    const handleLogout = () => {
        if (loggingOut) {
            return;
        }

        setLoggingOut(true);
        setMenuOpen(false);
        void logout();
    };

    return (
        <header class="devforge-topbar sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between gap-2 sm:gap-3 px-3 sm:px-4 md:px-8">
            <div class="flex min-w-0 items-center gap-3">
                <button class="btn btn-ghost btn-sm lg:hidden" type="button" aria-label="Ouvrir le menu" onClick={onOpenMenu}>
                    <Menu class="size-4" aria-hidden />
                </button>
                <div class="min-w-0 max-w-56">
                    <TeamSwitcher
                        teams={bootstrap.teams}
                        currentTeam={bootstrap.current_team}
                        variant="sidebar"
                        ariaLabel="Équipe"
                        onSwitch={onSwitchTeam}
                    />
                </div>
            </div>

            <div class="flex items-center gap-2">
                <InstanceUpdateIndicator enabled={bootstrap.permissions.instance_admin} />
                <DeploymentsIndicator />
                <button
                    class="btn btn-ghost btn-circle btn-sm"
                    type="button"
                    aria-label={theme === 'dark' ? 'Activer le thème clair' : 'Activer le thème sombre'}
                    onClick={onToggleTheme}
                >
                    {theme === 'dark' ? <Sun class="size-4" aria-hidden /> : <Moon class="size-4" aria-hidden />}
                </button>
                <div class="relative" ref={menuRef}>
                    <button
                        class="flex items-center gap-2.5 rounded-xl ps-1 hover:bg-base-200/70"
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        aria-label={`Menu compte de ${bootstrap.user.name}`}
                        onClick={() => setMenuOpen((open) => !open)}
                    >
                        <div
                            class="grid size-9 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-content"
                            title={`${bootstrap.user.name} · ${bootstrap.user.email}`}
                        >
                            {initials || 'U'}
                        </div>
                        <div class="hidden min-w-0 lg:block text-start">
                            <p class="truncate text-xs sm:text-sm font-semibold leading-tight">{bootstrap.user.name}</p>
                            <p class="truncate text-xs text-base-content/45">{bootstrap.current_team.name}</p>
                        </div>
                    </button>
                    {menuOpen && (
                        <ul
                            class="absolute end-0 top-[calc(100%+0.5rem)] z-30 min-w-48 rounded-xl border border-base-300/70 bg-base-100 p-1 shadow-lg"
                            role="menu"
                            aria-label="Compte"
                        >
                            <li role="none">
                                <a
                                    class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-base-200"
                                    href={routeHref('/settings/')}
                                    role="menuitem"
                                    onClick={(event) => {
                                        onNavigate(event, '/settings/');
                                        setMenuOpen(false);
                                    }}
                                >
                                    <User class="size-4 shrink-0" aria-hidden />
                                    Profil
                                </a>
                            </li>
                            <li role="none">
                                <button
                                    class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-error hover:bg-error/10"
                                    type="button"
                                    role="menuitem"
                                    disabled={loggingOut}
                                    onClick={handleLogout}
                                >
                                    <LogOut class="size-4 shrink-0" aria-hidden />
                                    {loggingOut ? 'Déconnexion…' : 'Déconnexion'}
                                </button>
                            </li>
                        </ul>
                    )}
                </div>
            </div>
        </header>
    );
}
