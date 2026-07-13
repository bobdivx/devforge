import { Menu, Moon, Sun } from 'lucide-preact';
import type { BootstrapData } from '../lib/bootstrap';
import type { Theme } from '../lib/theme';

type TopbarProps = {
    bootstrap: BootstrapData;
    theme: Theme;
    onOpenMenu: () => void;
    onToggleTheme: () => void;
};

export function Topbar({ bootstrap, theme, onOpenMenu, onToggleTheme }: TopbarProps) {
    const initials = bootstrap.user.name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase();

    return (
        <header class="devforge-topbar flex shrink-0 items-center justify-between gap-3 rounded-2xl bg-base-100 px-4 py-3 shadow-sm">
            <div class="flex min-w-0 items-center gap-3">
                <button class="btn btn-ghost btn-sm lg:hidden" type="button" aria-label="Ouvrir le menu" onClick={onOpenMenu}>
                    <Menu class="size-4" aria-hidden />
                </button>
                <div class="hidden sm:block">
                    <p class="text-xs font-medium text-base-content/45">Bienvenue</p>
                    <p class="truncate text-sm font-semibold">{bootstrap.user.name}</p>
                </div>
            </div>

            <div class="flex items-center gap-2">
                <button
                    class="btn btn-ghost btn-circle btn-sm border border-base-300/80"
                    type="button"
                    aria-label={theme === 'dark' ? 'Activer le thème clair' : 'Activer le thème sombre'}
                    onClick={onToggleTheme}
                >
                    {theme === 'dark' ? <Sun class="size-4" aria-hidden /> : <Moon class="size-4" aria-hidden />}
                </button>
                <div class="flex items-center gap-2.5 ps-1">
                    <div
                        class="grid size-10 place-items-center rounded-full bg-primary text-xs font-bold text-primary-content shadow-sm"
                        title={`${bootstrap.user.name} · ${bootstrap.user.email}`}
                        aria-label={`Connecté en tant que ${bootstrap.user.name}`}
                    >
                        {initials || 'U'}
                    </div>
                    <div class="hidden min-w-0 lg:block">
                        <p class="truncate text-sm font-semibold leading-tight">{bootstrap.user.name}</p>
                        <p class="truncate text-xs text-base-content/45">{bootstrap.user.email}</p>
                    </div>
                </div>
            </div>
        </header>
    );
}
