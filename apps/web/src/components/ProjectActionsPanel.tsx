import { useEffect, useState } from 'preact/hooks';
import { api, type ManagedRunner } from '../lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  FadeIn,
  Spinner,
  useToast,
} from './ui';

type WorkflowInfo = {
  name: string;
  path: string;
  uses_devforge: boolean;
  runs_on: string[];
  skipped_dynamic: boolean;
};

type WorkflowRun = {
  id: number;
  name: string;
  status: string;
  conclusion?: string | null;
  html_url: string;
  branch?: string | null;
};

type ActionsSummary = {
  ok: boolean;
  available: boolean;
  reason?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  has_workflows?: boolean;
  needs_patch?: boolean;
  workflows?: WorkflowInfo[];
  runs?: WorkflowRun[];
  runners?: ManagedRunner[];
};

function runTone(status: string, conclusion?: string | null): 'ok' | 'warn' | 'danger' | 'neutral' | 'accent' {
  if (status === 'in_progress' || status === 'queued') return 'accent';
  if (conclusion === 'success') return 'ok';
  if (conclusion === 'failure' || conclusion === 'cancelled') return 'danger';
  if (conclusion === 'skipped') return 'neutral';
  return 'warn';
}

export function ProjectActionsPanel({
  projectUuid,
  gitRepository,
}: {
  projectUuid: string;
  gitRepository?: string | null;
}) {
  const toast = useToast();
  const [data, setData] = useState<ActionsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await api.projectActions(projectUuid);
      setData(r);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 20000);
    return () => clearInterval(t);
  }, [projectUuid]);

  async function ensureRunner() {
    setBusy(true);
    try {
      const r = await api.projectActionsEnsureRunner(projectUuid);
      toast.push({
        title: r.created ? 'Runner en cours de création' : 'Runner déjà prêt',
        detail: r.message,
        tone: 'info',
      });
      await load();
    } catch (e) {
      toast.push({ title: 'Runner KO', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function patchWorkflows(dryRun: boolean) {
    setBusy(true);
    try {
      const r = await api.projectActionsUseDevforge(projectUuid, dryRun);
      const n = (r.patched ?? []).length;
      toast.push({
        title: dryRun ? 'Simulation' : 'Workflows mis à jour',
        detail: r.message || `${n} fichier(s)`,
        tone: n > 0 ? 'info' : 'warn',
      });
      if (!dryRun) await load();
    } catch (e) {
      toast.push({ title: 'Patch KO', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) {
    return (
      <div class="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (!gitRepository || data?.available === false) {
    return (
      <Alert tone="warn">
        Lie un dépôt GitHub dans Settings du projet pour détecter les Actions.
      </Alert>
    );
  }

  if (error) {
    return (
      <Alert tone="warn" class="mb-4">
        {error}
      </Alert>
    );
  }

  const workflows = data?.workflows ?? [];
  const runs = data?.runs ?? [];
  const runners = data?.runners ?? [];
  const hasWf = !!data?.has_workflows;

  return (
    <div class="space-y-6">
      <FadeIn>
        <Card>
          <CardHeader
            title="GitHub Actions"
            description={
              data?.owner && data?.repo
                ? `${data.owner}/${data.repo}${data.branch ? ` @ ${data.branch}` : ''}`
                : 'Détection workflows + runners DevForge'
            }
          />
          {!hasWf ? (
            <p class="text-sm text-[var(--color-ink-muted)]">
              Aucun fichier dans <code class="font-mono text-xs">.github/workflows</code>.
            </p>
          ) : (
            <div class="flex flex-wrap items-center gap-2">
              <Badge tone={data?.needs_patch ? 'warn' : 'ok'}>
                {workflows.length} workflow{workflows.length > 1 ? 's' : ''}
                {data?.needs_patch ? ' · à adapter' : ' · DevForge OK'}
              </Badge>
              <Badge tone={runners.length > 0 ? 'ok' : 'warn'}>
                {runners.length > 0
                  ? `${runners.length} runner${runners.length > 1 ? 's' : ''}`
                  : 'pas de runner'}
              </Badge>
            </div>
          )}

          <div class="mt-4 flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || !hasWf} onClick={() => void ensureRunner()}>
              {runners.length > 0 ? 'Runner prêt' : 'Créer le runner'}
            </Button>
            {hasWf && data?.needs_patch && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void patchWorkflows(true)}
                >
                  Prévisualiser le patch
                </Button>
                <Button size="sm" disabled={busy} onClick={() => void patchWorkflows(false)}>
                  Utiliser runners DevForge
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void load()}>
              Rafraîchir
            </Button>
            <a
              href="/app/runners"
              class="inline-flex items-center rounded-lg px-3 py-1.5 text-sm text-[var(--color-accent)] hover:underline"
            >
              Voir tous les runners →
            </a>
          </div>
        </Card>
      </FadeIn>

      {hasWf && (
        <FadeIn delay={40}>
          <Card>
            <CardHeader title="Workflows" description=".github/workflows" />
            <ul class="divide-y divide-[var(--color-line)]">
              {workflows.map((w) => (
                <li key={w.path} class="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                  <div class="min-w-0">
                    <div class="font-medium">{w.name}</div>
                    <div class="font-mono text-xs text-[var(--color-ink-faint)]">{w.path}</div>
                    {w.runs_on.length > 0 && (
                      <div class="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                        runs-on: {w.runs_on.join(' · ')}
                      </div>
                    )}
                  </div>
                  <div class="flex gap-1.5">
                    {w.uses_devforge ? (
                      <Badge tone="ok">DevForge</Badge>
                    ) : w.skipped_dynamic ? (
                      <Badge tone="warn">dynamique</Badge>
                    ) : (
                      <Badge tone="neutral">cloud</Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </FadeIn>
      )}

      <FadeIn delay={80}>
        <div class="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Runs récents" description="Suivi Actions" />
            {runs.length === 0 ? (
              <p class="text-sm text-[var(--color-ink-muted)]">Aucun run récent.</p>
            ) : (
              <ul class="divide-y divide-[var(--color-line)]">
                {runs.slice(0, 12).map((r) => (
                  <li key={r.id} class="py-2">
                    <a
                      href={r.html_url}
                      target="_blank"
                      rel="noreferrer"
                      class="text-sm font-medium text-[var(--color-accent)] hover:underline"
                    >
                      {r.name}
                    </a>
                    <div class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-faint)]">
                      <Badge tone={runTone(r.status, r.conclusion)}>
                        {r.conclusion || r.status}
                      </Badge>
                      {r.branch && <span>{r.branch}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Runners liés" description="self-hosted · labels devforge" />
            {runners.length === 0 ? (
              <p class="text-sm text-[var(--color-ink-muted)]">
                Aucun runner pour ce projet. Clique « Créer le runner » pour en démarrer un.
              </p>
            ) : (
              <ul class="divide-y divide-[var(--color-line)]">
                {runners.map((r) => (
                  <li key={r.id} class="flex justify-between gap-2 py-2">
                    <div>
                      <div class="font-medium">{r.runner_name}</div>
                      <div class="font-mono text-xs text-[var(--color-ink-faint)]">
                        {r.live_state} · {r.op_status}
                        {r.github_status ? ` · gh:${r.github_status}` : ''}
                      </div>
                    </div>
                    <Badge tone={r.live_state === 'running' ? 'ok' : 'warn'}>{r.live_state}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </FadeIn>
    </div>
  );
}
