import { useCallback, useEffect, useState } from 'preact/hooks';
import { ArrowLeft, ChevronRight, CloudUpload, FileDiff, GitPullRequestArrow, History, RotateCcw, Trash2, Undo2 } from 'lucide-preact';
import { api, type DraftDiffFile, type DraftFile, type DraftStatus } from '../lib/api';
import { cn } from '../lib/cn';
import { InlinePatch } from './DiffViewer';
import { Badge, Button, Modal, Spinner, useToast } from './ui';

export function relativeFr(iso?: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const min = Math.round(Math.max(0, Date.now() - t) / 60000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

const STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' | 'accent' }> = {
  added: { label: 'ajouté', tone: 'ok' },
  modified: { label: 'modifié', tone: 'accent' },
  deleted: { label: 'supprimé', tone: 'danger' },
  renamed: { label: 'renommé', tone: 'warn' },
};

export function DraftStatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.modified;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function filesLabel(n: number) {
  return `${n} fichier${n > 1 ? 's' : ''} modifié${n > 1 ? 's' : ''}`;
}

/** État du brouillon, rafraîchi doucement (lecture locale, sans réseau). */
export function useDraft(uuid: string) {
  const [draft, setDraft] = useState<DraftStatus | null>(null);
  const refresh = useCallback(
    async (fetch = false) => {
      try {
        setDraft(await api.draftStatus(uuid, fetch));
      } catch {
        /* silencieux : pas de brouillon affiché */
      }
    },
    [uuid],
  );
  useEffect(() => {
    void refresh(true);
    const id = window.setInterval(() => !document.hidden && void refresh(), 20000);
    const onPreview = () => void refresh();
    window.addEventListener('devforge:preview-refresh', onPreview);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('devforge:preview-refresh', onPreview);
    };
  }, [refresh]);
  return { draft, refresh };
}

/** Bandeau compact : « Brouillon · N fichiers modifiés · il y a X ». */
export function DraftBanner({ draft, onOpen, class: className }: { draft: DraftStatus | null; onOpen: () => void; class?: string }) {
  if (!draft?.available) return null;
  if (!draft.dirty) {
    if (!draft.backups?.length) return null;
    return (
      <button
        type="button"
        class={cn(
          'flex min-h-[44px] w-full items-center gap-2 rounded-xl px-3 text-left text-xs text-[var(--color-ink-faint)] hover:bg-white/5 hover:text-[var(--color-ink)]',
          className,
        )}
        onClick={onOpen}
      >
        <History size={14} aria-hidden />
        Brouillon supprimé récemment · restaurable 7 jours
        <ChevronRight size={14} class="ml-auto" aria-hidden />
      </button>
    );
  }
  const when = relativeFr(draft.updated_at);
  return (
    <button
      type="button"
      class={cn(
        'flex min-h-[48px] w-full items-center gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] px-3.5 py-2 text-left transition hover:bg-amber-500/[0.12]',
        className,
      )}
      onClick={onOpen}
      aria-label={`Brouillon : ${filesLabel(draft.count)}. Voir et gérer.`}
    >
      <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-[var(--color-warn)]">
        <FileDiff size={16} aria-hidden />
      </span>
      <span class="min-w-0 flex-1 leading-tight">
        <span class="block text-sm font-semibold text-[var(--color-ink)]">
          Brouillon · {filesLabel(draft.count)}
          {when ? <span class="font-normal text-[var(--color-ink-muted)]"> · {when}</span> : null}
        </span>
        <span class="block truncate text-xs text-[var(--color-ink-faint)]">
          {draft.behind > 0
            ? `GitHub a avancé de ${draft.behind} commit${draft.behind > 1 ? 's' : ''} · à mettre à jour`
            : 'Pas encore sur GitHub · valider ou supprimer'}
        </span>
      </span>
      <ChevronRight size={16} class="shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
    </button>
  );
}

type Step = 'list' | 'file' | 'validate' | 'validated' | 'discard';

type ModalProps = {
  open: boolean;
  onClose: () => void;
  uuid: string;
  name: string;
  draft: DraftStatus | null;
  onChanged: () => Promise<void> | void;
  /** Mise en ligne explicite après validation. Absent : pas de proposition. */
  onDeployNow?: () => Promise<void>;
};

export function DraftModal({ open, onClose, uuid, name, draft, onChanged, onDeployNow }: ModalProps) {
  const toast = useToast();
  const [step, setStep] = useState<Step>('list');
  const [diff, setDiff] = useState<DraftDiffFile[] | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [validated, setValidated] = useState<{ sha: string; files: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep('list');
    setError(null);
    setValidated(null);
    setMessage(draft?.suggested_message ?? '');
    setDiff(null);
    setDiffError(null);
    if (draft?.dirty) {
      api
        .draftDiff(uuid)
        .then((r) => setDiff(r.files))
        .catch((e) => setDiffError(e instanceof Error ? e.message : String(e)));
    }
  }, [open, uuid]);

  const files: DraftFile[] = draft?.files ?? [];
  const stat = (p: string) => diff?.find((d) => d.path === p);
  const file = current ? stat(current) ?? files.find((f) => f.path === current) : null;

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const restore = (backupId: string) =>
    run('restore', async () => {
      const r = await api.draftRestore(uuid, backupId);
      toast.push({ title: 'Brouillon restauré', detail: `${r.files} fichier${r.files > 1 ? 's' : ''} remis`, tone: 'ok' });
      await onChanged();
    });

  const validate = () =>
    run('validate', async () => {
      const r = await api.draftValidate(uuid, message);
      setValidated({ sha: r.sha, files: r.files });
      setStep('validated');
      await onChanged();
    });

  const discard = () =>
    run('discard', async () => {
      const r = await api.draftDiscard(uuid);
      await onChanged();
      onClose();
      toast.push({
        title: 'Brouillon supprimé',
        detail: `${r.files} fichier${r.files > 1 ? 's' : ''} · sauvegarde gardée 7 jours`,
        tone: 'warn',
        action: {
          label: 'Annuler',
          onClick: () => {
            void api
              .draftRestore(uuid, r.backup_id)
              .then(() => {
                toast.push({ title: 'Brouillon restauré', tone: 'ok' });
                return onChanged();
              })
              .catch((e) => toast.push({ title: 'Restauration impossible', detail: String(e), tone: 'danger' }));
          },
        },
      });
    });

  const revert = (path: string) =>
    run('revert', async () => {
      const r = await api.draftRevertFile(uuid, path);
      setConfirmRevert(false);
      setStep('list');
      setDiff((d) => d?.filter((x) => x.path !== path) ?? null);
      await onChanged();
      toast.push({
        title: 'Fichier remis comme sur GitHub',
        detail: path,
        tone: 'info',
        action: { label: 'Annuler', onClick: () => void restore(r.backup_id) },
      });
    });

  const update = () =>
    run('update', async () => {
      const r = await api.draftUpdateFromGithub(uuid);
      toast.push({
        title: r.merged ? 'Brouillon à jour' : 'Déjà à jour',
        detail: r.merged ? `${r.merged} commit${r.merged > 1 ? 's' : ''} récupéré${r.merged > 1 ? 's' : ''} depuis GitHub` : undefined,
        tone: 'ok',
      });
      await onChanged();
    });

  const titles: Record<Step, string> = {
    list: draft?.dirty ? `Brouillon · ${filesLabel(draft.count)}` : 'Brouillon',
    file: file?.path.split('/').pop() || 'Fichier',
    validate: 'Valider le brouillon ?',
    validated: 'C’est sur GitHub ✅',
    discard: 'Supprimer le brouillon ?',
  };
  const descriptions: Partial<Record<Step, string>> = {
    list: draft?.dirty
      ? `Changements de ${name} faits en local, pas encore sur GitHub (branche ${draft.branch}).`
      : 'Aucun changement local en attente.',
    validate: `Envoie ces changements sur GitHub (branche ${draft?.branch ?? 'main'}). L’app en ligne ne change pas tant que tu ne la mets pas en ligne.`,
    discard: 'Le dossier de travail revient exactement à l’état de GitHub.',
  };

  const footer = (() => {
    const cls = 'max-sm:flex-1 max-lg:h-11';
    if (step === 'list' && draft?.dirty) {
      return (
        <div class="flex w-full flex-wrap gap-2 sm:justify-end">
          <Button size="sm" variant="ghost" class={cn(cls, 'text-[var(--color-danger)]')} disabled={!!busy} onClick={() => setStep('discard')}>
            <Trash2 size={14} aria-hidden />
            Supprimer
          </Button>
          <Button
            size="sm"
            class={cls}
            disabled={!!busy || draft.behind > 0 || !draft.has_remote}
            title={draft.behind > 0 ? 'Mets d’abord à jour depuis GitHub' : undefined}
            onClick={() => setStep('validate')}
          >
            <CloudUpload size={14} aria-hidden />
            Valider
          </Button>
        </div>
      );
    }
    if (step === 'validate') {
      return (
        <div class="flex w-full gap-2 sm:justify-end">
          <Button size="sm" variant="ghost" class={cls} disabled={!!busy} onClick={() => setStep('list')}>
            Retour
          </Button>
          <Button size="sm" class={cls} disabled={!!busy || !message.trim()} onClick={() => void validate()}>
            {busy === 'validate' ? <Spinner /> : <CloudUpload size={14} aria-hidden />}
            Valider et envoyer
          </Button>
        </div>
      );
    }
    if (step === 'validated') {
      return (
        <div class="flex w-full gap-2 sm:justify-end">
          <Button size="sm" variant="ghost" class={cls} disabled={!!busy} onClick={onClose}>
            Plus tard
          </Button>
          {onDeployNow && (
            <Button
              size="sm"
              class={cls}
              disabled={!!busy}
              onClick={() =>
                void run('deploy', async () => {
                  await onDeployNow();
                  onClose();
                })
              }
            >
              {busy === 'deploy' ? <Spinner /> : <CloudUpload size={14} aria-hidden />}
              Mettre en ligne
            </Button>
          )}
        </div>
      );
    }
    if (step === 'discard') {
      return (
        <div class="flex w-full gap-2 sm:justify-end">
          <Button size="sm" variant="ghost" class={cls} disabled={!!busy} onClick={() => setStep('list')}>
            Garder
          </Button>
          <Button size="sm" variant="danger" class={cls} disabled={!!busy} onClick={() => void discard()}>
            {busy === 'discard' ? <Spinner /> : <Trash2 size={14} aria-hidden />}
            Supprimer le brouillon
          </Button>
        </div>
      );
    }
    return (
      <Button size="sm" variant="ghost" class="max-lg:h-11" onClick={step === 'file' ? () => setStep('list') : onClose}>
        {step === 'file' ? 'Retour' : 'Fermer'}
      </Button>
    );
  })();

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={titles[step]}
      description={descriptions[step]}
      size={step === 'file' ? 'xl' : 'md'}
      class="df-tap"
      footer={footer}
    >
      {error && <p class="mb-3 rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

      {step === 'list' && (
        <div class="space-y-4">
          {draft?.dirty && draft.behind > 0 && (
            <div class="flex flex-col gap-2 rounded-xl border border-sky-500/25 bg-sky-500/[0.07] p-3 text-sm sm:flex-row sm:items-center">
              <p class="flex-1 text-[var(--color-ink-muted)]">
                GitHub a {draft.behind} commit{draft.behind > 1 ? 's' : ''} que le brouillon n’a pas. Mets à jour avant de valider.
              </p>
              <Button size="sm" variant="secondary" class="max-lg:h-11" disabled={!!busy} onClick={() => void update()}>
                {busy === 'update' ? <Spinner /> : <GitPullRequestArrow size={14} aria-hidden />}
                Mettre à jour depuis GitHub
              </Button>
            </div>
          )}
          {draft?.preview?.running && draft.preview.url && (
            <a
              href={draft.preview.url}
              target="_blank"
              rel="noreferrer"
              class="flex min-h-[44px] items-center gap-2 rounded-xl border border-[var(--color-line)] px-3 text-sm text-[var(--color-accent)] hover:bg-white/5"
            >
              Voir l’aperçu du brouillon
              <ChevronRight size={14} class="ml-auto" aria-hidden />
            </a>
          )}
          {files.length > 0 && (
            <ul class="divide-y divide-[var(--color-line)] overflow-hidden rounded-xl border border-[var(--color-line)]">
              {files.map((f) => {
                const s = stat(f.path);
                return (
                  <li key={f.path}>
                    <button
                      type="button"
                      class="flex min-h-[52px] w-full items-center gap-3 px-3 py-2 text-left hover:bg-white/5"
                      onClick={() => {
                        setCurrent(f.path);
                        setConfirmRevert(false);
                        setStep('file');
                      }}
                    >
                      <span class="min-w-0 flex-1">
                        <span class="block break-all font-mono text-[12.5px] leading-snug text-[var(--color-ink)]">{f.path}</span>
                        {f.old_path && <span class="block truncate text-[11px] text-[var(--color-ink-faint)]">← {f.old_path}</span>}
                      </span>
                      {s && (
                        <span class="hidden shrink-0 font-mono text-[11px] sm:inline">
                          <span class="text-emerald-400/90">+{s.additions}</span> <span class="text-rose-400/90">−{s.deletions}</span>
                        </span>
                      )}
                      <DraftStatusBadge status={f.status} />
                      <ChevronRight size={14} class="shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {diffError && <p class="text-xs text-[var(--color-ink-faint)]">Diff indisponible : {diffError}</p>}
          {draft && draft.junk_count > 0 && (
            <p class="text-xs text-[var(--color-ink-faint)]">
              {draft.junk_count} fichier{draft.junk_count > 1 ? 's' : ''} technique{draft.junk_count > 1 ? 's' : ''} ignoré{draft.junk_count > 1 ? 's' : ''} (aperçu, build, secrets) : jamais envoyés.
            </p>
          )}
          {!!draft?.backups?.length && (
            <div>
              <h3 class="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">Sauvegardes (7 jours)</h3>
              <ul class="divide-y divide-[var(--color-line)] rounded-xl border border-[var(--color-line)]">
                {draft.backups.map((b) => (
                  <li key={b.id} class="flex min-h-[48px] items-center gap-3 px-3 py-1.5 text-sm">
                    <span class="min-w-0 flex-1 leading-tight">
                      <span class="block text-[var(--color-ink)]">
                        {b.reason === 'revert-file' ? 'Fichier annulé' : 'Brouillon supprimé'} · {relativeFr(b.created_at)}
                      </span>
                      <span class="block truncate text-xs text-[var(--color-ink-faint)]">
                        {[...b.files, ...b.deleted].slice(0, 3).join(', ')}
                        {b.files.length + b.deleted.length > 3 ? ` +${b.files.length + b.deleted.length - 3}` : ''}
                      </span>
                    </span>
                    <Button size="sm" variant="secondary" class="max-lg:h-11" disabled={!!busy} onClick={() => void restore(b.id)}>
                      {busy === 'restore' ? <Spinner /> : <RotateCcw size={14} aria-hidden />}
                      Restaurer
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {step === 'file' && file && (
        <div class="space-y-3">
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="inline-flex h-11 w-11 items-center justify-center rounded-lg hover:bg-white/5 lg:h-8 lg:w-8"
              aria-label="Retour à la liste"
              onClick={() => setStep('list')}
            >
              <ArrowLeft size={16} aria-hidden />
            </button>
            <span class="min-w-0 flex-1 break-all font-mono text-[12.5px] text-[var(--color-ink-muted)]">{file.path}</span>
            <DraftStatusBadge status={file.status} />
          </div>
          {confirmRevert ? (
            <div class="flex flex-col gap-2 rounded-xl border border-rose-500/25 bg-rose-500/[0.07] p-3 text-sm sm:flex-row sm:items-center">
              <p class="flex-1 text-[var(--color-ink-muted)]">
                {file.status === 'added' ? 'Ce nouveau fichier sera retiré.' : 'Ce fichier redevient comme sur GitHub.'} Sauvegarde gardée 7 jours.
              </p>
              <div class="flex gap-2">
                <Button size="sm" variant="ghost" class="max-sm:flex-1 max-lg:h-11" onClick={() => setConfirmRevert(false)}>
                  Garder
                </Button>
                <Button size="sm" variant="danger" class="max-sm:flex-1 max-lg:h-11" disabled={!!busy} onClick={() => void revert(file.path)}>
                  {busy === 'revert' ? <Spinner /> : <Undo2 size={14} aria-hidden />}
                  Annuler ce fichier
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="secondary" class="max-lg:h-11" onClick={() => setConfirmRevert(true)}>
              <Undo2 size={14} aria-hidden />
              Annuler ce fichier
            </Button>
          )}
          {diff === null && !diffError ? (
            <div class="flex justify-center py-10">
              <Spinner />
            </div>
          ) : (file as DraftDiffFile).patch ? (
            <InlinePatch patch={(file as DraftDiffFile).patch as string} />
          ) : (
            <p class="text-sm text-[var(--color-ink-muted)]">
              {file.status === 'deleted' ? 'Fichier supprimé dans le brouillon.' : 'Pas d’aperçu (fichier binaire ou trop gros).'}
            </p>
          )}
        </div>
      )}

      {step === 'validate' && (
        <div class="space-y-3">
          <label class="block text-sm">
            <span class="mb-1.5 block text-[var(--color-ink-muted)]">Message (modifiable)</span>
            <textarea
              class="min-h-[88px] w-full rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-bg)] px-3 py-2 text-[15px] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
              value={message}
              maxLength={300}
              onInput={(e) => setMessage((e.target as HTMLTextAreaElement).value)}
            />
          </label>
          <p class="text-sm text-[var(--color-ink-muted)]">
            {filesLabel(files.length)} :{' '}
            <span class="text-[var(--color-ink)]">
              {files
                .slice(0, 4)
                .map((f) => f.path.split('/').pop())
                .join(', ')}
              {files.length > 4 ? ` et ${files.length - 4} autre${files.length - 4 > 1 ? 's' : ''}` : ''}
            </span>
          </p>
        </div>
      )}

      {step === 'validated' && validated && (
        <div class="space-y-2 text-sm text-[var(--color-ink-muted)]">
          <p>
            {filesLabel(validated.files)} envoyé{validated.files > 1 ? 's' : ''} sur GitHub (commit{' '}
            <span class="font-mono text-[var(--color-ink)]">{validated.sha.slice(0, 7)}</span>).
          </p>
          {onDeployNow ? (
            <p class="text-[var(--color-ink)]">Mettre en ligne maintenant ? DevForge reconstruit l’app depuis GitHub puis remplace la version en ligne.</p>
          ) : null}
        </div>
      )}

      {step === 'discard' && (
        <div class="space-y-3 text-sm">
          <p class="text-[var(--color-ink-muted)]">Ces changements seront perdus :</p>
          <ul class="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-rose-500/25 bg-rose-500/[0.05] p-3">
            {files.map((f) => (
              <li key={f.path} class="flex items-center gap-2">
                <span class="min-w-0 flex-1 break-all font-mono text-[12px] text-[var(--color-ink)]">{f.path}</span>
                <DraftStatusBadge status={f.status} />
              </li>
            ))}
          </ul>
          <ul class="list-disc space-y-1 pl-5 text-[var(--color-ink-muted)]">
            <li>L’aperçu du brouillon est arrêté.</li>
            <li>Une sauvegarde est gardée 7 jours (bouton « Annuler » juste après).</li>
            <li>Les dépendances installées et la version en ligne ne bougent pas.</li>
          </ul>
        </div>
      )}
    </Modal>
  );
}

/** Vue globale (page Applications) : toutes les apps avec un brouillon, pour faire le ménage vite. */
export function DraftsSection({ class: className }: { class?: string }) {
  const [items, setItems] = useState<import('../lib/api').DraftSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .drafts()
        .then((r) => !cancelled && setItems(r.drafts ?? []))
        .catch(() => {});
    void load();
    const id = window.setInterval(() => !document.hidden && void load(), 30000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);
  if (!items.length) return null;
  return (
    <section class={cn('mt-6', className)} aria-label="Brouillons en attente">
      <h2 class="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">
        <FileDiff size={14} aria-hidden />
        Brouillons en attente · {items.length}
      </h2>
      <ul class="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((d) => (
          <li key={d.project_uuid}>
            <a
              href={`/app/projects/view?uuid=${encodeURIComponent(d.project_uuid)}&draft=1`}
              class="flex min-h-[56px] items-center gap-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] px-3.5 py-2.5 transition hover:border-amber-500/30 hover:bg-amber-500/[0.05]"
            >
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-sm font-bold text-[var(--color-warn)]">
                {d.project_name.slice(0, 1).toUpperCase()}
              </span>
              <span class="min-w-0 flex-1 leading-tight">
                <span class="block truncate text-sm font-semibold text-[var(--color-ink)]">{d.project_name}</span>
                <span class="block truncate text-xs text-[var(--color-ink-faint)]">
                  {filesLabel(d.count)}
                  {relativeFr(d.updated_at) ? ` · ${relativeFr(d.updated_at)}` : ''}
                  {d.behind > 0 ? ' · GitHub a avancé' : ''}
                </span>
              </span>
              <ChevronRight size={16} class="shrink-0 text-[var(--color-ink-faint)]" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
