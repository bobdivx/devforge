import { useEffect, useMemo, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { SETTINGS_NAV } from '../lib/nav';
import { AppShell } from './AppShell';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  FadeIn,
  ProgressBar,
  PulseDot,
  Spinner,
  useToast,
} from './ui';

type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

type UpdateStep = {
  id: string;
  label: string;
  status: StepStatus;
  detail: string;
};

type UpdateJob = {
  id: string;
  target_version: string;
  status: string;
  steps: UpdateStep[];
  message: string;
  wait_path?: string;
};

type VersionCheck = {
  current: string;
  latest?: string | null;
  latest_name?: string | null;
  latest_url?: string | null;
  update_available: boolean;
  can_apply?: boolean;
  channel: string;
  mode: string;
  repo: string;
  message: string;
};

function stepTone(s: StepStatus): 'ok' | 'warn' | 'accent' | 'muted' {
  if (s === 'done') return 'ok';
  if (s === 'running') return 'accent';
  if (s === 'failed') return 'warn';
  return 'muted';
}

function progressOf(job: UpdateJob | null): number {
  if (!job?.steps?.length) return 0;
  const weight = { pending: 0, running: 0.5, done: 1, failed: 1, skipped: 1 };
  const sum = job.steps.reduce((acc, s) => acc + (weight[s.status] ?? 0), 0);
  return Math.round((sum / job.steps.length) * 100);
}

function modeLabel(mode: string): string {
  if (mode === 'compose') return 'Docker Compose';
  if (mode === 'docker') return 'Docker';
  if (mode === 'binary') return 'Binaire';
  return mode;
}

export function UpdatePage() {
  const toast = useToast();
  const [check, setCheck] = useState<VersionCheck | null>(null);
  const [job, setJob] = useState<UpdateJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadCheck() {
    try {
      const r = await api.updateCheck();
      setCheck(r.data);
      if (r.job) setJob(r.job);
      setError(null);
    } catch (e: unknown) {
      setError(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCheck();
  }, []);

  useEffect(() => {
    if (!job || (job.status !== 'running' && job.status !== 'restarting')) return;
    const t = setInterval(async () => {
      try {
        const r = await api.updateStatus();
        if (r.data) setJob(r.data);
        if (r.data?.status === 'restarting') {
          const path =
            r.data.wait_path ||
            `/app/update/wait?job=${encodeURIComponent(r.data.id)}&to=${encodeURIComponent(r.data.target_version)}`;
          window.location.href = path;
        }
        if (r.data?.status === 'done') {
          toast.push({ title: 'Mise à jour terminée', tone: 'ok' });
        }
        if (r.data?.status === 'failed') {
          toast.push({ title: 'Échec mise à jour', detail: r.data.message, tone: 'danger' });
        }
      } catch {
        /* serveur peut être HS juste avant redirect */
      }
    }, 700);
    return () => clearInterval(t);
  }, [job?.id, job?.status]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.updateStart(
        check?.latest ? { target_version: check.latest } : undefined,
      );
      setJob(r.data);
      toast.push({ title: 'Mise à jour lancée', detail: `→ ${r.data.target_version}`, tone: 'info' });
    } catch (e: unknown) {
      setError(String((e as Error).message || e));
      toast.push({ title: 'Impossible de démarrer', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  const pct = useMemo(() => progressOf(job), [job]);
  const running = job?.status === 'running' || job?.status === 'restarting';
  const canStart =
    !running &&
    !busy &&
    !!check?.update_available &&
    (check.can_apply !== false);

  return (
    <AppShell
      active="settings"
      title="Mise à jour"
      description="Suivi des versions DevForge et mise à jour de l’instance."
      sideNav={SETTINGS_NAV}
      sideNavLabel="Settings"
    >
      <FadeIn>
        <Card>
          <CardHeader
            title="Version"
            action={
              check ? (
                <Badge tone={check.update_available ? 'warn' : 'ok'}>
                  {check.update_available ? 'MAJ dispo' : 'À jour'}
                </Badge>
              ) : null
            }
          />
          {loading ? (
            <div class="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
              <Spinner /> Vérification…
            </div>
          ) : error && !check ? (
            <Alert tone="danger">{error}</Alert>
          ) : check ? (
            <div class="space-y-4">
              <div class="grid gap-3 sm:grid-cols-3">
                <div class="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
                  <div class="text-xs text-[var(--color-ink-muted)]">Actuelle</div>
                  <div class="mt-1 font-mono text-lg">v{check.current}</div>
                </div>
                <div class="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
                  <div class="text-xs text-[var(--color-ink-muted)]">Dernière</div>
                  <div class="mt-1 font-mono text-lg">
                    {check.latest ? `v${check.latest}` : '—'}
                  </div>
                </div>
                <div class="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3">
                  <div class="text-xs text-[var(--color-ink-muted)]">Canal / mode</div>
                  <div class="mt-1 text-sm">
                    {check.channel} · {modeLabel(check.mode)}
                  </div>
                </div>
              </div>
              <p class="text-sm text-[var(--color-ink-muted)]">{check.message}</p>
              {check.latest_url && (
                <a
                  class="text-sm text-[var(--color-accent)] underline-offset-2 hover:underline"
                  href={check.latest_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Notes de version
                </a>
              )}
              {error && <Alert tone="warn">{error}</Alert>}
              {check.mode === 'binary' && (
                <p class="text-xs text-[var(--color-ink-faint)]">
                  Mode binaire : télécharge l’asset GitHub{' '}
                  <code>devforge-server-&lt;triple&gt;.zip</code> puis remplace et relance le
                  process. En prod conteneur, préfère{' '}
                  <code>DEVFORGE_UPDATE_MODE=compose</code>.
                </p>
              )}
              {(check.mode === 'compose' || check.mode === 'docker') && (
                <p class="text-xs text-[var(--color-ink-faint)]">
                  Mode {modeLabel(check.mode)} : pull de l’image puis recreate du service /
                  conteneur (docker.sock requis).
                </p>
              )}
              <div class="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!canStart}
                  onClick={start}
                >
                  {busy ? (
                    <>
                      <Spinner class="mr-2" /> Démarrage…
                    </>
                  ) : (
                    'Mettre à jour DevForge'
                  )}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={loadCheck}>
                  Vérifier
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      </FadeIn>

      {job && (
        <FadeIn delay={80} class="mt-4">
          <Card>
            <CardHeader
              title="Progression"
              action={<Badge tone={job.status === 'failed' ? 'danger' : 'accent'}>{job.status}</Badge>}
            />
            <p class="mb-3 text-sm text-[var(--color-ink-muted)]">{job.message}</p>
            <ProgressBar value={pct} class="mb-5" />
            <ol class="space-y-3">
              {job.steps.map((s, i) => (
                <li
                  key={s.id}
                  class="df-step-in flex gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-3"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <div class="mt-1.5">
                    {s.status === 'running' ? (
                      <Spinner />
                    ) : (
                      <PulseDot tone={stepTone(s.status)} />
                    )}
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-sm font-medium">{s.label}</span>
                      <span class="text-[11px] uppercase tracking-wide text-[var(--color-ink-faint)]">
                        {s.status}
                      </span>
                    </div>
                    {s.detail && (
                      <p class="mt-1 truncate font-mono text-xs text-[var(--color-ink-muted)]">
                        {s.detail}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </FadeIn>
      )}
    </AppShell>
  );
}
