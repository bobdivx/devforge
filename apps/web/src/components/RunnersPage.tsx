import { useEffect, useState } from 'preact/hooks';
import {
  api,
  runnersEventsUrl,
  type CreateRunnerBody,
  type ManagedRunner,
  type RunnerJob,
  type RunnerLogs,
} from '../lib/api';
import { AppShell } from './AppShell';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  FadeIn,
  Input,
  Modal,
  useToast,
} from './ui';

const IMAGE_PRESETS = [
  {
    image: 'myoung34/github-runner:latest',
    label: 'myoung34',
    hint: 'Recommandé — self-hosted Docker (PAT)',
  },
  {
    image: 'ghcr.io/actions/actions-runner:latest',
    label: 'GitHub officiel',
    hint: 'Image Actions officielle (GHCR)',
  },
  {
    image: 'summerwind/actions-runner:latest',
    label: 'summerwind',
    hint: 'Actions Runner Controller (souvent K8s)',
  },
] as const;

function stateTone(state: string): 'ok' | 'warn' | 'danger' | 'accent' | 'neutral' {
  switch (state) {
    case 'running':
      return 'ok';
    case 'missing':
    case 'exited':
    case 'dead':
      return 'danger';
    case 'pending':
    case 'created':
    case 'restarting':
      return 'warn';
    default:
      return 'neutral';
  }
}

function ghTone(status?: string | null): 'ok' | 'warn' | 'danger' | 'accent' | 'neutral' {
  switch ((status || '').toLowerCase()) {
    case 'online':
      return 'ok';
    case 'busy':
      return 'accent';
    case 'offline':
      return 'danger';
    default:
      return 'neutral';
  }
}

function opLabel(op: string): string | null {
  if (!op || op === 'idle') return null;
  const map: Record<string, string> = {
    creating: 'Création…',
    pulling: 'Pull image…',
    starting: 'Démarrage…',
    recreating: 'Recréation…',
    stopping: 'Arrêt…',
    starting_action: 'Start…',
    restarting: 'Restart…',
    deleting: 'Suppression…',
    failed: 'Échec',
  };
  return map[op] || op;
}

export function RunnersPage() {
  const toast = useToast();
  const [runners, setRunners] = useState<ManagedRunner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [logs, setLogs] = useState<RunnerLogs | null>(null);
  const [jobs, setJobs] = useState<RunnerJob[]>([]);
  const [wizard, setWizard] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [ghConnected, setGhConnected] = useState<boolean | null>(null);
  const [ghLogin, setGhLogin] = useState<string | null>(null);
  const [repos, setRepos] = useState<Array<{ full_name: string; owner: string; name: string }>>([]);
  const [suggestions, setSuggestions] = useState<Array<{
    project_uuid: string;
    project_name: string;
    repo: string;
    owner: string;
    needs_runner: boolean;
  }>>([]);
  const [form, setForm] = useState<CreateRunnerBody>({
    owner: '',
    repo: '',
    runner_name: '',
    image: IMAGE_PRESETS[0].image,
    labels: 'self-hosted,devforge',
    network_mode: 'bridge',
    pull_image: true,
    replace_existing: true,
    volumes: [],
    extra_env: [],
  });
  const [volumeDraft, setVolumeDraft] = useState('');
  const [envKey, setEnvKey] = useState('');
  const [envVal, setEnvVal] = useState('');

  function openWizard() {
    setAdvanced(false);
    setWizard(true);
    void (async () => {
      try {
        const st = await api.githubStatus();
        setGhConnected(!!st.connected);
        setGhLogin(st.user?.login ?? null);
        if (st.connected) {
          const r = await api.githubRepos();
          setRepos(
            (r.data ?? []).map((x) => ({
              full_name: x.full_name,
              owner: x.owner,
              name: x.name,
            })),
          );
        } else {
          setRepos([]);
        }
      } catch {
        setGhConnected(false);
        setRepos([]);
      }
    })();
  }

  function pickRepo(full: string) {
    const [owner, ...rest] = full.split('/');
    const repo = rest.join('/');
    if (!owner || !repo) return;
    setForm((f) => ({
      ...f,
      owner,
      repo,
      runner_name: f.runner_name || `${repo}-runner`,
    }));
  }

  async function load() {
    try {
      const r = await api.runnersList();
      setRunners(r.runners ?? []);
      setError(null);
      await detectSuggestions();
    } catch (e) {
      setError(String(e));
    }
  }

  async function detectSuggestions() {
    try {
      const projectsResp = await api.projects();
      const projects = projectsResp.data ?? [];
      const allRunners = runners;
      const suggested: Array<{
        project_uuid: string;
        project_name: string;
        repo: string;
        owner: string;
        needs_runner: boolean;
      }> = [];

      for (const project of projects) {
        if (!project.git_repository) continue;
        
        const match = project.git_repository.match(/github\.com[/:]([\w-]+)\/([\w.-]+?)(?:\.git)?$/i);
        if (!match) continue;
        
        const owner = match[1];
        const repo = match[2];
        
        try {
          const actions = await api.projectActions(project.uuid);
          if (!actions.available || !actions.has_workflows) continue;
          
          const hasRunner = (actions.runners?.length ?? 0) > 0;
          
          if (!hasRunner) {
            suggested.push({
              project_uuid: project.uuid,
              project_name: project.name,
              repo,
              owner,
              needs_runner: true,
            });
          }
        } catch {
          // Skip projects with API errors
        }
      }
      
      setSuggestions(suggested);
    } catch {
      // Soft fail
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource(runnersEventsUrl());
      const onUpdate = (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data);
          const runner = data.runner as ManagedRunner | undefined;
          if (!runner?.id) return;
          setRunners((prev) => {
            const idx = prev.findIndex((r) => r.id === runner.id);
            if (idx < 0) return [...prev, runner].sort((a, b) => a.runner_name.localeCompare(b.runner_name));
            const next = [...prev];
            next[idx] = runner;
            return next;
          });
        } catch {
          /* ignore */
        }
      };
      const onRemoved = (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.id) {
            setRunners((prev) => prev.filter((r) => r.id !== data.id));
            if (selected === data.id) setSelected(null);
          }
        } catch {
          /* ignore */
        }
      };
      es.addEventListener('runner.updated', onUpdate);
      es.addEventListener('runner.removed', onRemoved);
      es.addEventListener('runner.sync', () => {
        /* snapshot already pushed via updated events; soft refresh optional */
      });
    } catch {
      /* EventSource unavailable */
    }
    return () => {
      es?.close();
    };
  }, [selected]);

  useEffect(() => {
    if (!selected) {
      setLogs(null);
      setJobs([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [l, j] = await Promise.all([
          api.runnersLogs(selected, 150),
          api.runnersJobs(selected),
        ]);
        if (!cancelled) {
          setLogs(l.logs);
          setJobs(j.jobs ?? []);
        }
      } catch {
        /* soft */
      }
    })();
    const t = setInterval(() => {
      api.runnersLogs(selected, 150).then((l) => {
        if (!cancelled) setLogs(l.logs);
      }).catch(() => {});
    }, 12000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [selected]);

  async function createRunner(e: Event) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.runnersCreate({
        owner: form.owner,
        repo: form.repo,
        runner_name: form.runner_name,
        image: form.image,
        labels: form.labels,
        network_mode: form.network_mode,
        pull_image: form.pull_image,
        replace_existing: form.replace_existing,
        volumes: form.volumes,
        extra_env: form.extra_env,
      });
      toast.push({ title: 'Création démarrée', tone: 'info' });
      setWizard(false);
      await load();
    } catch (err) {
      toast.push({ title: 'Création KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, action: 'start' | 'stop' | 'restart' | 'recreate') {
    setBusy(true);
    try {
      await api.runnersAction(id, action);
      toast.push({ title: `Action ${action}`, tone: 'info' });
      await load();
    } catch (err) {
      toast.push({ title: 'Action KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Supprimer ce runner (conteneur + config) ?')) return;
    setBusy(true);
    try {
      await api.runnersDelete(id);
      toast.push({ title: 'Runner supprimé', tone: 'info' });
      if (selected === id) setSelected(null);
      await load();
    } catch (err) {
      toast.push({ title: 'Delete KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    try {
      const r = await api.runnersSync();
      toast.push({ title: 'Sync', detail: `${r.changed} changement(s)`, tone: 'info' });
      await load();
    } catch (err) {
      toast.push({ title: 'Sync KO', detail: String(err), tone: 'warn' });
    } finally {
      setBusy(false);
    }
  }

  async function createSuggestedRunner(projectUuid: string) {
    setBusy(true);
    try {
      const result = await api.projectActionsEnsureRunner(projectUuid);
      toast.push({
        title: result.created ? 'Runner créé' : 'Runner existant',
        detail: result.message,
        tone: 'ok',
      });
      await load();
    } catch (err) {
      toast.push({ title: 'Erreur', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  const detail = runners.find((r) => r.id === selected) || null;

  return (
    <AppShell
      active="runners"
      title="Runners"
      description="GitHub Actions self-hosted"
      actions={
        <div class="flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void syncNow()}>
            Sync
          </Button>
          <Button size="sm" onClick={() => openWizard()}>
            Nouveau runner
          </Button>
        </div>
      }
    >
      {error && (
        <Alert tone="warn" class="mb-4">
          {error}
        </Alert>
      )}

      {suggestions.length > 0 && (
        <FadeIn>
          <Card class="mb-6">
            <CardHeader
              title="Projets nécessitant des runners"
              description={`${suggestions.length} projet${suggestions.length > 1 ? 's' : ''} avec GitHub Actions`}
            />
            <ul class="divide-y divide-[var(--color-line)]">
              {suggestions.map((s) => (
                <li key={s.project_uuid} class="flex items-center justify-between gap-3 py-3">
                  <div class="min-w-0 flex-1">
                    <a
                      href={`/app/projects/view?uuid=${encodeURIComponent(s.project_uuid)}&tab=actions`}
                      class="font-medium text-[var(--color-accent)] hover:underline"
                    >
                      {s.project_name}
                    </a>
                    <div class="mt-0.5 font-mono text-xs text-[var(--color-ink-faint)]">
                      {s.owner}/{s.repo}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void createSuggestedRunner(s.project_uuid)}
                  >
                    Créer runner
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        </FadeIn>
      )}

      <FadeIn>
        <Card>
          {runners.length === 0 ? (
            <p class="text-sm text-[var(--color-ink-muted)]">
              Aucun runner. Crée-en un pour enregistrer un conteneur self-hosted sur le host Docker.
            </p>
          ) : (
            <ul class="divide-y divide-[var(--color-line)]">
              {runners.map((r) => {
                const op = opLabel(r.op_status);
                return (
                  <li
                    key={r.id}
                    class="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <button
                      type="button"
                      class="min-w-0 flex-1 text-left"
                      onClick={() => setSelected(r.id === selected ? null : r.id)}
                    >
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="font-medium">{r.runner_name}</span>
                        <Badge tone={stateTone(r.live_state)}>{r.live_state}</Badge>
                        {r.github_status && (
                          <Badge tone={ghTone(r.github_status)}>gh:{r.github_status}</Badge>
                        )}
                        {op && <Badge tone={r.op_status === 'failed' ? 'danger' : 'warn'}>{op}</Badge>}
                      </div>
                      <div class="mt-0.5 truncate font-mono text-xs text-[var(--color-ink-faint)]">
                        {r.owner}/{r.repo} · {r.container_name} · {r.image}
                      </div>
                      {r.last_error && (
                        <div class="mt-1 text-xs text-[var(--color-danger)]">{r.last_error}</div>
                      )}
                    </button>
                    <div class="flex flex-wrap gap-1.5">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(r.id, 'start')}>
                        Start
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(r.id, 'stop')}>
                        Stop
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(r.id, 'restart')}>
                        Restart
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(r.id, 'recreate')}>
                        Recreate
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(r.id)}>
                        Delete
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </FadeIn>

      {detail && (
        <FadeIn delay={40} class="mt-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Détail" description={detail.container_name} />
            <dl class="space-y-2 text-sm">
              <div class="flex justify-between gap-4">
                <dt class="text-[var(--color-ink-muted)]">Repo</dt>
                <dd class="font-mono text-xs">
                  <a href={detail.repo_url} target="_blank" rel="noreferrer" class="text-[var(--color-accent)]">
                    {detail.owner}/{detail.repo}
                  </a>
                </dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-[var(--color-ink-muted)]">Image</dt>
                <dd class="font-mono text-xs">{detail.image}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-[var(--color-ink-muted)]">Labels</dt>
                <dd class="font-mono text-xs">{detail.labels}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-[var(--color-ink-muted)]">Network</dt>
                <dd>{detail.network_mode}</dd>
              </div>
              {detail.volumes?.length > 0 && (
                <div>
                  <dt class="mb-1 text-[var(--color-ink-muted)]">Volumes</dt>
                  <dd class="font-mono text-xs text-[var(--color-ink-faint)]">
                    {detail.volumes.map((v) => (
                      <div key={v}>{v}</div>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
            <div class="mt-4">
              <div class="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
                Logs
                {logs?.runner_version ? ` · v${logs.runner_version}` : ''}
              </div>
              <pre class="max-h-64 overflow-auto rounded-lg bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
                {logs?.available
                  ? logs.items.map((i) => i.message).join('\n') || '(vide)'
                  : logs?.message || 'Logs indisponibles'}
              </pre>
            </div>
          </Card>
          <Card>
            <CardHeader title="Jobs Actions" description="Filtrés sur ce runner (fetch parallèle)" />
            {jobs.length === 0 ? (
              <p class="text-sm text-[var(--color-ink-muted)]">Aucun job récent.</p>
            ) : (
              <ul class="divide-y divide-[var(--color-line)]">
                {jobs.slice(0, 20).map((j, idx) => (
                  <li key={`${j.run_id}-${j.job_id ?? idx}`} class="py-2">
                    <a
                      href={j.run_url}
                      target="_blank"
                      rel="noreferrer"
                      class="text-sm font-medium text-[var(--color-accent)] hover:underline"
                    >
                      {j.job_name || j.run_name}
                    </a>
                    <div class="mt-0.5 text-xs text-[var(--color-ink-faint)]">
                      {j.job_status || j.run_status}
                      {j.job_conclusion || j.run_conclusion
                        ? ` · ${j.job_conclusion || j.run_conclusion}`
                        : ''}
                      {j.runner_name ? ` · ${j.runner_name}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </FadeIn>
      )}

      <Modal
        open={wizard}
        onClose={() => setWizard(false)}
        title="Nouveau runner"
        description="Le token GitHub Settings est utilisé automatiquement"
        size="lg"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setWizard(false)}>
              Annuler
            </Button>
            <Button
              type="submit"
              form="runner-create-form"
              disabled={busy || ghConnected === false}
            >
              Créer
            </Button>
          </>
        }
      >
        <form id="runner-create-form" class="space-y-4" onSubmit={createRunner}>
          {ghConnected === false && (
            <Alert tone="warn">
              GitHub n’est pas connecté.{' '}
              <a href="/app/settings?tab=github" class="underline">
                Settings → GitHub
              </a>
            </Alert>
          )}
          {ghConnected && ghLogin && (
            <p class="text-xs text-[var(--color-ink-faint)]">
              Connecté en tant que <span class="font-medium text-[var(--color-ink-muted)]">{ghLogin}</span>
            </p>
          )}

          {repos.length > 0 ? (
            <label class="block text-sm">
              <span class="mb-1 block text-[var(--color-ink-muted)]">Dépôt</span>
              <select
                class="w-full rounded-lg border border-[var(--color-line)] bg-transparent px-3 py-2"
                value={form.owner && form.repo ? `${form.owner}/${form.repo}` : ''}
                onChange={(e) => pickRepo((e.target as HTMLSelectElement).value)}
                required
              >
                <option value="" disabled>
                  Choisir un repo…
                </option>
                {repos.map((r) => (
                  <option key={r.full_name} value={r.full_name}>
                    {r.full_name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div class="grid gap-3 sm:grid-cols-2">
              <Input
                label="Owner"
                required
                value={form.owner}
                onInput={(e) => setForm((f) => ({ ...f, owner: (e.target as HTMLInputElement).value }))}
              />
              <Input
                label="Repo"
                required
                value={form.repo}
                onInput={(e) => setForm((f) => ({ ...f, repo: (e.target as HTMLInputElement).value }))}
              />
            </div>
          )}

          <Input
            label="Nom du runner"
            required
            placeholder="mon-runner"
            value={form.runner_name}
            onInput={(e) =>
              setForm((f) => ({ ...f, runner_name: (e.target as HTMLInputElement).value }))
            }
          />

          <div>
            <div class="mb-1.5 text-sm text-[var(--color-ink-muted)]">Image Docker</div>
            <div class="mb-2 grid gap-1.5 sm:grid-cols-3">
              {IMAGE_PRESETS.map((p) => (
                <button
                  key={p.image}
                  type="button"
                  class={`rounded-lg border px-2.5 py-2 text-left transition ${
                    form.image === p.image
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]'
                      : 'border-[var(--color-line)] hover:bg-white/5'
                  }`}
                  onClick={() => setForm((f) => ({ ...f, image: p.image }))}
                >
                  <div
                    class={`text-xs font-medium ${
                      form.image === p.image
                        ? 'text-[var(--color-accent)]'
                        : 'text-[var(--color-ink)]'
                    }`}
                  >
                    {p.label}
                  </div>
                  <div class="mt-0.5 text-[10px] leading-snug text-[var(--color-ink-muted)]">
                    {p.hint}
                  </div>
                  <div class="mt-1 truncate font-mono text-[10px] text-[var(--color-ink-faint)]">
                    {p.image}
                  </div>
                </button>
              ))}
            </div>
            <Input
              label="Image personnalisée"
              placeholder="ghcr.io/mon-org/mon-runner:tag"
              value={form.image || ''}
              onInput={(e) => setForm((f) => ({ ...f, image: (e.target as HTMLInputElement).value }))}
            />
            <p class="mt-1 text-xs text-[var(--color-ink-faint)]">
              Colle n’importe quelle image (GHCR, Docker Hub, registry privé…).
            </p>
          </div>

          <button
            type="button"
            class="text-sm text-[var(--color-accent)] hover:underline"
            onClick={() => setAdvanced((v) => !v)}
          >
            {advanced ? 'Masquer les options' : 'Options avancées'}
          </button>

          {advanced && (
            <div class="space-y-3 rounded-lg border border-[var(--color-line)] p-3">
              <Input
                label="Labels"
                value={form.labels || ''}
                onInput={(e) => setForm((f) => ({ ...f, labels: (e.target as HTMLInputElement).value }))}
              />
              <label class="block text-sm">
                <span class="mb-1 block text-[var(--color-ink-muted)]">Network</span>
                <select
                  class="w-full rounded-lg border border-[var(--color-line)] bg-transparent px-3 py-2"
                  value={form.network_mode || 'bridge'}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      network_mode: (e.target as HTMLSelectElement).value,
                    }))
                  }
                >
                  <option value="bridge">bridge</option>
                  <option value="host">host</option>
                  <option value="none">none</option>
                </select>
              </label>
              <label class="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!form.pull_image}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, pull_image: (e.target as HTMLInputElement).checked }))
                  }
                />
                Pull image avant démarrage
              </label>

              <div>
                <div class="mb-1 text-sm text-[var(--color-ink-muted)]">Volumes</div>
                <div class="flex gap-2">
                  <Input
                    value={volumeDraft}
                    placeholder="/data/cache:/cache:rw"
                    onInput={(e) => setVolumeDraft((e.target as HTMLInputElement).value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const v = volumeDraft.trim();
                      if (!v) return;
                      setForm((f) => ({ ...f, volumes: [...(f.volumes || []), v] }));
                      setVolumeDraft('');
                    }}
                  >
                    +
                  </Button>
                </div>
                {(form.volumes || []).length > 0 && (
                  <ul class="mt-2 space-y-1 font-mono text-xs text-[var(--color-ink-faint)]">
                    {(form.volumes || []).map((v) => (
                      <li key={v} class="flex justify-between gap-2">
                        <span>{v}</span>
                        <button
                          type="button"
                          class="text-[var(--color-danger)]"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              volumes: (f.volumes || []).filter((x) => x !== v),
                            }))
                          }
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <div class="mb-1 text-sm text-[var(--color-ink-muted)]">Variables d’environnement</div>
                <div class="flex flex-wrap gap-2">
                  <Input
                    placeholder="KEY"
                    value={envKey}
                    onInput={(e) => setEnvKey((e.target as HTMLInputElement).value)}
                  />
                  <Input
                    placeholder="value"
                    value={envVal}
                    onInput={(e) => setEnvVal((e.target as HTMLInputElement).value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const key = envKey.trim().toUpperCase();
                      if (!key) return;
                      setForm((f) => ({
                        ...f,
                        extra_env: [...(f.extra_env || []), { key, value: envVal }],
                      }));
                      setEnvKey('');
                      setEnvVal('');
                    }}
                  >
                    +
                  </Button>
                </div>
                {(form.extra_env || []).length > 0 && (
                  <ul class="mt-2 space-y-1 font-mono text-xs text-[var(--color-ink-faint)]">
                    {(form.extra_env || []).map((e) => (
                      <li key={e.key} class="flex justify-between gap-2">
                        <span>
                          {e.key}={e.value}
                        </span>
                        <button
                          type="button"
                          class="text-[var(--color-danger)]"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              extra_env: (f.extra_env || []).filter((x) => x.key !== e.key),
                            }))
                          }
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

        </form>
      </Modal>
    </AppShell>
  );
}
