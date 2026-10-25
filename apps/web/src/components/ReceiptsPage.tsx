import { useEffect, useState } from 'preact/hooks';
import { api, type ApprovalReceipt } from '../lib/api';
import { cn } from '../lib/cn';
import {
  RECEIPT_FILTERS,
  approvalLeft,
  filterStatuses,
  formatWhen,
  receiptDetails,
  receiptStatus,
  receiptSubtitle,
  type ReceiptFilter,
} from '../lib/receipts';
import { AppShell } from './AppShell';
import { Alert, Badge, Button, HubGrid, HubIcon, HubTile, Modal, Skeleton } from './ui';

const ACTION_ICON: Record<string, string> = {
  deploy: 'refresh',
  rebuild: 'refresh',
  retry: 'refresh',
  build: 'cpu',
  restart: 'refresh',
  stop: 'server',
  cancel_deploy: 'server',
  publish: 'github',
  publish_approval: 'shield',
  agent_tool: 'brain',
};

const DOT: Record<string, string> = {
  ok: 'bg-[var(--color-ok)]',
  danger: 'bg-[var(--color-danger)]',
  warn: 'bg-[var(--color-warn)]',
  accent: 'bg-[var(--color-accent)]',
  neutral: 'bg-[var(--color-ink-faint)]',
};

/** P2 : historique des validations — qui a validé quoi, quand, et ce que ça a donné. */
export function ReceiptsPage() {
  const [filter, setFilter] = useState<ReceiptFilter>('all');
  const [items, setItems] = useState<ApprovalReceipt[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<ApprovalReceipt | null>(null);

  async function load(reset: boolean) {
    if (reset) setLoading(true);
    else setMore(true);
    setError('');
    try {
      const r = await api.receipts({
        status: filterStatuses(filter),
        before: reset ? undefined : next ?? undefined,
        limit: 48,
      });
      setItems((prev) => (reset ? r.data ?? [] : [...prev, ...(r.data ?? [])]));
      setNext(r.next_before ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setMore(false);
    }
  }

  useEffect(() => {
    void load(true);
  }, [filter]);

  async function openReceipt(r: ApprovalReceipt) {
    setOpen(r);
    try {
      const fresh = await api.receipt(r.uuid);
      setOpen(fresh.data);
    } catch {
      /* le résumé de la liste suffit */
    }
  }

  return (
    <AppShell
      active="settings"
      title="Validations"
      description="Chaque action risquée confirmée : qui, quand, quoi, et l’issue."
    >
      <div class="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Filtrer">
        {RECEIPT_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            class={cn(
              'inline-flex min-h-[36px] shrink-0 items-center rounded-full px-3.5 text-xs font-medium transition-colors active:scale-[0.97]',
              filter === f.key
                ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'bg-white/5 text-[var(--color-ink-muted)] hover:text-white',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {loading ? (
        <HubGrid cols={5}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} class="aspect-square rounded-2xl" />
          ))}
        </HubGrid>
      ) : items.length === 0 ? (
        <p class="py-10 text-center text-sm text-[var(--color-ink-muted)]">
          {filter === 'all'
            ? 'Aucune validation pour l’instant. Chaque mise en ligne, arrêt ou publication confirmé apparaîtra ici.'
            : 'Rien dans ce filtre.'}
        </p>
      ) : (
        <>
          <HubGrid cols={5}>
            {items.map((r, i) => {
              const st = receiptStatus(r.status);
              return (
                <HubTile
                  key={r.uuid}
                  index={i}
                  title={r.action_label}
                  icon={<HubIcon name={ACTION_ICON[r.action] ?? 'shield'} />}
                  badge={
                    <span
                      class={cn('absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[var(--color-bg)]', DOT[st.tone])}
                      aria-hidden
                    />
                  }
                  subtitle={
                    <div class="mt-1 space-y-0.5 text-[11px] leading-snug">
                      <div class="truncate text-[var(--color-ink-muted)]">{receiptSubtitle(r)}</div>
                      <div class="truncate">
                        <span class={st.tone === 'danger' ? 'text-[var(--color-danger)]' : st.tone === 'warn' ? 'text-[var(--color-warn)]' : st.tone === 'ok' ? 'text-[var(--color-ok)]' : 'text-[var(--color-ink-muted)]'}>
                          {st.label}
                        </span>
                        <span class="text-[var(--color-ink-faint)]"> · {formatWhen(r.approved_at ?? r.created_at)}</span>
                      </div>
                    </div>
                  }
                  layout="auto"
                  onClick={() => void openReceipt(r)}
                />
              );
            })}
          </HubGrid>
          {next ? (
            <div class="mt-5 flex justify-center">
              <Button variant="secondary" onClick={() => void load(false)} disabled={more}>
                {more ? 'Chargement…' : 'Voir plus'}
              </Button>
            </div>
          ) : null}
        </>
      )}

      <ReceiptModal receipt={open} onClose={() => setOpen(null)} />
    </AppShell>
  );
}

function ReceiptModal({ receipt, onClose }: { receipt: ApprovalReceipt | null; onClose: () => void }) {
  if (!receipt) return null;
  const st = receiptStatus(receipt.status);
  const left = approvalLeft(receipt);
  return (
    <Modal
      open={!!receipt}
      onClose={onClose}
      title={receipt.action_label}
      description={receipt.project_name ?? receipt.target}
      size="md"
      fullOnMobile
    >
      <div class="space-y-4">
        <div class="flex flex-wrap items-center gap-2">
          <Badge tone={st.tone}>{st.label}</Badge>
          {left !== null ? (
            <Badge tone="neutral">{left > 0 ? `Valable encore ${left} min` : 'Validation expirée'}</Badge>
          ) : null}
        </div>
        {receipt.detail ? (
          <p
            class={cn(
              'rounded-xl px-3 py-2 text-sm leading-relaxed [overflow-wrap:anywhere]',
              st.tone === 'danger'
                ? 'bg-red-500/10 text-[var(--color-danger)]'
                : st.tone === 'warn'
                  ? 'bg-amber-500/10 text-[var(--color-warn)]'
                  : 'bg-white/5 text-[var(--color-ink-muted)]',
            )}
          >
            {receipt.detail}
          </p>
        ) : null}
        {receipt.status === 'unknown' ? (
          <p class="text-xs text-[var(--color-ink-muted)]">
            DevForge a redémarré pendant l’action : elle n’a pas été relancée. Vérifie le résultat avant de recommencer.
          </p>
        ) : null}
        <dl class="divide-y divide-[var(--color-line)] rounded-xl border border-[var(--color-line)]">
          {receiptDetails(receipt).map((row) => (
            <div key={row.label} class="flex items-start justify-between gap-4 px-3 py-2.5 text-sm">
              <dt class="shrink-0 text-[var(--color-ink-muted)]">{row.label}</dt>
              <dd class="min-w-0 text-right text-white [overflow-wrap:anywhere]">{row.value}</dd>
            </div>
          ))}
        </dl>
        {receipt.project_uuid ? (
          <a
            href={`/app/projects/view?uuid=${encodeURIComponent(receipt.project_uuid)}`}
            class="block text-center text-sm text-[var(--color-accent)] hover:underline"
          >
            Ouvrir le projet
          </a>
        ) : null}
      </div>
    </Modal>
  );
}
