import { useEffect, useMemo, useState } from 'preact/hooks';
import { cn } from '../lib/cn';
import { Badge, Modal, Spinner } from './ui';

export type DiffFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string | null;
  previous_filename?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  loading?: boolean;
  error?: string | null;
  files: DiffFile[];
};

function statusTone(status: string): 'ok' | 'warn' | 'danger' | 'neutral' {
  switch (status) {
    case 'added':
      return 'ok';
    case 'removed':
    case 'deleted':
      return 'danger';
    case 'renamed':
      return 'warn';
    default:
      return 'neutral';
  }
}

function PatchLines({ patch }: { patch: string }) {
  const lines = useMemo(() => patch.split('\n'), [patch]);
  return (
    <pre class="overflow-x-auto rounded-lg bg-[var(--color-bg)] p-3 font-mono text-[11px] leading-relaxed sm:text-xs">
      {lines.map((line, i) => {
        let cls = 'text-[var(--color-ink-muted)]';
        if (line.startsWith('+') && !line.startsWith('+++')) {
          cls = 'bg-emerald-500/10 text-emerald-300';
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          cls = 'bg-rose-500/10 text-rose-300';
        } else if (line.startsWith('@@')) {
          cls = 'text-sky-400/90';
        } else if (line.startsWith('+++') || line.startsWith('---')) {
          cls = 'text-[var(--color-ink-faint)]';
        }
        return (
          <div key={i} class={cn('whitespace-pre-wrap break-all', cls)}>
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}

/** Patch unifié inline (chat agent). */
export function InlinePatch({ patch, class: className }: { patch: string; class?: string }) {
  return (
    <div class={className}>
      <PatchLines patch={patch} />
    </div>
  );
}

export function DiffViewer({
  open,
  onClose,
  title,
  description,
  loading,
  error,
  files,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(files[0]?.filename ?? null);
  }, [open, files]);

  const current = files.find((f) => f.filename === selected) ?? files[0];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="xl"
      bodyClass="!p-0"
      footer={
        <button
          type="button"
          class="rounded-lg px-3 py-1.5 text-sm text-[var(--color-ink-muted)] hover:bg-white/5"
          onClick={onClose}
        >
          Fermer
        </button>
      }
    >
      {loading ? (
        <div class="flex justify-center py-16">
          <Spinner />
        </div>
      ) : error ? (
        <p class="px-5 py-8 text-sm text-rose-300">{error}</p>
      ) : files.length === 0 ? (
        <p class="px-5 py-8 text-sm text-[var(--color-ink-muted)]">Aucun fichier modifié.</p>
      ) : (
        <div class="flex min-h-[280px] flex-col md:flex-row md:min-h-[420px]">
          <aside class="max-h-40 shrink-0 overflow-y-auto border-b border-[var(--color-line)] md:max-h-none md:w-64 md:border-b-0 md:border-r">
            <ul class="divide-y divide-[var(--color-line)]">
              {files.map((f) => (
                <li key={f.filename}>
                  <button
                    type="button"
                    class={cn(
                      'flex w-full flex-col gap-1 px-3 py-2.5 text-left text-xs hover:bg-white/5',
                      current?.filename === f.filename && 'bg-white/5',
                    )}
                    onClick={() => setSelected(f.filename)}
                  >
                    <span class="truncate font-mono text-[var(--color-ink)]">{f.filename}</span>
                    <span class="flex flex-wrap items-center gap-1.5">
                      <Badge tone={statusTone(f.status)}>{f.status}</Badge>
                      <span class="font-mono text-[10px] text-emerald-400/90">+{f.additions}</span>
                      <span class="font-mono text-[10px] text-rose-400/90">−{f.deletions}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <div class="min-w-0 flex-1 overflow-y-auto p-3 sm:p-4">
            {current ? (
              <>
                <div class="mb-3 flex flex-wrap items-center gap-2">
                  <span class="font-mono text-sm text-[var(--color-ink)]">{current.filename}</span>
                  <Badge tone={statusTone(current.status)}>{current.status}</Badge>
                </div>
                {current.patch ? (
                  <PatchLines patch={current.patch} />
                ) : (
                  <p class="text-sm text-[var(--color-ink-muted)]">
                    Pas de patch (fichier binaire ou trop volumineux).
                  </p>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}
    </Modal>
  );
}
