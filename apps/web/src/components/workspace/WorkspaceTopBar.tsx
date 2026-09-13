import type { Project } from '../../lib/api';
import { Badge, Button } from '../ui';
import { projectStatusMeta } from '../../lib/status';
import { ExternalLink, Eye } from 'lucide-preact';

type Props = {
  project: Project | null;
  /** Preview atelier disponible (URL dev- déjà connue) */
  previewAvailable: boolean;
  previewStarting?: boolean;
  onOpenPreview: () => void;
};

export function WorkspaceTopBar({
  project,
  previewAvailable,
  previewStarting,
  onOpenPreview,
}: Props) {
  const statusMeta = project ? projectStatusMeta(project.status) : null;
  const deploymentsHref = project
    ? `/app/projects/view?uuid=${encodeURIComponent(project.uuid)}&tab=deployments`
    : null;

  return (
    <div class="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[var(--color-line)] bg-[var(--color-card)] px-3 sm:gap-3 sm:px-4">
      <div class="flex min-w-0 items-center gap-2">
        {project && (
          <>
            <h1 class="truncate text-sm font-medium tracking-tight sm:text-base">{project.name}</h1>
            {statusMeta && (
              <Badge tone={statusMeta.tone} class="hidden shrink-0 sm:inline-flex">
                {statusMeta.label}
              </Badge>
            )}
            <Badge tone="neutral" class="hidden shrink-0 sm:inline-flex" title="Éditions dans le workdir local">
              Atelier
            </Badge>
          </>
        )}
      </div>

      <div class="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant="secondary"
          onClick={onOpenPreview}
          disabled={previewStarting}
          title={
            previewStarting
              ? 'Démarrage de la preview…'
              : previewAvailable
                ? 'Ouvrir la preview atelier (dev-…)'
                : 'Démarrer et ouvrir la preview atelier'
          }
          aria-label="Ouvrir la preview"
        >
          <Eye size={14} strokeWidth={2} aria-hidden />
          <span class="hidden sm:inline">{previewStarting ? '…' : 'Preview'}</span>
        </Button>

        {deploymentsHref && (
          <Button
            size="sm"
            variant="ghost"
            href={deploymentsHref}
            title="Déploiements production (hors atelier)"
            aria-label="Déploiements"
          >
            <span class="hidden md:inline text-[var(--color-ink-muted)]">Déployer</span>
          </Button>
        )}

        {project?.production_url && (
          <Button
            size="sm"
            variant="ghost"
            href={project.production_url}
            target="_blank"
            title="Ouvrir le site en production (nouvel onglet)"
            aria-label="Ouvrir en production"
          >
            <ExternalLink size={14} strokeWidth={2} aria-hidden />
            <span class="hidden md:inline">Prod</span>
          </Button>
        )}
      </div>
    </div>
  );
}
