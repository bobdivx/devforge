import type { Project } from '../../lib/api';
import { Badge, Button } from '../ui';
import { projectStatusMeta } from '../../lib/status';
import { cn } from '../../lib/cn';

type Props = {
  project: Project | null;
  previewUrl: string | null;
  onOpenPreview: () => void;
  previewAvailable: boolean;
};

export function WorkspaceTopBar({ project, previewUrl, onOpenPreview, previewAvailable }: Props) {
  const statusMeta = project ? projectStatusMeta(project.status) : null;

  return (
    <div class="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-line)] bg-[var(--color-card)] px-4">
      <div class="flex min-w-0 items-center gap-3">
        {project && (
          <>
            <h1 class="truncate text-base font-medium tracking-tight">{project.name}</h1>
            {statusMeta && (
              <Badge tone={statusMeta.tone} class="shrink-0">
                {statusMeta.label}
              </Badge>
            )}
          </>
        )}
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={onOpenPreview}
          disabled={!previewAvailable}
          title={previewAvailable ? 'Ouvrir la preview' : 'Aucune preview disponible'}
        >
          Preview
        </Button>
        {project?.production_url && (
          <Button
            size="sm"
            variant="ghost"
            href={project.production_url}
            target="_blank"
            title="Ouvrir le site en production"
          >
            Ouvrir en prod
          </Button>
        )}
      </div>
    </div>
  );
}
