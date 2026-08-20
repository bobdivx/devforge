import { Menu, Moon, Sun } from 'lucide-preact';
import type { BootstrapData } from '../lib/bootstrap';
import type { Theme } from '../lib/theme';
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
    const initials = bootstrap.user.name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase();

    return (
        <header class="devforge-topbar sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between gap-3 px-4 md:px-8">
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
                <div class="flex items-center gap-2.5 ps-1">
                    <div
                        class="grid size-9 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-content"
                        title={`${bootstrap.user.name} · ${bootstrap.user.email}`}
                        aria-label={`Connecté en tant que ${bootstrap.user.name}`}
                    >
                        {initials || 'U'}
                    </div>
                    <div class="hidden min-w-0 lg:block">
                        <p class="truncate text-sm font-semibold leading-tight">{bootstrap.user.name}</p>
                        <p class="truncate text-xs text-base-content/45">{bootstrap.current_team.name}</p>
                    </div>
                </div>
            </div>
        </header>
    );
}
