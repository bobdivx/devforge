import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { Alert, Badge, Button, Card, ProgressBar, Spinner } from './ui';

type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

type UpdateStep = {
  id: string;
  label: string;
  status: string;
  detail: string;
};

type UpdateJob = {
  id: string;
  target_version: string;
  status: string;
  steps: UpdateStep[];
  message: string;
};

type VersionCheck = {
  current: string;
  latest?: string | null;
  update_available: boolean;
  can_apply?: boolean;
  mode: string;
  message: string;
};

function prettyVersion(v: string): string {
  const t = v.trim().replace(/^v/i, '');
  return t ? `v${t}` : '—';
}

function pathNote(mode: string): string {
  if (mode === 'compose') {
    return 'Ce nœud est lancé avec Compose : la mise à jour tire l’image (compose pull), puis recrée le service.';
  }
  if (mode === 'docker') {
    return 'Ce nœud tourne dans Docker : la mise à jour tire l’image, puis recrée le conteneur.';
  }
  if (mode === 'binary') {
    return 'Ce nœud applique l’installateur local.';
  }
  return 'La mise à jour part de cette machine : compose pull si elle est lancée ainsi, sinon l’installateur local.';
}

function progressOf(job: UpdateJob | null): number {
  if (!job?.steps?.length) return 0;
  const weight: Record<string, number> = {
    pending: 0,
    running: 0.5,
    done: 1,
    failed: 1,
    skipped: 1,
  };
  const sum = job.steps.reduce((acc, s) => acc + (weight[s.status] ?? 0), 0);
  return Math.round((sum / job.steps.length) * 100);
}

function stepLabel(status: string): string {
  switch (status as StepStatus) {
    case 'running':
      return 'en cours';
    case 'done':
      return 'fait';
    case 'failed':
      return 'échec';
    case 'skipped':
      return 'ignoré';
    default:
      return 'en attente';
  }
}

function activeJob(job: UpdateJob | null): boolean {
  return job?.status === 'running' || job?.status === 'restarting';
}

export function WorkerNodeUpdate({
  versionHint,
  embedded = false,
}: {
  versionHint: string;
  /** Sans carte : le contenu vit dans un Modal. */
  embedded?: boolean;
}) {
  const [check, setCheck] = useState<VersionCheck | null>(null);
  const [job, setJob] = useState<UpdateJob | null>(null);
  const [mode, setMode] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [restartNote, setRestartNote] = useState<string | null>(null);

  async function loadCheck() {
    try {
      const r = await api.updateCheck();
      setCheck(r.data);
      setMode(r.data.mode || '');
      if (r.job) setJob(r.job);
      setActionError(null);
    } catch (e) {
      setActionError(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCheck();
  }, []);

  useEffect(() => {
    if (!activeJob(job)) return;
    const t = window.setInterval(async () => {
      try {
        const r = await api.updateStatus();
        setMode(r.mode || mode);
        if (r.data) {
          setJob(r.data);
          if (r.data.status === 'restarting' || r.data.status === 'done') {
            setRestartNote(null);
          }
        }
      } catch {
        if (job?.status === 'restarting') {
          setRestartNote('DevForge redémarre. Cette page reprend dès que le nœud répond.');
        }
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [job?.id, job?.status]);

  async function start() {
    setBusy(true);
    setActionError(null);
    setRestartNote(null);
    try {
      const r = await api.updateStart(
        check?.latest ? { target_version: check.latest } : undefined,
      );
      setJob(r.data);
    } catch (e) {
      setActionError(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }

  const current = prettyVersion(check?.current || versionHint);
  const running = activeJob(job);
  const failed = job?.status === 'failed';
  const succeeded = job?.status === 'done' || job?.status === 'restarting';
  const showEmpty = !loading && !job && !check?.update_available;

  let badge: { tone: 'ok' | 'warn' | 'danger' | 'accent'; label: string } | null = null;
  if (running) badge = { tone: 'accent', label: 'En cours' };
  else if (failed) badge = { tone: 'danger', label: 'Échec' };
  else if (succeeded) badge = { tone: 'ok', label: 'Terminée' };
  else if (check?.update_available) badge = { tone: 'warn', label: 'Disponible' };
  else if (check) badge = { tone: 'ok', label: 'À jour' };

  const successText =
    restartNote ||
    job?.message ||
    (job?.status === 'restarting' ? 'Redémarrage de DevForge…' : 'Mise à jour terminée.');

  const state = running ? 'progress' : failed || actionError ? 'error' : succeeded ? 'success' : 'empty';

  const body = (
    <>
      <div data-df-update-state={state} class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          {embedded ? null : (
            <h2 class="text-sm font-semibold text-[var(--color-ink)]">Version de ce nœud</h2>
          )}
          <p class="mt-1 text-lg font-semibold text-[var(--color-ink)]" data-df-node-version>
            {current}
          </p>
        </div>
        {badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
      </div>
      <p class="mt-2 text-sm text-[var(--color-ink-muted)]">{pathNote(mode || check?.mode || '')}</p>
      {check?.update_available && check.latest ? (
        <p class="mt-1 text-sm text-[var(--color-ink-muted)]">
          Version publiée {prettyVersion(check.latest)}
        </p>
      ) : null}

      {loading && !job ? (
        <p class="mt-4 flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
          <Spinner /> Vérification des versions…
        </p>
      ) : null}

      {showEmpty ? (
        <div class="mt-4 rounded-xl border border-dashed border-[var(--color-line)] px-4 py-5 text-sm">
          <p class="font-medium text-[var(--color-ink)]">Aucune mise à jour en cours</p>
          <p class="mt-1 leading-relaxed text-[var(--color-ink-muted)]">
            {check?.message || 'Pas encore de résultat. Tu peux lancer la mise à jour de ce nœud.'}
          </p>
        </div>
      ) : null}

      {job ? (
        <div class="mt-4 space-y-3">
          <ProgressBar value={progressOf(job)} />
          <ul class="space-y-2">
            {job.steps.map((step) => (
              <li key={step.id} class="flex items-start justify-between gap-3 text-sm">
                <span class="min-w-0">
                  <span class="text-[var(--color-ink)]">{step.label}</span>
                  {step.detail ? (
                    <span class="mt-0.5 block text-xs text-[var(--color-ink-muted)]">{step.detail}</span>
                  ) : null}
                </span>
                <span class="shrink-0 text-xs text-[var(--color-ink-muted)]">{stepLabel(step.status)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {succeeded ? (
        <div class="mt-4">
          <Alert tone="ok">{successText}</Alert>
        </div>
      ) : null}
      {failed ? (
        <div class="mt-4">
          <Alert tone="danger">{job?.message || 'La mise à jour a échoué.'}</Alert>
        </div>
      ) : null}
      {actionError ? (
        <div class="mt-4">
          <Alert tone="danger">{actionError}</Alert>
        </div>
      ) : null}

      <div class="mt-4">
        <Button class="w-full sm:w-auto" disabled={busy || running} onClick={start}>
          {busy || running ? <Spinner /> : null}
          Mettre à jour
        </Button>
      </div>
    </>
  );

  if (embedded) return body;
  return <Card padding="lg">{body}</Card>;
}
