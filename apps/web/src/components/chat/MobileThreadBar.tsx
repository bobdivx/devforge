import { Plus } from 'lucide-preact';
import { cn } from '../../lib/cn';
import { Button, Spinner } from '../ui';
import { threadLabel, type AgentRow } from './thread-meta';

/** Fils en puces horizontales (mobile, ou workspace intégré) + nouvelle tâche. */
export function MobileThreadBar({
  rows,
  selected,
  onSelect,
  creating,
  busy,
  onCreate,
  embedded,
}: {
  rows: AgentRow[];
  selected: string | null;
  onSelect(uuid: string): void;
  creating: boolean;
  busy: boolean;
  onCreate(): void;
  embedded: boolean;
}) {
  return (
    <div class={cn('mb-2 flex shrink-0 items-center gap-2', !embedded && 'lg:hidden')}>
      {/* -my/py : la zone de défilement laisse dépasser la zone de toucher des puces (44 px) sans changer la mise en page. */}
      <div class="min-w-0 flex-1 overflow-x-auto py-2 -my-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div class="flex w-max gap-1">
          {rows.map(({ agent: a, depth }) => (
            <button
              key={a.uuid}
              type="button"
              onClick={() => onSelect(a.uuid)}
              class={cn(
                'df-hit max-w-[10rem] shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium transition',
                selected === a.uuid
                  ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                  : 'bg-white/[0.03] text-[var(--color-ink-muted)] hover:bg-white/5',
              )}
            >
              {/* truncate sur le texte : un overflow:hidden sur le bouton couperait sa zone de toucher. */}
              <span class="block truncate">{depth > 0 ? `↳ ${threadLabel(a)}` : threadLabel(a)}</span>
            </button>
          ))}
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={creating || busy}
        onClick={onCreate}
        aria-label="Nouvelle tâche isolée"
        title="Nouvelle tâche isolée"
      >
        {creating ? <Spinner /> : <Plus size={14} strokeWidth={2} aria-hidden />}
      </Button>
    </div>
  );
}
