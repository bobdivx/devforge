import { useEffect, useState } from 'preact/hooks';
import { Bell } from 'lucide-preact';
import { api, type WatchAlert } from '../lib/api';
import { cn } from '../lib/cn';
import { alertsBadge, formatWhen } from '../lib/watches';
import { Button, Modal } from './ui';

/** P3 : alertes de surveillance non lues, relues toutes les minutes tant que l'onglet est visible. */
export function useWatchAlerts(intervalMs = 60000): [number, () => void] {
  const [unread, setUnread] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const r = await api.watchAlerts(true);
        if (alive) setUnread(r.unread ?? 0);
      } catch {
        /* hors ligne ou non connecté : rien à afficher */
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), intervalMs);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs, tick]);
  return [unread, () => setTick((n) => n + 1)];
}

/** Pastille d'en-tête : n'apparaît que s'il y a des alertes non lues. */
export function WatchAlertsMenu() {
  const [unread, reload] = useWatchAlerts();
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<WatchAlert[]>([]);

  useEffect(() => {
    if (!open) return;
    api
      .watchAlerts(false)
      .then((r) => setAlerts(r.data ?? []))
      .catch(() => setAlerts([]));
  }, [open]);

  if (unread === 0 && !open) return null;

  async function markAll() {
    try {
      await api.markWatchAlertsRead();
    } finally {
      setOpen(false);
      reload();
    }
  }

  async function pick(a: WatchAlert) {
    try {
      await api.markWatchAlertsRead([a.uuid]);
    } catch {
      /* la page s'ouvre quand même */
    }
    window.location.href = `/app/watches?open=${encodeURIComponent(a.watch_uuid)}`;
  }

  return (
    <>
      <button
        type="button"
        class="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-white/[0.03] px-3 text-sm text-[var(--color-ink)] transition hover:border-white/20 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
        aria-haspopup="dialog"
        aria-label={`${unread} alerte${unread > 1 ? 's' : ''} de surveillance`}
        onClick={() => setOpen(true)}
      >
        <Bell size={16} aria-hidden class="text-[var(--color-accent)]" />
        <span>{alertsBadge(unread)}</span>
      </button>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          reload();
        }}
        title="Alertes de surveillance"
        size="sm"
        padded={false}
        footer={
          <div class="flex gap-2">
            <a href="/app/watches" class="flex-1">
              <Button variant="secondary" class="w-full">
                Mes surveillances
              </Button>
            </a>
            <Button class="flex-1" onClick={() => void markAll()} disabled={unread === 0}>
              Tout marquer lu
            </Button>
          </div>
        }
      >
        {alerts.length === 0 ? (
          <p class="px-4 py-6 text-center text-sm text-[var(--color-ink-muted)]">Aucune alerte.</p>
        ) : (
          <ul class="flex flex-col">
            {alerts.map((a) => (
              <li key={a.uuid}>
                <button
                  type="button"
                  class="flex min-h-[44px] w-full min-w-0 items-start gap-2.5 px-4 py-2.5 text-left transition hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
                  onClick={() => void pick(a)}
                >
                  <span
                    class={cn(
                      'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      a.read_at
                        ? 'bg-[var(--color-ink-faint)]'
                        : a.kind === 'watch_paused'
                          ? 'bg-[var(--color-danger)]'
                          : 'bg-[var(--color-accent)]',
                    )}
                    aria-hidden
                  />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium text-[var(--color-ink)]">{a.title}</span>
                    <span class="block text-[12px] leading-snug text-[var(--color-ink-muted)] [overflow-wrap:anywhere]">
                      {a.body}
                    </span>
                    <span class="block text-[11px] text-[var(--color-ink-faint)]">{formatWhen(a.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}
