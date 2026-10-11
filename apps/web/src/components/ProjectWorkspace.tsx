import { useCallback, useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { notifyPreviewRefresh, previewUrlFromTools } from '../lib/agent-stream';
import { cn } from '../lib/cn';
import { ProjectAgentsPanel } from './ProjectAgentsPanel';
import {
  WorkspaceTopBar,
  type PreviewServerStatus,
} from './workspace/WorkspaceTopBar';
import { PreviewModal } from './workspace/PreviewModal';
import { WorkspaceAtelier } from './workspace/WorkspaceAtelier';
import { FadeIn, HubGrid, HubTile, Modal, Switch, Button, Spinner } from './ui';
import type { Project } from '../lib/api';
import { ChevronLeft, FileCode2, FileDiff, MessageSquare, MonitorPlay } from 'lucide-preact';
import { AdviceChip, DraftModal, filesLabel, relativeFr, useDraft } from './DraftPanel';

type WorkspaceView = 'hub' | 'chat';

function readWorkspaceQuery(): { view: WorkspaceView; draft: boolean } {
  if (typeof window === 'undefined') return { view: 'hub', draft: false };
  const q = new URLSearchParams(window.location.search);
  // Lien direct vers une discussion (?agent=…) : on ouvre le fil, pas la grille.
  const view: WorkspaceView = q.get('view') === 'chat' || q.has('agent') ? 'chat' : 'hub';
  return { view, draft: q.get('draft') === '1' };
}

function setQuery(mutate: (u: URL) => void) {
  const u = new URL(window.location.href);
  mutate(u);
  window.history.replaceState(null, '', u.toString());
}

type Props = {
  projectUuid: string;
  project: Project | null;
  builderMode?: boolean;
  builderAgentUuid?: string;
};

/**
 * Workspace = atelier local (chat + workdir + preview).
 * Dev server = process npm run dev (pas de conteneur df-dev-*).
 */
export function ProjectWorkspace({ projectUuid, project, builderMode, builderAgentUuid }: Props) {
  const initialQuery = readWorkspaceQuery();
  const [view, setView] = useState<WorkspaceView>(initialQuery.view);
  const [draftOpen, setDraftOpen] = useState(initialQuery.draft);
  const [filesOpen, setFilesOpen] = useState(false);
  const [previewInfoOpen, setPreviewInfoOpen] = useState(false);
  const { draft, refresh: refreshDraft } = useDraft(projectUuid);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [mobilePane, setMobilePane] = useState<'chat' | 'atelier'>('chat');
  const [atelierTab, setAtelierTab] = useState<'preview' | 'files'>('preview');
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<PreviewServerStatus>('stopped');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewErrorDetail, setPreviewErrorDetail] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const r = await api.previewStatus(projectUuid);
      const data = r.data ?? {};
      const status = data.status === 'running' ? 'running' : 'stopped';
      setPreviewStatus(status);
      if (typeof data.preview_url === 'string' && data.preview_url) {
        setLocalPreviewUrl(data.preview_url);
      }
    } catch {
      // Ignorer les erreurs de polling
    }
  }, [projectUuid]);

  useEffect(() => {
    function onPreviewRefresh(ev: Event) {
      const detail = (ev as CustomEvent<{ url?: string; reason?: string }>).detail;
      if (detail?.url) {
        setLocalPreviewUrl(detail.url);
        setPreviewError(null);
        setPreviewErrorDetail(null);
        setPreviewStatus('running');
      }
    }
    window.addEventListener('devforge:preview-refresh', onPreviewRefresh);
    return () => window.removeEventListener('devforge:preview-refresh', onPreviewRefresh);
  }, []);

  useEffect(() => {
    async function checkLocalPreview() {
      try {
        const r = await api.previewStatus(projectUuid);
        const data = r.data ?? {};
        if (data.status === 'running') {
          setPreviewStatus('running');
          if (typeof data.preview_url === 'string') {
            setLocalPreviewUrl(data.preview_url);
          }
          return;
        }
        const agents = await api.projectAgents(projectUuid);
        for (const agent of agents.data ?? []) {
          const msgs = await api.agentMessages(projectUuid, agent.uuid);
          for (const msg of msgs.data ?? []) {
            if (msg.tool_calls_json) {
              try {
                const tools = JSON.parse(msg.tool_calls_json);
                const url = previewUrlFromTools(tools);
                if (url) {
                  setLocalPreviewUrl(url);
                  return;
                }
              } catch {
                // Ignorer
              }
            }
          }
        }
      } catch {
        // Ignorer
      }
    }
    void checkLocalPreview();
  }, [projectUuid]);

  useEffect(() => {
    void refreshStatus();
    const id = window.setInterval(() => void refreshStatus(), 8000);
    return () => window.clearInterval(id);
  }, [refreshStatus]);

  async function handleStartServer(force = false) {
    setPreviewError(null);
    setPreviewErrorDetail(null);
    setPreviewBusy(true);
    setPreviewStatus('starting');
    try {
      const res = await api.previewStart(projectUuid, force);
      const data = res.data ?? {};
      const url = typeof data.preview_url === 'string' ? data.preview_url : null;
      if (data.ok && url) {
        setLocalPreviewUrl(url);
        setPreviewStatus('running');
        notifyPreviewRefresh({ url, reason: 'workspace-start' });
      } else if (data.ok) {
        setPreviewStatus('running');
        await refreshStatus();
      } else {
        setPreviewStatus('stopped');
        setPreviewError(
          typeof data.error === 'string'
            ? data.error
            : 'Impossible de démarrer le serveur de dev.',
        );
        const bits: string[] = [];
        if (typeof data.command === 'string' && data.command) {
          bits.push(`Commande : ${data.command}`);
        }
        if (typeof data.port === 'number') {
          const prod =
            typeof data.production_port === 'number' && data.production_port !== data.port
              ? ` (production : ${data.production_port})`
              : '';
          bits.push(`Port dev : ${data.port}${prod}`);
        }
        if (typeof data.hint === 'string' && data.hint) bits.push(data.hint);
        if (Array.isArray(data.env_keys) && data.env_keys.length > 0) {
          bits.push(`Variables DevForge : ${data.env_keys.join(', ')}`);
        }
        if (data.npm_install === false) {
          bits.push('npm i n’a pas pu installer les dépendances.');
        }
        if (typeof data.logs_tail === 'string' && data.logs_tail.trim()) {
          bits.push(data.logs_tail.trim());
        }
        setPreviewErrorDetail(bits.length ? bits.join('\n') : null);
      }
    } catch (e) {
      setPreviewStatus('stopped');
      setPreviewError(e instanceof Error ? e.message : 'Erreur au démarrage');
    } finally {
      setPreviewBusy(false);
    }
  }

  async function handleStopServer() {
    setPreviewError(null);
    setPreviewErrorDetail(null);
    setPreviewBusy(true);
    try {
      await api.previewStop(projectUuid);
      setPreviewStatus('stopped');
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Erreur à l’arrêt');
    } finally {
      setPreviewBusy(false);
    }
  }

  async function handleRestartServer() {
    await handleStartServer(true);
  }

  function handleOpenPreview() {
    setPreviewError(null);
    setAtelierTab('preview');
    setMobilePane('atelier');
  }

  const draftModal = (
    <DraftModal
      open={draftOpen}
      onClose={() => {
        setDraftOpen(false);
        setQuery((u) => u.searchParams.delete('draft'));
      }}
      uuid={projectUuid}
      name={project?.name ?? 'cette app'}
      draft={draft}
      onChanged={() => refreshDraft(true)}
    />
  );

  if (view === 'hub') {
    const running = previewStatus === 'running';
    const draftSubtitle = draft?.dirty ? (
      <div class="mt-1 flex min-w-0 flex-col items-center gap-1">
        <span class="max-w-full truncate text-[11px] text-[var(--color-warn)]">
          {filesLabel(draft.count)}
          {relativeFr(draft.updated_at) ? ` · ${relativeFr(draft.updated_at)}` : ''}
        </span>
        <AdviceChip advice={draft.advice} class="max-w-full text-[10.5px]" />
      </div>
    ) : (
      <div class="mt-1 truncate text-[11px] text-[var(--color-ink-muted)]">
        {draft?.backups?.length ? 'Vide · sauvegarde restaurable' : 'Rien en attente'}
      </div>
    );
    return (
      <FadeIn>
        <HubGrid cols={4}>
          <HubTile
            index={0}
            title="Brouillon"
            icon={<FileDiff size={26} aria-hidden />}
            subtitle={draftSubtitle}
            onClick={() => {
              setDraftOpen(true);
              setQuery((u) => u.searchParams.set('draft', '1'));
            }}
          />
          <HubTile
            index={1}
            title="Aperçu"
            icon={<MonitorPlay size={26} aria-hidden />}
            subtitle={
              <div class={cn('mt-1 truncate text-[11px]', running ? 'text-[var(--color-ok)]' : 'text-[var(--color-ink-muted)]')}>
                {previewBusy ? 'Patiente…' : running ? 'En marche' : previewStatus === 'starting' ? 'Démarrage…' : 'Arrêté'}
              </div>
            }
            footer={
              <Switch
                checked={running || previewStatus === 'starting'}
                disabled={previewBusy}
                label={running ? 'Arrêter l’aperçu' : 'Démarrer l’aperçu'}
                onToggle={() => void (running ? handleStopServer() : handleStartServer(false))}
              />
            }
            onClick={() => (running && localPreviewUrl ? setPreviewOpen(true) : setPreviewInfoOpen(true))}
          />
          <HubTile
            index={2}
            title="Fichiers"
            icon={<FileCode2 size={26} aria-hidden />}
            description="Code du dossier de travail"
            onClick={() => setFilesOpen(true)}
          />
          <HubTile
            index={3}
            title="Braise"
            icon={<MessageSquare size={26} aria-hidden />}
            description="Fils de travail et workers"
            onClick={() => {
              setView('chat');
              setQuery((u) => u.searchParams.set('view', 'chat'));
            }}
          />
        </HubGrid>
        {draftModal}
        <Modal
          open={filesOpen}
          onClose={() => setFilesOpen(false)}
          title="Fichiers"
          description="Le code du dossier de travail (brouillon compris)."
          size="xl"
        >
          <div class="h-[min(70vh,40rem)] overflow-hidden rounded-xl border border-[var(--color-line)]">
            <WorkspaceAtelier
              projectUuid={projectUuid}
              tab="files"
              onTab={() => {}}
              previewUrl={localPreviewUrl}
              previewStatus={previewStatus}
              onExpandPreview={() => {}}
            />
          </div>
        </Modal>
        <Modal
          open={previewInfoOpen}
          onClose={() => setPreviewInfoOpen(false)}
          title="Aperçu du brouillon"
          description="Lance l’app depuis le dossier de travail pour voir le brouillon avant de le valider."
          size="md"
          footer={
            <Button
              size="sm"
              class="max-lg:h-11"
              disabled={previewBusy}
              onClick={() =>
                void handleStartServer(false).then(() => {
                  setPreviewInfoOpen(false);
                })
              }
            >
              {previewBusy ? <Spinner /> : <MonitorPlay size={14} aria-hidden />}
              Démarrer l’aperçu
            </Button>
          }
        >
          {previewError ? (
            <div class="text-sm text-[var(--color-danger)]">
              <p>{previewError}</p>
              {previewErrorDetail && (
                <pre class="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-[var(--color-ink-muted)]">
                  {previewErrorDetail}
                </pre>
              )}
            </div>
          ) : (
            <p class="text-sm text-[var(--color-ink-muted)]">L’aperçu est arrêté.</p>
          )}
        </Modal>
        <PreviewModal open={previewOpen} onClose={() => setPreviewOpen(false)} previewUrl={localPreviewUrl} isProduction={false} />
      </FadeIn>
    );
  }

  return (
    <FadeIn>
      <button
        type="button"
        class="df-hit mb-2 inline-flex min-h-[40px] items-center gap-1.5 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        onClick={() => {
          setView('hub');
          setQuery((u) => {
            u.searchParams.delete('view');
            u.searchParams.delete('agent');
          });
        }}
      >
        <ChevronLeft size={16} aria-hidden />
        Workspace
      </button>
      {draftModal}
      <div
        class={cn(
          'flex flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] shadow-[0_16px_48px_rgb(0_0_0/0.28)]',
          // Mobile : laisser la place du dock bas (4,5 rem + safe area) pour que le composer reste visible.
          'h-[calc(100dvh-13rem-env(safe-area-inset-bottom,0px))] lg:h-[calc(100dvh-6rem)]',
        )}
      >
        <WorkspaceTopBar
          project={project}
          previewStatus={previewStatus}
          previewUrl={localPreviewUrl}
          previewBusy={previewBusy}
          onOpenPreview={handleOpenPreview}
          onStartServer={() => void handleStartServer(false)}
          onStopServer={() => void handleStopServer()}
          onRestartServer={() => void handleRestartServer()}
        />

        {previewError && (
          <div class="border-b border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-danger)] sm:px-4 sm:text-sm">
            <p>{previewError}</p>
            {previewErrorDetail && (
              <pre class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-[var(--color-ink-muted)]">
                {previewErrorDetail}
              </pre>
            )}
          </div>
        )}

        <div class="flex shrink-0 border-b border-[var(--color-line)] lg:hidden">
          <button
            type="button"
            class={cn(
              'flex-1 px-3 py-2 text-xs font-medium max-lg:min-h-11',
              mobilePane === 'chat' ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-muted)]',
            )}
            onClick={() => setMobilePane('chat')}
          >
            Chat
          </button>
          <button
            type="button"
            class={cn(
              'flex-1 px-3 py-2 text-xs font-medium max-lg:min-h-11',
              mobilePane === 'atelier' ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-muted)]',
            )}
            onClick={() => setMobilePane('atelier')}
          >
            Atelier
          </button>
        </div>

        <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
          <section
            class={cn(
              'min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-2 sm:p-3',
              mobilePane === 'chat' ? 'flex' : 'hidden lg:flex',
            )}
            aria-label="Chat agent"
          >
            <ProjectAgentsPanel
              projectUuid={projectUuid}
              defaultAgentUuid={builderAgentUuid}
              builderMode={builderMode}
              mode="threads"
              embedded
            />
          </section>
          <aside
            class={cn(
              'min-h-0 min-w-0 flex-1 flex-col border-[var(--color-line)] lg:max-w-[52%] lg:border-l',
              mobilePane === 'atelier' ? 'flex' : 'hidden lg:flex',
            )}
            aria-label="Preview et fichiers"
          >
            <WorkspaceAtelier
              projectUuid={projectUuid}
              tab={atelierTab}
              onTab={(tab) => {
                setAtelierTab(tab);
                setMobilePane('atelier');
              }}
              previewUrl={localPreviewUrl}
              previewStatus={previewStatus}
              onExpandPreview={() => {
                if (localPreviewUrl && previewStatus === 'running') setPreviewOpen(true);
              }}
            />
          </aside>
        </div>

        <PreviewModal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          previewUrl={localPreviewUrl}
          isProduction={false}
        />
      </div>
    </FadeIn>
  );
}
