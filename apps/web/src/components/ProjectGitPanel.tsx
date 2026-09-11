import { useEffect, useState } from 'preact/hooks';
import { api, type ProjectSync } from '../lib/api';
import { projectSyncMeta } from '../lib/status';
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
  };
  workdir?: {
    available: boolean;
    dirty: boolean;
    files?: Array<{ status: string; path: string }>;
    head?: string | null;
    note?: string | null;
    reason?: string;
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
}: {
  projectUuid: string;
  onDeployed?: () => void;
}) {
  const toast = useToast();
  const [data, setData] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function deploy() {
    setBusy(true);
    try {
      await api.createDeployment(projectUuid, { git_message: 'Deploy depuis onglet Git' });
      toast.push({
        title: 'Déploiement lancé',
        detail: 'Le tip GitHub va être tiré puis rebuild.',
        tone: 'ok',
      });
      onDeployed?.();
      await load();
    } catch (e) {
      toast.push({ title: 'Deploy KO', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function discardLocal() {
    if (
      !confirm(
        'Annuler toutes les modifications locales du workdir ? (git reset --hard + clean). Irréversible.',
      )
    ) {
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
      toast.push({ title: 'Discard KO', detail: String(e), tone: 'danger' });
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
    return (
      <Alert tone="warn" class="mb-4">
        {error}
      </Alert>
    );
  }

  if (data?.available === false) {
    return (
      <Alert tone="warn">
        Lie un dépôt GitHub pour suivre les commits et le workdir.
      </Alert>
    );
  }

  const sync = data?.sync;
  const syncMeta = projectSyncMeta(sync);
  const commits = sync?.commits ?? [];
  const workdir = data?.workdir;
  const behind = sync?.state === 'behind';

  return (
    <div class="space-y-6">
      <FadeIn>
        <Card>
          <CardHeader
            title="Sync production"
            description={
              data?.owner && data?.repo
                ? `${data.owner}/${data.repo}${data.branch ? ` @ ${data.branch}` : ''}`
                : 'GitHub ↔ dernier déploiement'
            }
          />
          <div class="flex flex-wrap items-center gap-2">
            <Badge tone={syncMeta.tone} title={syncMeta.title}>
              {syncMeta.label}
            </Badge>
            {sync?.deployed_sha && (
              <span class="font-mono text-xs text-[var(--color-ink-faint)]">
                deploy {sync.deployed_sha}
              </span>
            )}
            {sync?.head_sha && (
              <span class="font-mono text-xs text-[var(--color-ink-faint)]">
                tip {sync.head_sha}
              </span>
            )}
          </div>

          {behind && (
            <Alert tone="info" class="mt-4">
              GitHub a des commits que la prod n’a pas encore. Souvent après un patch Actions
              (« Utiliser runners DevForge ») ou un push. Déploie pour les appliquer.
            </Alert>
          )}

          <div class="mt-4 flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || !behind} onClick={() => void deploy()}>
              {behind ? 'Déployer les commits' : 'À jour'}
            </Button>
            {sync?.html_url && (
              <Button size="sm" variant="outline" href={sync.html_url} target="_blank">
                Voir le diff GitHub
              </Button>
            )}
            {data?.repo_url && (
              <Button
                size="sm"
                variant="ghost"
                href={`${data.repo_url}/tree/${encodeURIComponent(data.branch || 'main')}`}
                target="_blank"
              >
                Ouvrir le repo
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void load()}>
              Rafraîchir
            </Button>
          </div>
        </Card>
      </FadeIn>

      <FadeIn delay={40}>
        <Card>
          <CardHeader
            title="Commits non déployés"
            description={behind ? `${sync?.behind_by ?? commits.length} en attente` : 'Aucun'}
          />
          {commits.length === 0 ? (
            <p class="text-sm text-[var(--color-ink-muted)]">
              {behind
                ? 'Commits non listés — ouvre le diff GitHub.'
                : 'La prod est alignée sur le tip de la branche.'}
            </p>
          ) : (
            <ul class="divide-y divide-[var(--color-line)]">
              {commits.map((c) => (
                <li key={c.sha} class="py-2.5">
                  {c.html_url ? (
                    <a
                      href={c.html_url}
                      target="_blank"
                      rel="noreferrer"
                      class="text-sm font-medium text-[var(--color-accent)] hover:underline"
                    >
                      {c.message}
                    </a>
                  ) : (
                    <div class="text-sm font-medium">{c.message}</div>
                  )}
                  <div class="mt-0.5 flex flex-wrap gap-2 font-mono text-xs text-[var(--color-ink-faint)]">
                    <span>{c.sha}</span>
                    {c.author && <span>{c.author}</span>}
                    {formatWhen(c.date) && <time dateTime={c.date || undefined}>{formatWhen(c.date)}</time>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </FadeIn>

      <FadeIn delay={80}>
        <Card>
          <CardHeader
            title="Workdir local"
            description="Fichiers modifiés sur le serveur (agents, edits) — pas encore sur GitHub"
          />
          {!workdir?.available ? (
            <p class="text-sm text-[var(--color-ink-muted)]">
              {workdir?.reason || 'Workdir inaccessible.'}
            </p>
          ) : workdir.dirty ? (
            <>
              <Alert tone="warn" class="mb-3">
                {workdir.note ||
                  'Des fichiers locaux diffèrent. Un deploy fera reset --hard et les perdra.'}
              </Alert>
              <ul class="mb-4 divide-y divide-[var(--color-line)] font-mono text-xs">
                {(workdir.files ?? []).map((f) => (
                  <li key={f.path} class="flex gap-3 py-1.5">
                    <span class="w-8 shrink-0 text-[var(--color-ink-faint)]">{f.status}</span>
                    <span>{f.path}</span>
                  </li>
                ))}
              </ul>
              <div class="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void discardLocal()}>
                  Annuler les changements locaux
                </Button>
              </div>
              <p class="mt-3 text-xs text-[var(--color-ink-faint)]">
                Prochaine étape agents : éditer / commit / push depuis ce panneau.
              </p>
            </>
          ) : (
            <p class="text-sm text-[var(--color-ink-muted)]">
              Workdir propre{workdir.head ? ` · HEAD ${workdir.head}` : ''}.
            </p>
          )}
        </Card>
      </FadeIn>
    </div>
  );
}
