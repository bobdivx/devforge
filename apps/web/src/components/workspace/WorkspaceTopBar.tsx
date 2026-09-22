import type { Project } from '../../lib/api';
import { Badge, Button } from '../ui';
import { projectStatusMeta } from '../../lib/status';
import { ExternalLink, Eye, Play, Rocket, RotateCw, Square } from 'lucide-preact';

export type PreviewServerStatus = 'stopped' | 'running' | 'starting';

type Props = {
  project: Project | null;
  previewStatus: PreviewServerStatus;
  previewUrl: string | null;
  previewBusy?: boolean;
  onOpenPreview: () => void;
  onStartServer: () => void;
  onStopServer: () => void;
  onRestartServer: () => void;
};

export function WorkspaceTopBar({
  project,
  previewStatus,
  previewUrl,
  previewBusy,
  onOpenPreview,
  onStartServer,
  onStopServer,
  onRestartServer,
}: Props) {
  const statusMeta = project ? projectStatusMeta(project.status) : null;
  const deploymentsHref = project
    ? `/app/projects/view?uuid=${encodeURIComponent(project.uuid)}&tab=deployments`
    : null;

  const serverBadge =
    previewStatus === 'running'
      ? { tone: 'ok' as const, label: 'Dev actif' }
      : previewStatus === 'starting'
        ? { tone: 'warn' as const, label: 'Démarrage…' }
        : { tone: 'neutral' as const, label: 'Dev arrêté' };

  return (
    <div class="flex h-12 min-w-0 shrink-0 items-center justify-between gap-2 overflow-x-auto border-b border-[var(--color-line)] bg-[var(--color-card)] px-2 sm:gap-3 sm:px-4">
      <div class="flex min-w-0 flex-1 items-center gap-2">
        {project && (
          <>
            <h1 class="truncate text-sm font-medium tracking-tight sm:text-base">{project.name}</h1>
            {statusMeta && (
              <Badge tone={statusMeta.tone} class="hidden shrink-0 transition-opacity duration-200 sm:inline-flex">
                {statusMeta.label}
              </Badge>
            )}
            <Badge tone={serverBadge.tone} class="hidden shrink-0 transition-opacity duration-200 sm:inline-flex" title="Serveur npm run dev (atelier)">
              {serverBadge.label}
            </Badge>
          </>
        )}
      </div>

      <div class="flex shrink-0 items-center gap-1">
        {previewStatus === 'stopped' ? (
          <Button
            size="icon"
            variant="secondary"
            motion={false}
            onClick={onStartServer}
            disabled={previewBusy}
            title="Démarrer npm run dev (npm i au premier démarrage)"
            aria-label="Démarrer le serveur de dev"
          >
            <Play size={14} strokeWidth={2} aria-hidden />
            <span class="hidden sm:inline">{previewBusy ? '…' : 'Démarrer'}</span>
          </Button>
        ) : (
          <>
            <Button
              size="icon"
              variant="ghost"
              motion={false}
              onClick={onStopServer}
              disabled={previewBusy || previewStatus === 'starting'}
              title="Arrêter le serveur de dev"
              aria-label="Arrêter le serveur de dev"
            >
              <Square size={14} strokeWidth={2} aria-hidden />
              <span class="hidden sm:inline">Arrêter</span>
            </Button>
            <Button
              size="icon"
              variant="ghost"
              motion={false}
              onClick={onRestartServer}
              disabled={previewBusy}
              title="Redémarrer npm run dev"
              aria-label="Redémarrer le serveur de dev"
            >
              <RotateCw size={14} strokeWidth={2} aria-hidden />
              <span class="hidden sm:inline">Redémarrer</span>
            </Button>
          </>
        )}

        <Button
          size="icon"
          variant="secondary"
          motion={false}
          onClick={onOpenPreview}
          disabled={previewBusy}
          title="Afficher la preview atelier à côté du chat"
          aria-label="Ouvrir la preview"
        >
          <Eye size={14} strokeWidth={2} aria-hidden />
          <span class="hidden sm:inline">Preview</span>
        </Button>

        {deploymentsHref && (
          <Button
            size="icon"
            variant="ghost"
            motion={false}
            href={deploymentsHref}
            title="Déploiements production (conteneur Docker séparé)"
            aria-label="Déploiements"
          >
            <Rocket size={14} strokeWidth={2} aria-hidden />
            <span class="hidden sm:inline text-[var(--color-ink-muted)]">Déployer</span>
          </Button>
        )}

        {project?.production_url && (
          <Button
            size="icon"
            variant="ghost"
            motion={false}
            href={project.production_url}
            target="_blank"
            title="Ouvrir le site en production (nouvel onglet)"
            aria-label="Ouvrir en production"
          >
            <ExternalLink size={14} strokeWidth={2} aria-hidden />
            <span class="hidden sm:inline">Prod</span>
          </Button>
        )}
      </div>
    </div>
  );
}
