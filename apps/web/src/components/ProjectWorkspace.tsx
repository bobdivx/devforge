import { useEffect, useState } from 'preact/hooks';
import { api, type Deployment, type Project } from '../lib/api';
import { cn } from '../lib/cn';
import { BuilderProgress } from './BuilderProgress';
import { ProjectAgentsPanel } from './ProjectAgentsPanel';
import { Badge, Button, Card, FadeIn, Spinner } from './ui';

type Props = {
  projectUuid: string;
  project: Project | null;
  builderMode?: boolean;
  builderAgentUuid?: string;
};

type PanelMode = 'split' | 'chat' | 'preview';

function formatWhen(iso?: string | null) {
  if (!iso) return '—';
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

function deployTone(status: string): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (status === 'deployed' || status === 'running' || status === 'success') return 'ok';
  if (status === 'failed' || status === 'error') return 'danger';
  if (status === 'deploying' || status === 'building' || status === 'pending') return 'warn';
  return 'neutral';
}

export function ProjectWorkspace({ projectUuid, project, builderMode, builderAgentUuid }: Props) {
  const [mode, setMode] = useState<PanelMode>(builderMode ? 'chat' : 'split');
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [selectedDeploy, setSelectedDeploy] = useState<string | null>(null);
  const [logs, setLogs] = useState<string>('');
  const [logsLoading, setLogsLoading] = useState(false);
  const [showBuilder, setShowBuilder] = useState(builderMode && !project?.production_url);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [localDirty, setLocalDirty] = useState(false);
  const [previewHint, setPreviewHint] = useState<string | null>(null);

  // Détecter workflow local-first : template appliqué mais pas de git_repository
  const isLocalFirst = builderMode && !project?.git_repository?.trim();

  useEffect(() => {
    loadDeployments();
  }, [projectUuid]);

  useEffect(() => {
    async function refreshGit() {
      try {
        const g = await api.projectGit(projectUuid);
        setLocalDirty(Boolean(g.workdir?.dirty));
      } catch {
        /* ignore */
      }
    }
    void refreshGit();
    function onPreviewRefresh(ev: Event) {
      const detail = (ev as CustomEvent<{ url?: string; reason?: string }>).detail;
      setPreviewNonce((n) => n + 1);
      setPreviewHint(
        detail?.url
          ? `Preview relancée (${detail.url})`
          : 'Modifications locales — rafraîchis la preview.',
      );
      void refreshGit();
    }
    window.addEventListener('devforge:preview-refresh', onPreviewRefresh);
    return () => window.removeEventListener('devforge:preview-refresh', onPreviewRefresh);
  }, [projectUuid]);

  async function loadDeployments() {
    try {
      const r = await api.deployments(projectUuid);
      setDeployments(r.data ?? []);
      if (r.data?.[0]) {
        setSelectedDeploy(r.data[0].uuid);
      }
    } catch {
      setDeployments([]);
    }
  }

  useEffect(() => {
    if (selectedDeploy) {
      loadLogs(selectedDeploy);
    } else {
      setLogs('');
    }
  }, [selectedDeploy]);

  async function loadLogs(depUuid: string) {
    setLogsLoading(true);
    try {
      const r = await api.deployment(depUuid);
      setLogs(r.data.logs || 'Aucun log disponible.');
    } catch {
      setLogs('(logs indisponibles)');
    } finally {
      setLogsLoading(false);
    }
  }

  const latest = deployments[0] ?? null;
  const productionUrl = project?.production_url;

  // Cacher le builder progress quand la preview est prête
  useEffect(() => {
    if (productionUrl && showBuilder) {
      setShowBuilder(false);
    }
  }, [productionUrl, showBuilder]);

  return (
    <FadeIn>
      {/* Mobile tab switcher */}
      <div class="mb-4 flex gap-1 rounded-xl bg-[var(--color-surface)] p-1 lg:hidden">
        <button
          type="button"
          onClick={() => setMode('chat')}
          class={cn(
            'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition',
            mode === 'chat'
              ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
              : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
          )}
        >
          Chat / Agent
        </button>
        <button
          type="button"
          onClick={() => setMode('preview')}
          class={cn(
            'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition',
            mode === 'preview'
              ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
              : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
          )}
        >
          Preview / Logs
        </button>
      </div>

      {/* Desktop split / mobile conditional */}
      <div class="grid gap-4 lg:grid-cols-2">
        {/* Left panel: Chat/Agent */}
        <div
          class={cn(
            'min-h-[500px]',
            mode === 'preview' && 'hidden lg:block',
            mode === 'chat' && 'block',
            mode === 'split' && 'block',
          )}
        >
          <ProjectAgentsPanel
            projectUuid={projectUuid}
            defaultAgentUuid={builderAgentUuid}
            builderMode={builderMode}
          />
        </div>

        {/* Right panel: Preview + Logs */}
        <div
          class={cn(
            'flex flex-col gap-4',
            mode === 'chat' && 'hidden lg:flex',
            mode === 'preview' && 'flex',
            mode === 'split' && 'flex',
          )}
        >
          {/* Preview iframe */}
          <Card padding="none" class="flex flex-col overflow-hidden">
            <div class="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="font-medium tracking-tight">Preview</span>
                  {latest && <Badge tone={deployTone(latest.status)}>{latest.status}</Badge>}
                </div>
                {productionUrl && (
                  <p class="mt-0.5 truncate text-xs text-[var(--color-ink-muted)]">
                    {productionUrl.replace(/^https?:\/\//, '')}
                  </p>
                )}
              </div>
              {productionUrl && (
                <div class="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPreviewNonce((n) => n + 1)}
                  >
                    Rafraîchir
                  </Button>
                  <Button size="sm" variant="outline" href={productionUrl} target="_blank">
                    Ouvrir
                  </Button>
                </div>
              )}
            </div>

            {(previewHint || localDirty) && (
              <div class="border-b border-[var(--color-line)] bg-[var(--color-accent-soft)] px-4 py-2 text-xs text-[var(--color-ink)]">
                {localDirty
                  ? 'Des fichiers ont été modifiés dans le dossier du projet. La preview production ne les montre qu’après PR + déploiement. Valide dans le chat pour ouvrir une PR.'
                  : previewHint}
              </div>
            )}

            <div class="relative flex-1 bg-white/5" style={{ minHeight: '300px' }}>
              {productionUrl ? (
                <iframe
                  key={previewNonce}
                  src={`${productionUrl}${productionUrl.includes('?') ? '&' : '?'}_df=${previewNonce}`}
                  class="h-full w-full border-0"
                  style={{ minHeight: '300px' }}
                  title="App preview"
                  sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals"
                />
              ) : showBuilder && builderAgentUuid ? (
                <div class="flex h-full min-h-[300px] items-center justify-center p-4">
                  <BuilderProgress
                    projectUuid={projectUuid}
                    agentUuid={builderAgentUuid}
                    localFirst={isLocalFirst}
                    onComplete={() => setShowBuilder(false)}
                  />
                </div>
              ) : isLocalFirst ? (
                <div class="flex h-full min-h-[300px] items-center justify-center p-8 text-center">
                  <div class="max-w-md">
                    <div class="mb-4 text-4xl">🎨</div>
                    <h3 class="mb-2 font-medium">Preview locale en préparation</h3>
                    <p class="text-sm text-[var(--color-ink-muted)]">
                      Le template a été appliqué dans le workdir local. 
                      Testez l'application, puis cliquez sur « Valider et publier » pour créer le dépôt GitHub.
                    </p>
                    <div class="mt-4 rounded-lg bg-[var(--color-surface)] p-3 text-left text-xs text-[var(--color-ink-faint)]">
                      <p>💡 <strong>Workflow local-first :</strong></p>
                      <ol class="mt-2 ml-4 space-y-1 list-decimal">
                        <li>Template prêt dans le workdir local</li>
                        <li>Testez via la preview</li>
                        <li>Validez et publiez sur GitHub</li>
                        <li>Déploiement automatique</li>
                      </ol>
                    </div>
                  </div>
                </div>
              ) : (
                <div class="flex h-full min-h-[300px] items-center justify-center p-8 text-center">
                  <div>
                    <p class="text-sm text-[var(--color-ink-muted)]">
                      Aucune URL de production configurée.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      href={`/app/projects/view?uuid=${encodeURIComponent(projectUuid)}&tab=domains`}
                      class="mt-3"
                    >
                      Configurer domaine
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Logs panel */}
          <Card padding="none" class="flex flex-col overflow-hidden">
            <div class="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-3">
              <span class="font-medium tracking-tight">Logs de déploiement</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => loadDeployments()}
              >
                Rafraîchir
              </Button>
            </div>

            {deployments.length > 0 ? (
              <div class="border-b border-[var(--color-line)]">
                <div class="flex gap-1 overflow-x-auto p-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {deployments.slice(0, 5).map((d) => (
                    <button
                      key={d.uuid}
                      type="button"
                      onClick={() => setSelectedDeploy(d.uuid)}
                      class={cn(
                        'shrink-0 rounded-lg border px-3 py-1.5 text-xs transition',
                        selectedDeploy === d.uuid
                          ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                          : 'border-[var(--color-line)] bg-[var(--color-surface)] hover:border-[var(--color-line-strong)]',
                      )}
                    >
                      <div class="flex items-center gap-1.5">
                        <span
                          class={cn(
                            'h-1.5 w-1.5 rounded-full',
                            deployTone(d.status) === 'ok' && 'bg-[var(--color-ok)]',
                            deployTone(d.status) === 'danger' && 'bg-[var(--color-danger)]',
                            deployTone(d.status) === 'warn' && 'bg-[var(--color-warn)]',
                            deployTone(d.status) === 'neutral' && 'bg-[var(--color-ink-muted)]',
                          )}
                        />
                        <span class="font-mono">
                          {d.git_sha ? d.git_sha.slice(0, 7) : '—'}
                        </span>
                        <span class="text-[var(--color-ink-faint)]">
                          {formatWhen(d.created_at)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div class="flex-1 overflow-auto p-4" style={{ maxHeight: '300px' }}>
              {logsLoading ? (
                <div class="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
                  <Spinner /> Chargement des logs…
                </div>
              ) : (
                <pre class="font-mono text-xs text-[var(--color-ink-muted)] whitespace-pre-wrap break-words">
                  {logs || 'Aucun déploiement sélectionné.'}
                </pre>
              )}
            </div>
          </Card>
        </div>
      </div>
    </FadeIn>
  );
}
