import { ChevronRight, FileText, Sparkles, X as XIcon, Check } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import {
  activityItems,
  activitySummary,
  pillText,
  statusOf,
  type ActivityItem,
  type LiveAction,
} from '../../lib/activity';
import type { AgentReflection } from '../../lib/agent-stream';
import { cn } from '../../lib/cn';
import { AgentActionDetail } from '../agents/AgentActionCards';
import { Spinner } from '../ui';

/** Pastilles visibles pendant le run (la courante + les 2 précédentes). */
export const LIVE_VISIBLE = 3;

const PILL =
  'inline-flex h-7 min-w-0 max-w-[16rem] shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 text-[12px] text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] max-lg:h-8 df-tap-skip df-hit';

function itemText(item: ActivityItem): string {
  if (item.kind === 'reflection') return 'Réflexion';
  return pillText(item.action);
}

/** Une pastille : état (spinner / ✓ / ✗) + texte court ; clic = détail. */
export function ActivityPill({
  item,
  open,
  onToggle,
}: {
  item: ActivityItem;
  open: boolean;
  onToggle: () => void;
}) {
  const status = item.kind === 'tool' ? statusOf(item.action) : 'ok';
  const text = itemText(item);
  return (
    <button
      type="button"
      class={cn(PILL, 'df-pill-in', open && 'border-[var(--color-line-strong)] text-[var(--color-ink)]')}
      aria-expanded={open}
      title={item.kind === 'tool' ? item.action.summary || text : item.reflection.label}
      onClick={onToggle}
      data-status={status}
    >
      {item.kind === 'reflection' ? (
        <Sparkles size={12} strokeWidth={2} class="shrink-0 text-[var(--color-accent)]" aria-hidden />
      ) : status === 'running' ? (
        <Spinner class="h-3 w-3 shrink-0 border-[1.5px]" />
      ) : status === 'fail' ? (
        <XIcon size={12} strokeWidth={2.5} class="shrink-0 text-[var(--color-danger)]" aria-label="échec" />
      ) : (
        <Check size={12} strokeWidth={2.5} class="shrink-0 text-[var(--color-ok)]" aria-label="ok" />
      )}
      <span class="min-w-0 truncate">{text}</span>
    </button>
  );
}

function Detail({ item }: { item: ActivityItem }) {
  if (item.kind === 'reflection') {
    return (
      <div class="whitespace-pre-wrap px-3 py-2 text-xs leading-relaxed text-[var(--color-ink-muted)]">
        {item.reflection.detail || item.reflection.label}
      </div>
    );
  }
  return (
    <div>
      {item.action.summary ? (
        <p class="border-b border-[var(--color-line)] px-3 py-1.5 text-[11px] text-[var(--color-ink-faint)]">
          {item.action.summary}
        </p>
      ) : null}
      <AgentActionDetail call={item.action} />
    </div>
  );
}

/** Dépliage animé (grid-template-rows 0fr → 1fr ; sans transition sous reduced-motion). */
function Collapse({ open, children }: { open: boolean; children: ComponentChildren }) {
  return (
    <div class="df-collapse" data-open={open ? 'true' : 'false'} aria-hidden={!open}>
      <div class="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

/**
 * Activité d'un run regroupée (P2-04) : pendant le run, la pastille courante et les 2
 * précédentes ; ensuite une ligne résumé repliée. Les fichiers modifiés restent à un clic.
 */
export function ActivityGroup({
  actions,
  reflections = [],
  live,
  elapsedMs,
  class: className,
}: {
  actions: LiveAction[];
  reflections?: AgentReflection[];
  live: boolean;
  elapsedMs?: number;
  class?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  /** Dernier détail ouvert : reste rendu pendant l'animation de fermeture. */
  const lastOpen = useRef<ActivityItem | null>(null);
  const items = activityItems(actions, reflections);
  if (!items.length) return null;
  const toggle = (key: string) => setOpenKey((k) => (k === key ? null : key));
  const openItem = items.find((i) => i.key === openKey) ?? null;
  if (openItem) lastOpen.current = openItem;
  const shownItem = openItem ?? lastOpen.current;
  const fileItems = items.filter(
    (i) => i.kind === 'tool' && i.action.name === 'write_project_file' && statusOf(i.action) !== 'fail',
  );

  let row: ComponentChildren;
  if (expanded) {
    row = (
      <div class="flex flex-wrap gap-1.5">
        {!live ? (
          <button type="button" class={PILL} aria-expanded onClick={() => setExpanded(false)}>
            <ChevronRight size={12} class="shrink-0 rotate-90 transition-transform" aria-hidden />
            <span class="truncate">{activitySummary(actions, elapsedMs)}</span>
          </button>
        ) : null}
        {items.map((i) => (
          <ActivityPill key={i.key} item={i} open={openKey === i.key} onToggle={() => toggle(i.key)} />
        ))}
      </div>
    );
  } else if (live) {
    const hidden = Math.max(0, items.length - LIVE_VISIBLE);
    row = (
      <div class="flex min-w-0 flex-nowrap gap-1.5 overflow-x-clip">
        {hidden > 0 ? (
          <button type="button" class={PILL} aria-expanded={false} onClick={() => setExpanded(true)}>
            +{hidden} action{hidden > 1 ? 's' : ''}
          </button>
        ) : null}
        {items.slice(-LIVE_VISIBLE).map((i) => (
          <ActivityPill key={i.key} item={i} open={openKey === i.key} onToggle={() => toggle(i.key)} />
        ))}
      </div>
    );
  } else {
    row = (
      <div class="flex min-w-0 flex-nowrap gap-1.5 overflow-x-clip">
        <button
          type="button"
          class={cn(PILL, 'shrink')}
          aria-expanded={false}
          onClick={() => setExpanded(true)}
          data-testid="activity-summary"
        >
          <ChevronRight size={12} class="shrink-0 transition-transform" aria-hidden />
          <span class="truncate">{activitySummary(actions, elapsedMs)}</span>
        </button>
        {fileItems.slice(0, 3).map((i, n) => {
          const a = (i as Extract<ActivityItem, { kind: 'tool' }>).action;
          const path = typeof a.arguments?.path === 'string' ? a.arguments.path : a.name;
          return (
            <button
              key={i.key}
              type="button"
              class={cn(
                PILL,
                'shrink min-w-[4.5rem]',
                n >= 1 && 'max-sm:hidden',
                openKey === i.key && 'border-[var(--color-line-strong)] text-[var(--color-ink)]',
              )}
              aria-expanded={openKey === i.key}
              title={`Voir le diff de ${path}`}
              onClick={() => toggle(i.key)}
            >
              <FileText size={12} class="shrink-0" aria-hidden />
              <span class="truncate">{path.split('/').pop()}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div class={cn('max-w-[92%] space-y-1.5', className)} data-testid="activity-group" data-live={live ? 'true' : 'false'}>
      {row}
      <Collapse open={!!openItem}>
        {shownItem ? (
          <div class="overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
            <Detail item={shownItem} />
          </div>
        ) : null}
      </Collapse>
    </div>
  );
}
