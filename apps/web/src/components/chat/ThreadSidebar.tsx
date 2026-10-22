import { MessageSquare, Plus } from 'lucide-preact';
import { cn } from '../../lib/cn';
import { Alert, Badge, Button, Card, Spinner } from '../ui';
import { metaFor, threadLabel, type AgentRow } from './thread-meta';

type Props = {
  rows: AgentRow[];
  selected: string | null;
  onSelect(uuid: string): void;
  error: string | null;
};

/** Fils de conversation (workspace) avec « Nouvelle tâche isolée ». */
export function ThreadSidebar({ rows, selected, onSelect, error, creating, busy, onCreate }: Props & { creating: boolean; busy: boolean; onCreate(): void }) {
  return (
    <div class="flex flex-col gap-2">
      <Button type="button" size="sm" variant="secondary" disabled={creating || busy} onClick={onCreate} class="w-full justify-start">
        {creating ? <Spinner /> : <Plus size={14} strokeWidth={2} aria-hidden />}
        Nouvelle tâche isolée
      </Button>
      {error && (
        <Alert tone="warn" class="mb-1">
          {error}
        </Alert>
      )}
      <ul class="space-y-0.5">
        {rows.map(({ agent: a, depth }) => {
          const on = selected === a.uuid;
          return (
            <li key={a.uuid}>
              <button
                type="button"
                aria-current={on ? 'true' : undefined}
                class={cn(
                  'flex w-full items-start gap-2 rounded-xl py-2.5 text-left transition',
                  depth > 0 ? 'pl-7 pr-3' : 'px-3',
                  on ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-surface)]',
                )}
                onClick={() => onSelect(a.uuid)}
              >
                <MessageSquare size={14} strokeWidth={2} class="mt-0.5 shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium tracking-tight">{depth > 0 ? `↳ ${threadLabel(a)}` : threadLabel(a)}</span>
                  {a.kind === 'subagent' && <span class="mt-0.5 block text-[10px] text-[var(--color-ink-faint)]">Sous-agent</span>}
                  {a.status === 'working' && <span class="mt-0.5 block text-[10px] text-[var(--color-accent)]">En cours…</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {rows.length === 0 && !error && <p class="px-1 text-sm text-[var(--color-ink-muted)]">Aucun chat…</p>}
    </div>
  );
}

/** Équipe d'agents (Ops, Deploy, Revue…) avec badges. */
export function TeamSidebar({ rows, selected, onSelect, error, loading }: Props & { loading: boolean }) {
  return (
    <Card>
      <p class="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">Équipe</p>
      {error && (
        <Alert tone="warn" class="mb-3">
          {error}
        </Alert>
      )}
      <ul class="space-y-1">
        {rows.map(({ agent: a, depth }) => {
          const meta = metaFor(a);
          const on = selected === a.uuid;
          return (
            <li key={a.uuid}>
              <button
                type="button"
                aria-current={on ? 'true' : undefined}
                class={cn(
                  'flex w-full flex-col rounded-xl py-2.5 text-left transition',
                  depth > 0 ? 'pl-7 pr-3' : 'px-3',
                  on ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-surface)]',
                )}
                onClick={() => onSelect(a.uuid)}
              >
                <span class="flex items-center gap-2 font-medium tracking-tight">
                  {depth > 0 ? `↳ ${meta.label}` : meta.label}
                  {a.role === 'coordinator' && (
                    <Badge tone="accent" class="!px-1.5 !py-0 text-[10px]">
                      Fil permanent
                    </Badge>
                  )}
                  {a.kind === 'subagent' && (
                    <Badge tone="neutral" class="!px-1.5 !py-0 text-[10px]">
                      Sous-agent
                    </Badge>
                  )}
                </span>
                <span class="mt-0.5 text-xs text-[var(--color-ink-faint)]">{meta.blurb}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {loading && !error && <p class="text-sm text-[var(--color-ink-muted)]">Chargement des agents…</p>}
    </Card>
  );
}
