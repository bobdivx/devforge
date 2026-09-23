import { useEffect, useState } from 'preact/hooks';
import { X } from 'lucide-preact';
import { api } from '../../lib/api';
import { Button, Input, Portal, Spinner } from '../ui';
import { cn } from '../../lib/cn';

type Props = {
  open: boolean;
  onClose: () => void;
  projectUuid: string;
  variant?: 'sheet' | 'panel';
};

type EnvRow = {
  key: string;
  value: string;
  secret: boolean;
};

export function EnvSheet({ open, onClose, projectUuid, variant = 'sheet' }: Props) {
  const [rows, setRows] = useState<EnvRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const isPanel = variant === 'panel';

  useEffect(() => {
    if (!open || isPanel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, isPanel]);

  useEffect(() => {
    if (open) load();
  }, [open, projectUuid]);

  async function load() {
    setLoading(true);
    try {
      const r = await api.envList(projectUuid);
      setRows(r.data ?? []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function add(e: Event) {
    e.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    try {
      await api.envUpsert(projectUuid, { key: key.trim(), value, secret: true });
      setKey('');
      setValue('');
      await load();
    } catch {
      // Ignorer l'erreur
    } finally {
      setBusy(false);
    }
  }

  async function remove(k: string) {
    setBusy(true);
    try {
      await api.envDelete(projectUuid, k);
      await load();
    } catch {
      // Ignorer l'erreur
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const body = (
    <>
      {!isPanel && (
        <div class="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3 sm:px-5">
          <div class="min-w-0">
            <h2 class="text-base font-medium tracking-tight">Variables d'environnement</h2>
            <p class="mt-0.5 text-xs text-[var(--color-ink-muted)]">
              Injectées par défaut dans le serveur de dev et au prochain déploiement
            </p>
          </div>
          <button
            type="button"
            class="rounded-lg p-1.5 text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)]"
            onClick={onClose}
            aria-label="Fermer"
          >
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
      )}

      <div
        class={cn(
          'min-h-0 flex-1 space-y-3 overflow-y-auto',
          isPanel ? 'h-full p-3 sm:p-4' : 'px-4 py-3 sm:px-5',
        )}
      >
        <form class="flex flex-col gap-2 sm:flex-row" onSubmit={add}>
          <Input
            placeholder="KEY"
            value={key}
            onInput={(e) => setKey((e.target as HTMLInputElement).value)}
            class="flex-1"
          />
          <Input
            placeholder="value"
            value={value}
            onInput={(e) => setValue((e.target as HTMLInputElement).value)}
            class="flex-1"
          />
          <Button type="submit" variant="secondary" disabled={busy} class="shrink-0">
            Ajouter
          </Button>
        </form>

        {loading ? (
          <div class="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
            <Spinner /> Chargement…
          </div>
        ) : rows.length === 0 ? (
          <p class="text-sm text-[var(--color-ink-muted)]">Aucune variable.</p>
        ) : (
          <ul class="space-y-2">
            {rows.map((r) => (
              <li
                key={r.key}
                class="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2"
              >
                <div class="min-w-0 flex-1">
                  <div class="font-mono text-sm">{r.key}</div>
                  <div class="mt-0.5 truncate text-xs text-[var(--color-ink-muted)]">
                    {r.secret ? '••••••••' : r.value}
                  </div>
                </div>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove(r.key)}>
                  Supprimer
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div
        class={cn(
          'flex shrink-0 items-center justify-between gap-2 border-t border-[var(--color-line)] bg-[var(--color-card)]',
          isPanel
            ? 'px-3 py-2 sm:px-4'
            : 'px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:px-5',
        )}
      >
        <Button
          variant="ghost"
          size="sm"
          href={`/app/projects/view?uuid=${encodeURIComponent(projectUuid)}&tab=env`}
        >
          Voir tous les détails
        </Button>
        {!isPanel && (
          <Button variant="ghost" onClick={onClose}>
            Fermer
          </Button>
        )}
      </div>
    </>
  );

  if (isPanel) {
    return <div class="flex h-full min-h-0 flex-col overflow-hidden">{body}</div>;
  }

  return (
    <Portal>
    <div class="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto sm:items-center">
      <button
        type="button"
        aria-label="Fermer"
        class="df-modal-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        class={cn(
          'df-modal-panel relative z-10 flex w-full flex-col overflow-hidden border border-[var(--color-line)] bg-[var(--color-card)] shadow-2xl',
          'max-h-[calc(100dvh-4.5rem-env(safe-area-inset-bottom,0px))] sm:max-h-[80dvh]',
          'rounded-t-2xl border-b-0 sm:rounded-2xl sm:border',
          'max-w-2xl sm:max-w-3xl',
        )}
      >
        {body}
      </div>
    </div>
    </Portal>
  );
}
