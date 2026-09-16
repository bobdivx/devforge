import { useEffect, useState } from 'preact/hooks';
import { api, type ProjectSync } from '../lib/api';
import { projectSyncMeta } from '../lib/status';
import { DiffViewer, type DiffFile } from './DiffViewer';
import {
  Badge,
  Button,
  Card,
  FadeIn,
  Spinner,
  useToast,
} from './ui';

type GitCommit = {
  sha: string;
  message: string;
  author?: string | null;
  date?: string | null;
  html_url?: string | null;
};

type GitStatus = {
  ok: boolean;
  available: boolean;
  reason?: string;
  owner?: string;
  repo?: string;
  branch?: string;
  repo_url?: string;
  sync?: ProjectSync & {
    commits?: GitCommit[];
    html_url?: string | null;
    error?: string;
    ahead_by_remote?: number;
    files_count?: number;
  };
  workdir?: {
    available: boolean;
    dirty: boolean;
    files?: Array<{ status: string; path: string }>;
    head?: string | null;
    note?: string | null;
    reason?: string;
    path?: string;
    configured?: string;
  };
};

function formatWhen(iso?: string | null) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function ProjectGitPanel({
  projectUuid,
  onDeployed,
  project,
}: {
  projectUuid: string;
  onDeployed?: () => void;
  project?: { auto_deploy?: boolean };
}) {
  const toast = useToast();
  const [data, setData] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoDeployEnabled, setAutoDeployEnabled] = useState(project?.auto_deploy ?? true);

  const [diffOpen, setDiffOpen] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffTitle, setDiffTitle] = useState('Diff');
  const [diffDesc, setDiffDesc] = useState<string | undefined>();
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);

  async function load() {
    setLoading(true);
    try {
      const r = await api.projectGit(projectUuid);
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
  }, [projectUuid]);
  
  useEffect(() => {
    if (project?.auto_deploy !== undefined) {
      setAutoDeployEnabled(project.auto_deploy);
    }
  }, [project?.auto_deploy]);
  
  async function toggleAutoDeploy() {
    setBusy(true);
    try {
      await api.updateProject(projectUuid, { auto_deploy: !autoDeployEnabled });
      setAutoDeployEnabled(!autoDeployEnabled);
      toast.push({
        title: !autoDeployEnabled ? 'Auto-deploy activé' : 'Auto-deploy désactivé',
        detail: !autoDeployEnabled
          ? 'Les pushs GitHub déclenchent un déploiement automatique'
          : 'Déploiements manuels uniquement',
        tone: 'ok',
      });
    } catch (e) {
      toast.push({ title: 'Erreur', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function openDiff(source: 'sync' | 'workdir', path?: string) {
    setDiffOpen(true);
    setDiffLoading(true);
    setDiffError(null);
    setDiffFiles([]);
    setDiffTitle(source === 'workdir' ? 'Modifications locales' : 'À déployer');
    setDiffDesc(undefined);
    try {
      const r = await api.projectGitDiff(projectUuid, source, path);
      if (r.title) setDiffTitle(r.title);
      setDiffFiles(r.files ?? []);
    } catch (e) {
      setDiffError(String(e));
    } finally {
      setDiffLoading(false);
    }
  }

  async function deploy() {
    setBusy(true);
    try {
      await api.createDeployment(projectUuid, { git_message: 'Deploy depuis onglet Git' });
      toast.push({ title: 'Déploiement lancé', tone: 'ok' });
      onDeployed?.();
      await load();
    } catch (e) {
      toast.push({ title: 'Déploiement impossible', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function revertUndeployed() {
    if (
      !confirm(
        'Retirer ces commits de la branche GitHub ?\nLa branche revient au tip déjà en production.',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const r = await api.projectGitRevertUndeployed(projectUuid);
      toast.push({
        title: r.ok ? 'Branche rétablie' : 'Échec',
        detail: r.message,
        tone: r.ok ? 'ok' : 'danger',
      });
      await load();
    } catch (e) {
      toast.push({ title: 'Annulation impossible', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function discardLocal() {
    if (!confirm('Jeter toutes les modifications locales ? Irréversible.')) {
      return;
    }
    setBusy(true);
    try {
      const r = await api.projectGitDiscard(projectUuid);
      toast.push({
        title: r.message || 'Discard',
        tone: r.ok ? 'ok' : 'danger',
        detail: r.ok ? undefined : r.output,
      });
      await load();
    } catch (e) {
      toast.push({ title: 'Discard impossible', detail: String(e), tone: 'danger' });
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

  if (error) {
    return <p class="text-sm text-rose-300">{error}</p>;
  }

  if (data?.available === false) {
    return (
      <p class="text-sm text-[var(--color-ink-muted)]">
        Lie un dépôt GitHub pour suivre commits et workdir.
      </p>
    );
  }

  const sync = data?.sync;
  const syncMeta = projectSyncMeta(sync);
  const commits = sync?.commits ?? [];
  const workdir = data?.workdir;
  const behind = sync?.state === 'behind';
  const repoLabel =
    data?.owner && data?.repo
      ? `${data.owner}/${data.repo}${data.branch ? ` · ${data.branch}` : ''}`
      : null;

  return (
    <div class="space-y-5">
      <DiffViewer
        open={diffOpen}
        onClose={() => setDiffOpen(false)}
        title={diffTitle}
        description={diffDesc}
        loading={diffLoading}
        error={diffError}
        files={diffFiles}
      />

      <FadeIn>
        <Card padding="lg" class="space-y-6">
          {/* Auto-Deploy Toggle */}
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line)] pb-5">
            <div class="min-w-0 space-y-1">
              <h3 class="text-sm font-medium">Déploiement automatique</h3>
              <p class="text-xs text-[var(--color-ink-muted)]">
                {autoDeployEnabled
                  ? 'Les nouveaux commits sur la branche configurée déclenchent un déploiement (webhook GitHub + contrôle périodique)'
                  : 'Déploiements manuels uniquement — les pushs GitHub sont ignorés'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoDeployEnabled}
              disabled={busy}
              onClick={() => void toggleAutoDeploy()}
              class={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-2 focus:ring-offset-[var(--color-bg)] disabled:cursor-not-allowed disabled:opacity-50 ${
                autoDeployEnabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-line)]'
              }`}
            >
              <span class="sr-only">
                {autoDeployEnabled ? 'Désactiver auto-deploy' : 'Activer auto-deploy'}
              </span>
              <span
                aria-hidden="true"
                class={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  autoDeployEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          
          {/* Header sync */}
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0 space-y-2">
              <div class="flex flex-wrap items-center gap-2">
                <Badge tone={syncMeta.tone}>{syncMeta.label}</Badge>
                {repoLabel && (
                  <span class="truncate font-mono text-xs text-[var(--color-ink-faint)]">
                    {repoLabel}
                  </span>
                )}
              </div>
              {(sync?.deployed_sha || sync?.head_sha) && (
                <p class="font-mono text-[11px] text-[var(--color-ink-faint)]">
                  {sync.deployed_sha && <span>prod {sync.deployed_sha}</span>}
                  {sync.deployed_sha && sync.head_sha && <span class="mx-1.5">→</span>}
                  {sync.head_sha && <span>github {sync.head_sha}</span>}
                  {typeof sync.files_count === 'number' && sync.files_count > 0 && (
                    <span class="ml-2">· {sync.files_count} fichiers</span>
                  )}
                </p>
              )}
            </div>
            <div class="flex flex-wrap gap-2">
              {behind ? (
                <>
                  <Button size="sm" disabled={busy} onClick={() => void deploy()}>
                    Déployer
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void openDiff('sync')}
                  >
                    Diff
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void revertUndeployed()}
                  >
                    Annuler
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void load()}>
                  Rafraîchir
                </Button>
              )}
              {data?.repo_url && (
                <Button
                  size="sm"
                  variant="ghost"
                  href={`${data.repo_url}/tree/${encodeURIComponent(data.branch || 'main')}`}
                  target="_blank"
                >
                  Repo
                </Button>
              )}
            </div>
          </div>

          {/* Commits en attente */}
          <section>
            <h3 class="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
              {behind
                ? `${sync?.behind_by ?? commits.length} commit${(sync?.behind_by ?? commits.length) > 1 ? 's' : ''} à déployer`
                : 'Rien à déployer'}
            </h3>
            {commits.length === 0 ? (
              !behind && (
                <p class="text-sm text-[var(--color-ink-muted)]">Production alignée sur GitHub.</p>
              )
            ) : (
              <ul class="divide-y divide-[var(--color-line)] rounded-xl border border-[var(--color-line)]">
                {commits.map((c) => (
                  <li key={c.sha} class="px-3.5 py-3">
                    <div class="text-sm text-[var(--color-ink)]">{c.message}</div>
                    <div class="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[11px] text-[var(--color-ink-faint)]">
                      <span>{c.sha}</span>
                      {c.author && <span>{c.author}</span>}
                      {formatWhen(c.date) && (
                        <time dateTime={c.date || undefined}>{formatWhen(c.date)}</time>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Workdir */}
          <section class="border-t border-[var(--color-line)] pt-5">
            <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 class="text-xs font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
                Workdir
                {workdir?.dirty && (
                  <span class="ml-2 normal-case tracking-normal text-amber-400/90">
                    · modifié
                  </span>
                )}
              </h3>
              {workdir?.available && workdir.dirty && (
                <div class="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void openDiff('workdir')}
                  >
                    Diff
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void discardLocal()}
                  >
                    Jeter
                  </Button>
                </div>
              )}
            </div>

            {!workdir?.available ? (
              <p class="text-sm text-[var(--color-ink-muted)]">
                {workdir?.reason || 'Workdir inaccessible.'}
              </p>
            ) : workdir.dirty ? (
              <ul class="divide-y divide-[var(--color-line)] rounded-xl border border-[var(--color-line)] font-mono text-xs">
                {(workdir.files ?? []).map((f) => (
                  <li key={f.path}>
                    <button
                      type="button"
                      class="flex w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-white/[0.03]"
                      onClick={() => void openDiff('workdir', f.path)}
                    >
                      <span class="w-7 shrink-0 text-[var(--color-ink-faint)]">{f.status}</span>
                      <span class="min-w-0 truncate text-[var(--color-accent)]">{f.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p class="text-sm text-[var(--color-ink-muted)]">
                Propre
                {workdir.head ? (
                  <span class="font-mono text-[var(--color-ink-faint)]"> · {workdir.head}</span>
                ) : null}
              </p>
            )}
          </section>
        </Card>
      </FadeIn>
    </div>
  );
}
