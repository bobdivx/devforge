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
    if (localPreviewUrl && previewStatus === 'running') {
      setPreviewOpen(true);
    }
  }

  return (
    <FadeIn>
      <div
        class={cn(
          'flex flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] shadow-[0_16px_48px_rgb(0_0_0/0.28)]',
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
            <p>{previewError}</p>
            {previewErrorDetail && (
              <pre class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-[var(--color-ink-muted)]">
                {previewErrorDetail}
              </pre>
            )}
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
