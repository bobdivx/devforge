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
    const navigate = useNavigate();
    const menuRef = useRef<HTMLDetailsElement>(null);
    const [menuOpen, setMenuOpen] = useState(false);
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
                menuRef.current.open = false;
                setMenuOpen(false);
            }
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                if (menuRef.current) {
                    menuRef.current.open = false;
                }
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

    const closeMenu = () => {
        if (menuRef.current) {
            menuRef.current.open = false;
        }
        setMenuOpen(false);
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
                <details
                    ref={menuRef}
                    class="dropdown dropdown-end"
                    onToggle={(event) => setMenuOpen(event.currentTarget.open)}
                >
                    <summary
                        class="flex cursor-pointer list-none items-center gap-2.5 rounded-xl ps-1 outline-none marker:content-none [&::-webkit-details-marker]:hidden"
                        aria-label={`Menu compte — ${bootstrap.user.name}`}
                        title={`${bootstrap.user.name} · ${bootstrap.user.email}`}
                    >
                        <div class="grid size-9 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-content">
                            {initials || 'U'}
                        </div>
                        <div class="hidden min-w-0 lg:block">
                            <p class="truncate text-xs sm:text-sm font-semibold leading-tight">{bootstrap.user.name}</p>
                            <p class="truncate text-xs text-base-content/45">{bootstrap.current_team.name}</p>
                        </div>
                    </summary>
                    <ul class="menu dropdown-content z-50 mt-2 w-52 rounded-xl border border-base-300 bg-base-100 p-1.5 shadow-lg">
                        <li>
                            <a
                                href={routeHref('/settings')}
                                onClick={(event) => {
                                    navigate(event, '/settings');
                                    closeMenu();
                                }}
                            >
                                <User class="size-4 shrink-0" aria-hidden />
                                Profil
                            </a>
                        </li>
                        <li>
                            <button type="button" onClick={() => void logout()}>
                                <LogOut class="size-4 shrink-0" aria-hidden />
                                Déconnexion
                            </button>
                        </li>
                    </ul>
                </details>
            </div>
        </header>
    );
}
