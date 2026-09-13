import { useEffect, useState } from 'preact/hooks';
import { api, type Project } from '../lib/api';
import { previewUrlFromTools } from '../lib/agent-stream';
import { cn } from '../lib/cn';
import { ProjectAgentsPanel } from './ProjectAgentsPanel';
import { WorkspaceTopBar } from './workspace/WorkspaceTopBar';
import { WorkspaceDock } from './workspace/WorkspaceDock';
import { PreviewModal } from './workspace/PreviewModal';
import { DeploymentsSheet } from './workspace/DeploymentsSheet';
import { LogsSheet } from './workspace/LogsSheet';
import { EnvSheet } from './workspace/EnvSheet';
import { FadeIn } from './ui';

type Props = {
  projectUuid: string;
  project: Project | null;
  builderMode?: boolean;
  builderAgentUuid?: string;
};

type DockPanel = 'chat' | 'steps' | 'deployments' | 'logs' | 'env';

export function ProjectWorkspace({ projectUuid, project, builderMode, builderAgentUuid }: Props) {
  const [activePanel, setActivePanel] = useState<DockPanel>('chat');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    function onPreviewRefresh(ev: Event) {
      const detail = (ev as CustomEvent<{ url?: string; reason?: string }>).detail;
      if (detail?.url) {
        setPreviewUrl(detail.url);
      }
    }
    window.addEventListener('devforge:preview-refresh', onPreviewRefresh);
    return () => window.removeEventListener('devforge:preview-refresh', onPreviewRefresh);
  }, []);

  useEffect(() => {
    async function checkPreview() {
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
                  setPreviewUrl(url);
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
    void checkPreview();
  }, [projectUuid]);

  const displayPreviewUrl = previewUrl || project?.production_url || null;
  const isPreviewProduction = !previewUrl && !!project?.production_url;

  return (
    <FadeIn>
      <div class="flex h-[calc(100dvh-5rem)] flex-col overflow-hidden">
        <WorkspaceTopBar
          project={project}
          previewUrl={displayPreviewUrl}
          onOpenPreview={() => setPreviewOpen(true)}
          previewAvailable={!!displayPreviewUrl}
        />

        <div
          class={cn(
            'flex-1 overflow-hidden',
            // Laisse de la place pour le dock en bas (4rem + safe area)
            'pb-[calc(4rem+env(safe-area-inset-bottom,0px))]',
          )}
        >
          <div class="h-full overflow-y-auto">
            {activePanel === 'chat' && (
              <div class="mx-auto max-w-5xl p-4">
                <ProjectAgentsPanel
                  projectUuid={projectUuid}
                  defaultAgentUuid={builderAgentUuid}
                  builderMode={builderMode}
                />
              </div>
            )}

            {activePanel === 'steps' && (
              <div class="flex h-full items-center justify-center p-4">
                <div class="max-w-md text-center">
                  <div class="mb-4 text-4xl">⚡</div>
                  <h3 class="mb-2 font-medium">Étapes de l'agent</h3>
                  <p class="text-sm text-[var(--color-ink-muted)]">
                    Les actions de l'agent s'affichent dans le chat pendant qu'il travaille.
                  </p>
                </div>
              </div>
            )}

            {activePanel === 'deployments' && (
              <DeploymentsSheet
                open={true}
                onClose={() => setActivePanel('chat')}
                projectUuid={projectUuid}
              />
            )}

            {activePanel === 'logs' && (
              <LogsSheet
                open={true}
                onClose={() => setActivePanel('chat')}
                projectUuid={projectUuid}
              />
            )}

            {activePanel === 'env' && (
              <EnvSheet
                open={true}
                onClose={() => setActivePanel('chat')}
                projectUuid={projectUuid}
              />
            )}
          </div>
        </div>

        <WorkspaceDock
          active={activePanel}
          onSelect={setActivePanel}
        />

        <PreviewModal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          previewUrl={displayPreviewUrl}
          isProduction={isPreviewProduction}
        />
      </div>
    </FadeIn>
  );
}
