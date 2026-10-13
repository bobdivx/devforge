import { useCallback, useEffect, useState } from 'preact/hooks';
import { Check, ChevronDown, ChevronRight, CircleAlert, CircleDashed, FileText, Loader2, RotateCcw, Wrench, X } from 'lucide-preact';
import { api, type Correction, type CorrectionsState, type CorrectionStep } from '../lib/api';
import { cn } from '../lib/cn';
import { InlinePatch } from './DiffViewer';
import { Button, Modal, Spinner, useToast } from './ui';

/** Lien direct vers la correction d'une app (notifications, autres écrans). */
export function correctionsHref(uuid: string): string {
  return `/app/projects/view?uuid=${encodeURIComponent(uuid)}&tab=workspace&corrections=1`;
}

export function useCorrections(uuid: string) {
  const [data, setData] = useState<CorrectionsState | null>(null);
  const refresh = useCallback(async () => {
    try {
      setData(await api.corrections(uuid));
    } catch {
      /* pas de dossier de travail : tuile neutre */
    }
  }, [uuid]);
  useEffect(() => {
    void refresh();
    const t = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(t);
  }, [refresh]);
  return { data, refresh };
}

const TONE: Record<string, string> = {
  testing: 'text-[var(--color-ink-muted)]',
  proposed: 'text-[var(--color-warn)]',
  conflict: 'text-[var(--color-danger)]',
  deploying: 'text-[var(--color-accent)]',
  live: 'text-[var(--color-ok)]',
  failed: 'text-[var(--color-danger)]',
};

/** Statut d'une ligne pour la tuile : la correction en cours, sinon la dernière. */
export function correctionsStatus(data: CorrectionsState | null): { text: string; tone: string } {
  const c = data?.current ?? data?.history?.[0] ?? null;
  if (!c) return { text: 'Rien en attente', tone: 'text-[var(--color-ink-muted)]' };
  const label = data?.current ? `${c.status_label} · ${c.persona}` : `Dernière : ${c.status_label.toLowerCase()}`;
  return { text: label, tone: TONE[c.stage] ?? 'text-[var(--color-ink-muted)]' };
}

function StepIcon({ state }: { state: string }) {
  if (state === 'done') return <Check size={14} aria-hidden />;
  if (state === 'failed') return <X size={14} aria-hidden />;
  if (state === 'active') return <Loader2 size={14} class="animate-spin" aria-hidden />;
  return <CircleDashed size={14} aria-hidden />;
}

export function Stepper({ steps }: { steps: CorrectionStep[] }) {
  return (
    <ol class="flex w-full items-start" aria-label="Étapes de la correction">
      {steps.map((s, i) => (
        <li key={s.key} class="flex min-w-0 flex-1 flex-col items-center text-center">
          <div class="flex w-full items-center">
            <span class={cn('h-px flex-1', i === 0 ? 'opacity-0' : 'bg-[var(--color-line-strong)]')} />
            <span
              class={cn(
                'grid h-7 w-7 shrink-0 place-items-center rounded-full ring-1 ring-inset',
                s.state === 'done' && 'bg-[var(--color-ok)]/15 text-[var(--color-ok)] ring-[var(--color-ok)]/40',
                s.state === 'failed' && 'bg-[var(--color-danger)]/15 text-[var(--color-danger)] ring-[var(--color-danger)]/40',
                s.state === 'active' && 'bg-[var(--color-accent)]/15 text-[var(--color-accent)] ring-[var(--color-accent)]/40',
                (s.state === 'todo' || s.state === 'skipped') && 'text-[var(--color-ink-faint)] ring-[var(--color-line-strong)]',
              )}
            >
              <StepIcon state={s.state} />
            </span>
            <span class={cn('h-px flex-1', i === steps.length - 1 ? 'opacity-0' : 'bg-[var(--color-line-strong)]')} />
          </div>
          <span class="mt-1 line-clamp-2 px-0.5 text-[11px] leading-tight text-[var(--color-ink-muted)]">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

function FileRow({ uuid, path, live }: { uuid: string; path: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  const [patch, setPatch] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && patch === null && live) {
      setBusy(true);
      try {
        const r = await api.draftDiff(uuid, path);
        setPatch(r.files?.[0]?.patch ?? '');
      } catch {
        setPatch('');
      } finally {
        setBusy(false);
      }
    }
  }
  return (
    <li class="min-w-0">
      <button
        type="button"
        class="flex min-h-[44px] w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-white/[0.04] sm:min-h-[36px]"
        onClick={() => void toggle()}
        aria-expanded={open}
        disabled={!live}
      >
        <FileText size={16} class="shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
        <span class="min-w-0 flex-1 truncate font-mono text-[12.5px]" title={path}>{path}</span>
        {live ? open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden /> : null}
      </button>
      {open && (
        <div class="mx-1 mb-2 max-h-72 overflow-auto rounded-lg border border-[var(--color-line)] bg-black/30 text-[12px]">
          {busy ? <div class="p-3"><Spinner /></div> : patch ? <InlinePatch patch={patch} /> : <p class="p-3 text-[var(--color-ink-muted)]">Pas de différence lisible (fichier binaire ou supprimé).</p>}
        </div>
      )}
    </li>
  );
}

function Report({ c, uuid, live }: { c: Correction; uuid: string; live: boolean }) {
  const r = c.report;
  const testTone = r.test_ok === true ? 'text-[var(--color-ok)]' : r.test_ok === false ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink-muted)]';
  return (
    <div class="space-y-3 text-sm">
      {r.broke ? (
        <section>
          <h4 class="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Ce qui a cassé</h4>
          <p class="mt-0.5 break-words">{r.broke}</p>
        </section>
      ) : null}
      <section>
        <h4 class="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Ce que j’ai changé</h4>
        <p class="mt-0.5 break-words">{r.changed}</p>
        {r.files.length > 0 && (
          <ul class="mt-1 -mx-1 space-y-0.5" aria-label="Fichiers modifiés">
            {r.files.map((f) => (
              <FileRow key={f} uuid={uuid} path={f} live={live} />
            ))}
          </ul>
        )}
      </section>
      <section>
        <h4 class="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Test</h4>
        <p class={cn('mt-0.5 break-words', testTone)}>{r.test}</p>
      </section>
      <section class="rounded-xl bg-white/[0.04] p-2.5">
        <h4 class="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Ce que tu dois faire</h4>
        <p class="mt-0.5 break-words font-medium">{r.todo}</p>
      </section>
    </div>
  );
}

type Props = { open: boolean; onClose: () => void; uuid: string; name: string; data: CorrectionsState | null; onChanged: () => Promise<void> | void };

export function CorrectionsModal({ open, onClose, uuid, name, data, onChanged }: Props) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<'apply' | 'reject' | 'redo' | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  const c = data?.current ?? null;
  const conflictMsg = conflict ?? (c?.stage === 'conflict' ? c.note || 'Le code a changé au même endroit.' : null);

  useEffect(() => {
    if (!open) {
      setConfirm(null);
      setConflict(null);
      setDetails(false);
    }
  }, [open]);

  async function run() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm === 'apply') {
        const r = await api.correctionApply(uuid);
        if (r.conflict) {
          setConflict(r.message ?? 'Conflit.');
        } else {
          toast.push({ title: r.deployed ? 'Correction appliquée' : 'Correction envoyée', detail: r.deployed ? 'Mise en ligne en cours…' : 'Pas de nouvelle tentative automatique.', tone: 'info' });
        }
      } else if (confirm === 'reject') {
        await api.correctionReject(uuid);
        toast.push({ title: 'Correction rejetée', detail: 'Récupérable pendant 7 jours.', tone: 'info' });
      } else {
        await api.correctionRedo(uuid);
        setConflict(null);
        toast.push({ title: 'Rustine refait la correction', tone: 'info' });
      }
      setConfirm(null);
      await onChanged();
    } catch (e) {
      toast.push({ title: 'Action impossible', detail: e instanceof Error ? e.message : String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function restore(h: Correction) {
    if (!h.backup_id) return;
    setBusy(true);
    try {
      await api.draftRestore(uuid, h.backup_id);
      toast.push({ title: 'Correction remise', tone: 'info' });
      await onChanged();
    } catch (e) {
      toast.push({ title: 'Restauration impossible', detail: e instanceof Error ? e.message : String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  const canAct = !!c && (c.stage === 'proposed' || c.stage === 'conflict' || c.stage === 'testing');
  const confirmText: Record<string, string> = {
    apply: `Appliquer cette correction et mettre ${name} en ligne ?`,
    reject: 'Rejeter cette correction ? Elle reste récupérable 7 jours.',
    redo: 'Mettre cette correction de côté et laisser Rustine la refaire sur le code à jour ?',
  };

  const footer = !c || !canAct ? undefined : confirm ? (
    <div class="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
      <p class="min-w-0 flex-1 text-sm">{confirmText[confirm]}</p>
      <div class="flex gap-2">
        <Button size="sm" variant="ghost" class="max-sm:flex-1 h-11 sm:h-10" disabled={busy} onClick={() => setConfirm(null)}>Annuler</Button>
        <Button size="sm" class="max-sm:flex-1 h-11 sm:h-10" disabled={busy} onClick={() => void run()}>
          {busy ? <Spinner /> : <Check size={18} aria-hidden />} Confirmer
        </Button>
      </div>
    </div>
  ) : (
    <div class="flex w-full gap-2 sm:justify-end">
      <Button size="sm" variant="ghost" class="max-sm:flex-1 h-11 sm:h-10" onClick={() => setConfirm('reject')}>
        <X size={18} aria-hidden /> Rejeter
      </Button>
      {conflictMsg ? (
        <Button size="sm" class="max-sm:flex-1 h-11 sm:h-10" onClick={() => setConfirm('redo')}>
          <Wrench size={18} aria-hidden /> Laisser Rustine refaire
        </Button>
      ) : (
        <Button size="sm" class="max-sm:flex-1 h-11 sm:h-10" disabled={c.stage === 'testing'} onClick={() => setConfirm('apply')}>
          <Check size={18} aria-hidden /> Appliquer
        </Button>
      )}
    </div>
  );

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="Corrections" description={name} size="md" footer={footer}>
      <div class="min-w-0 space-y-4">
        {c ? (
          <article class="min-w-0 space-y-3">
            <header class="min-w-0">
              <p class="text-sm text-[var(--color-ink-muted)]">
                Correction proposée par <span class="font-semibold text-[var(--color-ink)]">{c.persona}</span>
                <span class={cn('ml-2 text-xs font-semibold', TONE[c.stage])}>{c.status_label}</span>
              </p>
              <p class="mt-1 break-words text-base font-medium">{c.summary}</p>
            </header>
            <Stepper steps={c.steps} />
            {conflictMsg && (
              <div class="flex gap-2 rounded-xl border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/[0.07] p-3 text-sm">
                <CircleAlert size={18} class="shrink-0 text-[var(--color-danger)]" aria-hidden />
                <p class="min-w-0 break-words">{conflictMsg}</p>
              </div>
            )}
            <Report c={c} uuid={uuid} live />
            {c.message ? (
              <div>
                <button type="button" class="inline-flex min-h-[44px] items-center gap-1 text-xs text-[var(--color-ink-faint)] hover:underline sm:min-h-0" onClick={() => setDetails(!details)} aria-expanded={details}>
                  {details ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />} Détails
                </button>
                {details && <p class="mt-1 break-words font-mono text-[12px] text-[var(--color-ink-muted)]">{c.message}</p>}
              </div>
            ) : null}
          </article>
        ) : (
          <p class="text-sm text-[var(--color-ink-muted)]">Aucune correction en attente. Quand une mise en ligne échoue, Rustine prépare et teste une correction, puis te prévient.</p>
        )}
        {data?.history?.length ? (
          <section class="min-w-0">
            <h4 class="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">Historique</h4>
            <ul class="divide-y divide-[var(--color-line)]">
              {data.history.map((h) => (
                <li key={h.id} class="flex min-w-0 items-center gap-2 py-2 text-sm">
                  <span class={cn('w-24 shrink-0 text-xs font-semibold', TONE[h.stage] ?? 'text-[var(--color-ink-faint)]')}>{h.status_label}</span>
                  <span class="min-w-0 flex-1 truncate" title={h.note || h.summary}>{h.summary}</span>
                  {h.restorable && !c ? (
                    <Button size="sm" variant="ghost" class="h-10 shrink-0" disabled={busy} onClick={() => void restore(h)} aria-label="Remettre cette correction">
                      <RotateCcw size={18} aria-hidden />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
