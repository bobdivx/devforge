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
import { FadeIn } from './ui';
import type { Project } from '../lib/api';

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
  const [previewOpen, setPreviewOpen] = useState(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [previewStatus, setPreviewStatus] = useState<PreviewServerStatus>('stopped');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

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
    if (localPreviewUrl && previewStatus === 'running') {
      setPreviewOpen(true);
    }
  }

  return (
    <FadeIn>
      <div
        class={cn(
          'flex flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-card)]',
          'h-[calc(100dvh-8.5rem)] lg:h-[calc(100dvh-6rem)]',
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
            {previewError}
          </div>
        )}

        <section class="min-h-0 flex-1 overflow-y-auto" aria-label="Chat agent">
          <div class="mx-auto h-full max-w-3xl p-3 sm:p-4">
            <ProjectAgentsPanel
              projectUuid={projectUuid}
              defaultAgentUuid={builderAgentUuid}
              builderMode={builderMode}
              mode="threads"
            />
          </div>
        </section>

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
