import { useEffect, useState } from 'preact/hooks';
import { Loader2 } from 'lucide-preact';
import { api, type Project } from '../lib/api';
import { notifyPreviewRefresh, previewUrlFromTools } from '../lib/agent-stream';
import { cn } from '../lib/cn';
import { ProjectAgentsPanel } from './ProjectAgentsPanel';
import { WorkspaceTopBar } from './workspace/WorkspaceTopBar';
import { PreviewModal } from './workspace/PreviewModal';
import { FadeIn } from './ui';

type Props = {
  projectUuid: string;
  project: Project | null;
  builderMode?: boolean;
  builderAgentUuid?: string;
};

/**
 * Workspace = atelier local (chat + workdir + preview).
 * Preview démarre toute seule (API / tool) — pas besoin de « demander à l’agent ».
 */
export function ProjectWorkspace({ projectUuid, project, builderMode, builderAgentUuid }: Props) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [previewStarting, setPreviewStarting] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    function onPreviewRefresh(ev: Event) {
      const detail = (ev as CustomEvent<{ url?: string; reason?: string }>).detail;
      if (detail?.url) {
        setLocalPreviewUrl(detail.url);
        setPreviewError(null);
      }
    }
    window.addEventListener('devforge:preview-refresh', onPreviewRefresh);
    return () => window.removeEventListener('devforge:preview-refresh', onPreviewRefresh);
  }, []);

  useEffect(() => {
    async function checkLocalPreview() {
      try {
        const r = await api.projectAgents(projectUuid);
        for (const agent of r.data ?? []) {
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

  async function handleOpenPreview() {
    setPreviewError(null);
    if (localPreviewUrl) {
      setPreviewOpen(true);
      return;
    }

    setPreviewStarting(true);
    try {
      const res = await api.executeAgentTool('start_local_preview', {
        project_uuid: projectUuid,
      });
      const data = res.data ?? {};
      const url = typeof data.preview_url === 'string' ? data.preview_url : null;
      if (data.ok && url) {
        setLocalPreviewUrl(url);
        notifyPreviewRefresh({ url, reason: 'workspace-preview-button' });
        setPreviewOpen(true);
      } else {
        setPreviewError(
          typeof data.error === 'string'
            ? data.error
            : 'Impossible de démarrer la preview atelier.',
        );
      }
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Erreur au démarrage de la preview');
    } finally {
      setPreviewStarting(false);
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
          previewAvailable={!!localPreviewUrl}
          previewStarting={previewStarting}
          onOpenPreview={handleOpenPreview}
        />

        {previewError && (
          <div class="border-b border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-danger)] sm:px-4 sm:text-sm">
            {previewError}
          </div>
        )}

        {previewStarting && !previewOpen && (
          <div class="flex items-center gap-2 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-ink-muted)] sm:px-4 sm:text-sm">
            <Loader2 size={14} class="animate-spin shrink-0" aria-hidden />
            Démarrage de la preview atelier…
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
