import { Menu, Moon, Search, Sun } from 'lucide-preact';
import type { BootstrapData } from '../lib/bootstrap';
import type { Theme } from '../lib/theme';
import { openCommandPalette } from '../lib/command-palette';
import { DeploymentsIndicator } from './DeploymentsIndicator';
import { InstanceUpdateIndicator } from './InstanceUpdateIndicator';
import { TeamSwitcher } from './TeamSwitcher';
import { UserMenu } from './UserMenu';

type TopbarProps = {
    bootstrap: BootstrapData;
    theme: Theme;
    onOpenMenu: () => void;
    onToggleTheme: () => void;
    onSwitchTeam: (teamId: number) => Promise<void>;
};

export function Topbar({ bootstrap, theme, onOpenMenu, onToggleTheme, onSwitchTeam }: TopbarProps) {
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
                <button
                    class="btn btn-ghost btn-sm hidden items-center gap-2 border border-base-300/70 sm:inline-flex"
                    type="button"
                    aria-label="Ouvrir la palette de commandes"
                    onClick={() => openCommandPalette()}
                >
                    <Search class="size-3.5" aria-hidden />
                    <span class="text-xs text-base-content/55">Rechercher</span>
                    <kbd class="rounded border border-base-300 px-1 text-[10px] text-base-content/40">⌘K</kbd>
                </button>
                <button
                    class="btn btn-ghost btn-circle btn-sm sm:hidden"
                    type="button"
                    aria-label="Ouvrir la palette de commandes"
                    onClick={() => openCommandPalette()}
                >
                    <Search class="size-4" aria-hidden />
                </button>
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
                <UserMenu user={bootstrap.user} teamName={bootstrap.current_team.name} />
            </div>
        </header>
    );
}
