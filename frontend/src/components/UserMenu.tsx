import { Info, LogOut, User } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { logout } from '../lib/api-client';
import type { BootstrapUser } from '../lib/bootstrap';
import { routeHref } from '../lib/routes';
import { useNavigate } from '../lib/use-navigate';

type UserMenuProps = {
    user: BootstrapUser;
    teamName: string;
};

function initialsFromName(name: string): string {
    return name
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join('')
        .toUpperCase();
}

const itemClass =
    'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-base-content/80 transition-colors hover:bg-base-200 hover:text-base-content';

export function UserMenu({ user, teamName }: UserMenuProps) {
    const [open, setOpen] = useState(false);
    const [loggingOut, setLoggingOut] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();
    const initials = initialsFromName(user.name);

    useEffect(() => {
        if (!open) {
            return;
        }

        const onPointerDown = (event: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };

        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);

        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    const goTo = (event: MouseEvent, path: string) => {
        navigate(event, path);
        setOpen(false);
    };

    const handleLogout = () => {
        if (loggingOut) {
            return;
        }

        setLoggingOut(true);
        void logout().catch(() => {
            setLoggingOut(false);
        });
    };

    return (
        <div class="relative" ref={rootRef}>
            <button
                class="flex items-center gap-2.5 rounded-xl ps-1 pe-1 py-0.5 text-left transition-colors hover:bg-base-200/70"
                type="button"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={`Menu du compte · ${user.name}`}
                onClick={() => setOpen((current) => !current)}
            >
                <span
                    class="grid size-9 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-content"
                    aria-hidden
                >
                    {initials || 'U'}
                </span>
                <span class="hidden min-w-0 lg:block">
                    <span class="block truncate text-xs sm:text-sm font-semibold leading-tight">{user.name}</span>
                    <span class="block truncate text-xs text-base-content/45">{teamName}</span>
                </span>
            </button>

            {open && (
                <div
                    class="absolute end-0 top-[calc(100%+0.5rem)] z-50 w-56 rounded-2xl border border-base-300/70 bg-base-100 p-1.5 shadow-lg"
                    role="menu"
                    aria-label="Compte"
                >
                    <a
                        class={itemClass}
                        href={routeHref('/settings')}
                        role="menuitem"
                        onClick={(event) => goTo(event, '/settings')}
                    >
                        <User class="size-4 shrink-0" aria-hidden />
                        Profil
                    </a>
                    <a
                        class={itemClass}
                        href={routeHref('/a-propos')}
                        role="menuitem"
                        onClick={(event) => goTo(event, '/a-propos')}
                    >
                        <Info class="size-4 shrink-0" aria-hidden />
                        À propos
                    </a>
                    <div class="my-1 h-px bg-base-300/80" role="separator" />
                    <button
                        class={`${itemClass} text-error hover:bg-error/10 hover:text-error`}
                        type="button"
                        role="menuitem"
                        disabled={loggingOut}
                        onClick={handleLogout}
                    >
                        <LogOut class="size-4 shrink-0" aria-hidden />
                        {loggingOut ? 'Déconnexion…' : 'Déconnexion'}
                    </button>
                </div>
            )}
        </div>
    );
}
