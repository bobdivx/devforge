import { ArrowDown } from 'lucide-preact';

/** Bouton flottant « Nouveaux messages » quand l'utilisateur a remonté le fil. */
export function JumpToLatest({ visible, onClick }: { visible: boolean; onClick(): void }) {
  if (!visible) return null;
  return (
    <button
      type="button"
      class="df-jump-in df-tap-skip absolute bottom-3 left-1/2 z-10 inline-flex h-9 -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--color-line-strong)] bg-[var(--color-card)] px-3 text-xs font-medium text-[var(--color-ink)] shadow-lg transition-colors hover:bg-[var(--color-surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] max-lg:h-11 max-lg:px-4"
      onClick={onClick}
    >
      <ArrowDown size={14} strokeWidth={2.2} aria-hidden />
      Nouveaux messages
    </button>
  );
}
