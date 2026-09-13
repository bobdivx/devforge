import { cn } from '../../lib/cn';

type DockPanel = 'chat' | 'steps' | 'deployments' | 'logs' | 'env';

type Props = {
  active: DockPanel;
  onSelect: (panel: DockPanel) => void;
  unreadSteps?: number;
};

const PANELS: Array<{ id: DockPanel; label: string; icon: string }> = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'steps', label: 'Étapes', icon: '⚡' },
  { id: 'deployments', label: 'Déploiements', icon: '🚀' },
  { id: 'logs', label: 'Logs', icon: '📋' },
  { id: 'env', label: 'Env', icon: '🔐' },
];

export function WorkspaceDock({ active, onSelect, unreadSteps }: Props) {
  return (
    <nav
      class={cn(
        'fixed bottom-0 left-0 right-0 z-40',
        'flex h-16 items-center justify-center gap-1 px-4',
        // Frosted glass PandaOS style
        'border-t border-white/10 bg-[var(--color-card)]/80 backdrop-blur-xl',
        // Safe area
        'pb-[env(safe-area-inset-bottom,0px)]',
      )}
    >
      <div class="flex w-full max-w-md items-center justify-around gap-1">
        {PANELS.map((panel) => {
          const isActive = active === panel.id;
          const hasUnread = panel.id === 'steps' && (unreadSteps ?? 0) > 0;
          return (
            <button
              key={panel.id}
              type="button"
              onClick={() => onSelect(panel.id)}
              class={cn(
                'relative flex flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 transition-all',
                isActive
                  ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                  : 'text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)]',
              )}
              aria-label={panel.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <span class="text-xl leading-none">{panel.icon}</span>
              <span class="text-[10px] font-medium leading-none">{panel.label}</span>
              {hasUnread && (
                <span class="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--color-accent)] text-[9px] font-bold text-white">
                  {unreadSteps}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
