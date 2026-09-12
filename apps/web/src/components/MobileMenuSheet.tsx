import { useEffect, useId } from 'preact/hooks';
import { cn } from '../lib/cn';
import { globalNavForRole } from '../lib/nav';

type Props = {
  open: boolean;
  onClose: () => void;
  active?: string;
  userRole?: string | null;
};

type MenuSection = {
  title: string;
  items: Array<{ href: string; label: string; key: string; adminOnly?: boolean }>;
};

function buildSections(role?: string | null): MenuSection[] {
  const isAdmin = role === 'instance_admin';

  return [
    {
      title: 'Outils',
      items: [
        { href: '/app/mcp', label: 'MCP', key: 'mcp' },
        { href: '/app/tokens', label: 'Tokens', key: 'tokens' },
      ],
    },
    {
      title: 'Compte',
      items: [{ href: '/app/team', label: 'Compte / équipe', key: 'team' }],
    },
    {
      title: 'Instance',
      items: [
        { href: '/app/settings', label: 'Paramètres', key: 'settings' },
        { href: '/app/update', label: 'Mise à jour', key: 'update' },
        ...(isAdmin
          ? [{ href: '/app/admin', label: 'Admin', key: 'admin', adminOnly: true }]
          : []),
      ],
    },
  ];
}

export function MobileMenuSheet({ open, onClose, active, userRole }: Props) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const sections = buildSections(userRole);

  return (
    <div
      class="fixed inset-0 z-50 flex items-end justify-center lg:hidden"
      style={{ paddingBottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <button
        type="button"
        aria-label="Fermer"
        class="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        class={cn(
          'relative z-10 flex w-full max-w-lg flex-col overflow-hidden border-t border-[var(--color-line)] bg-[var(--color-card)] shadow-2xl',
          'max-h-[min(75dvh,600px)] rounded-t-2xl',
        )}
      >
        <div class="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
          <h2 id={titleId} class="text-base font-medium tracking-tight text-[var(--color-ink)]">
            Menu
          </h2>
          <button
            type="button"
            class="shrink-0 rounded-lg px-2 py-1 text-sm text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)]"
            onClick={onClose}
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>

        <div
          class="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
        >
          {sections.map((section) => (
            <div key={section.title}>
              <h3 class="mb-2 px-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                {section.title}
              </h3>
              <nav class="space-y-1">
                {section.items.map((item) => {
                  const isCurrent = active === item.key;
                  return (
                    <a
                      key={item.key}
                      href={item.href}
                      class={cn(
                        'flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition',
                        isCurrent
                          ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                          : 'text-[var(--color-ink-muted)] active:bg-white/5 active:text-[var(--color-ink)]',
                      )}
                      onClick={() => {
                        // Ferme après un petit délai pour permettre la navigation visuelle
                        setTimeout(onClose, 100);
                      }}
                      aria-current={isCurrent ? 'page' : undefined}
                    >
                      {item.label}
                    </a>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
