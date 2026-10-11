import { cn } from '../../lib/cn';
import type { ChatChip, ChatPersona } from './types';

/** Fil vide : message d'accueil du personnage, ou explication + pistes cliquables. */
export function PersonaEmptyState({
  persona,
  threadsMode,
  starters,
  disabled,
  onStarter,
}: {
  persona?: ChatPersona;
  threadsMode: boolean;
  starters: string[];
  disabled: boolean;
  onStarter(text: string): void;
}) {
  if (persona) {
    return (
      <div class="flex items-start gap-2.5">
        {persona.smallAvatar}
        <p class="max-w-[92%] rounded-2xl rounded-tl-md border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)]">
          {persona.emptyText}
        </p>
      </div>
    );
  }
  return (
    <div class="space-y-3">
      <p class="text-sm text-[var(--color-ink-muted)]">
        {threadsMode
          ? 'Décris ce que tu veux. L’assistant modifie le projet ; la preview et les fichiers sont à côté.'
          : 'Cet agent surveille sa partie du projet. Pose une question, ou choisis une piste.'}
      </p>
      <div class="flex flex-wrap gap-2">
        {starters.map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            class="rounded-full border border-[var(--color-line)] px-3 py-1.5 text-xs text-[var(--color-ink-muted)] transition hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]"
            onClick={() => onStarter(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Suggestions du personnage au-dessus du champ. */
export function PersonaChips({ chips, busy, hasThread, onChip }: { chips: ChatChip[]; busy: boolean; hasThread: boolean; onChip(chip: ChatChip): void }) {
  return (
    <div class="df-scroll-x flex shrink-0 gap-2 overflow-x-auto border-t border-[var(--color-line)] px-3 pt-3 md:flex-wrap md:overflow-visible">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          disabled={busy || (!chip.onClick && !hasThread)}
          class={cn(
            'inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition disabled:opacity-50 max-lg:text-[13px]',
            chip.tone === 'danger'
              ? 'border-[var(--color-danger)]/35 bg-[var(--color-danger)]/10 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15'
              : 'border-[var(--color-line-strong)] bg-white/[0.03] text-[var(--color-ink)] hover:bg-white/[0.07]',
          )}
          onClick={() => onChip(chip)}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
