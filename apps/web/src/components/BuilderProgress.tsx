import { useEffect, useState } from 'preact/hooks';
import { api, type ProjectAgent, type Deployment } from '../lib/api';
import { cn } from '../lib/cn';
import { Card, Spinner, Button } from './ui';

type BuildStep = {
  id: string;
  label: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  detail?: string;
};

type Props = {
  projectUuid: string;
  agentUuid?: string;
  onComplete?: () => void;
  /** Workflow local-first : template → preview → publish */
  localFirst?: boolean;
};

/**
 * BuilderProgress — affiche les étapes de construction d'un projet
 * avec animations. Supporte 2 workflows :
 * - Classic : scaffold → GitHub → deploy → preview
 * - Local-first : template local → preview → validation → publish
 */
export function BuilderProgress({ projectUuid, agentUuid, onComplete, localFirst }: Props) {
  const initialSteps: BuildStep[] = localFirst
    ? [
        { id: 'template', label: 'Template prêt', status: 'completed' },
        { id: 'preview', label: 'Preview locale', status: 'in_progress', detail: 'Test l\'application localement' },
        { id: 'validate', label: 'Validation', status: 'pending', detail: 'Cliquez sur « Valider et publier » quand prêt' },
        { id: 'publish', label: 'Publication GitHub', status: 'pending' },
        { id: 'deploy', label: 'Déploiement', status: 'pending' },
      ]
    : [
        { id: 'project', label: 'Projet créé', status: 'completed' },
        { id: 'template', label: 'Template appliqué', status: 'pending' },
        { id: 'github', label: 'Dépôt GitHub', status: 'pending' },
        { id: 'files', label: 'Fichiers synchronisés', status: 'pending' },
        { id: 'deploy', label: 'Déploiement', status: 'pending' },
        { id: 'preview', label: 'Preview prête', status: 'pending' },
      ];

  const [steps, setSteps] = useState<BuildStep[]>(initialSteps);
  const [agent, setAgent] = useState<ProjectAgent | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  useEffect(() => {
    if (!agentUuid && !localFirst) return;

    const interval = setInterval(async () => {
      try {
        // Workflow local-first : pas de polling agent messages
        if (localFirst) {
          // Vérifier si déjà publié (git_repository existe)
          try {
            const proj = await api.project(projectUuid);
            const hasRepo = proj.data.git_repository && proj.data.git_repository.trim() !== '';
            
            if (hasRepo) {
              const newSteps = [...steps];
              const publishIdx = newSteps.findIndex((s) => s.id === 'publish');
              if (publishIdx !== -1 && newSteps[publishIdx].status === 'pending') {
                newSteps[publishIdx].status = 'completed';
                setSteps(newSteps);
              }
              
              // Vérifier le déploiement
              const deployments = await api.deployments(projectUuid);
              if (deployments.data && deployments.data.length > 0) {
                const latest = deployments.data[0];
                const deployIdx = newSteps.findIndex((s) => s.id === 'deploy');
                
                if (deployIdx !== -1) {
                  if (latest.status === 'deployed' || latest.status === 'success' || latest.status === 'running') {
                    newSteps[deployIdx].status = 'completed';
                    setSteps(newSteps);
                    if (onComplete) {
                      setTimeout(() => onComplete(), 1000);
                    }
                    clearInterval(interval);
                  } else if (latest.status === 'deploying' || latest.status === 'building' || latest.status === 'pending') {
                    newSteps[deployIdx].status = 'in_progress';
                    setSteps(newSteps);
                  } else if (latest.status === 'failed' || latest.status === 'error') {
                    newSteps[deployIdx].status = 'failed';
                    newSteps[deployIdx].detail = 'Échec du déploiement';
                    setSteps(newSteps);
                  }
                }
              }
            }
          } catch {
            // Ignorer erreur
          }
          
          setPollCount((c) => c + 1);
          if (pollCount > 120) {
            clearInterval(interval);
          }
          return;
        }

        // Workflow classic : polling agent messages
        const messages = await api.agentMessages(projectUuid, agentUuid!);
        
        const agents = await api.projectAgents(projectUuid);
        const currentAgent = agents.data.find((a) => a.uuid === agentUuid);
        setAgent(currentAgent || null);

        const newSteps = [...steps];
        let hasChanges = false;

        for (const msg of messages.data) {
          if (msg.role !== 'assistant' || !msg.tool_calls_json) continue;
          
          try {
            const tools = JSON.parse(msg.tool_calls_json) as Array<{ name?: string }>;
            
            for (const tool of tools) {
              if (!tool.name) continue;

              if (tool.name.includes('write_project_file') || tool.name.includes('scaffold')) {
                const idx = newSteps.findIndex((s) => s.id === 'template');
                if (idx !== -1 && newSteps[idx].status === 'pending') {
                  newSteps[idx].status = 'completed';
                  hasChanges = true;
                }
              }

              if (tool.name.includes('create_github_repo') || tool.name.includes('github')) {
                const idx = newSteps.findIndex((s) => s.id === 'github');
                if (idx !== -1 && newSteps[idx].status === 'pending') {
                  newSteps[idx].status = 'completed';
                  hasChanges = true;
                }
              }

              if (tool.name.includes('write_project_file')) {
                const idx = newSteps.findIndex((s) => s.id === 'files');
                if (idx !== -1 && newSteps[idx].status === 'pending') {
                  newSteps[idx].status = 'in_progress';
                  hasChanges = true;
                }
              }

              if (tool.name.includes('trigger_deploy') || tool.name.includes('deploy')) {
                const filesIdx = newSteps.findIndex((s) => s.id === 'files');
                if (filesIdx !== -1 && newSteps[filesIdx].status === 'in_progress') {
                  newSteps[filesIdx].status = 'completed';
                  hasChanges = true;
                }
                const idx = newSteps.findIndex((s) => s.id === 'deploy');
                if (idx !== -1 && newSteps[idx].status === 'pending') {
                  newSteps[idx].status = 'in_progress';
                  hasChanges = true;
                }
              }
            }
          } catch {
            // Ignorer erreur parsing
          }
        }

        // Vérifier le déploiement
        try {
          const deployments = await api.deployments(projectUuid);
          if (deployments.data && deployments.data.length > 0) {
            const latest = deployments.data[0];
            const deployIdx = newSteps.findIndex((s) => s.id === 'deploy');
            
            if (deployIdx !== -1) {
              if (latest.status === 'deployed' || latest.status === 'success' || latest.status === 'running') {
                if (newSteps[deployIdx].status !== 'completed') {
                  newSteps[deployIdx].status = 'completed';
                  hasChanges = true;
                }
              } else if (latest.status === 'deploying' || latest.status === 'building' || latest.status === 'pending') {
                if (newSteps[deployIdx].status === 'pending') {
                  newSteps[deployIdx].status = 'in_progress';
                  hasChanges = true;
                }
              } else if (latest.status === 'failed' || latest.status === 'error') {
                if (newSteps[deployIdx].status !== 'failed') {
                  newSteps[deployIdx].status = 'failed';
                  newSteps[deployIdx].detail = 'Échec du déploiement';
                  hasChanges = true;
                }
              }
            }
          }
        } catch {
          // Ignorer erreur deployments
        }

        // Vérifier si preview est prête
        try {
          const proj = await api.project(projectUuid);
          if (proj.data.production_url) {
            const previewIdx = newSteps.findIndex((s) => s.id === 'preview');
            if (previewIdx !== -1 && newSteps[previewIdx].status !== 'completed') {
              newSteps[previewIdx].status = 'completed';
              hasChanges = true;
              if (onComplete) {
                setTimeout(() => onComplete(), 1000);
              }
            }
          }
        } catch {
          // Ignorer erreur project
        }

        if (hasChanges) {
          setSteps(newSteps);
        }

        setPollCount((c) => c + 1);

        const previewReady = newSteps.find((s) => s.id === 'preview')?.status === 'completed';
        const agentIdle = currentAgent?.status === 'idle';
        
        if (pollCount > 60 || (previewReady && agentIdle)) {
          clearInterval(interval);
        }
      } catch (err) {
        console.error('[BuilderProgress] Poll error:', err);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [agentUuid, projectUuid, pollCount, localFirst]);

  const handlePublish = async () => {
    setPublishing(true);
    setPublishError(null);

    try {
      const response = await fetch(`/api/v1/projects/${projectUuid}/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok || !data.data?.ok) {
        throw new Error(data.data?.error || 'Échec de la publication');
      }

      // Marquer validate + publish comme completed
      const newSteps = [...steps];
      const validateIdx = newSteps.findIndex((s) => s.id === 'validate');
      if (validateIdx !== -1) {
        newSteps[validateIdx].status = 'completed';
      }
      const publishIdx = newSteps.findIndex((s) => s.id === 'publish');
      if (publishIdx !== -1) {
        newSteps[publishIdx].status = 'in_progress';
        newSteps[publishIdx].detail = 'Publication en cours...';
      }
      setSteps(newSteps);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Erreur inconnue');
      const newSteps = [...steps];
      const publishIdx = newSteps.findIndex((s) => s.id === 'publish');
      if (publishIdx !== -1) {
        newSteps[publishIdx].status = 'failed';
        newSteps[publishIdx].detail = err instanceof Error ? err.message : 'Erreur inconnue';
      }
      setSteps(newSteps);
    } finally {
      setPublishing(false);
    }
  };

  const validateStep = steps.find((s) => s.id === 'validate');
  const showPublishButton = localFirst && validateStep && validateStep.status === 'pending';

  return (
    <Card class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <h3 class="font-medium">
          {localFirst ? 'Étapes de publication' : 'Construction en cours'}
        </h3>
        {agent?.status === 'working' && !localFirst && (
          <div class="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
            <Spinner class="h-3 w-3" />
            <span>Agent actif</span>
          </div>
        )}
      </div>

      <div class="space-y-3">
        {steps.map((step, i) => {
          const isActive = step.status === 'in_progress';
          const isDone = step.status === 'completed';
          const isFailed = step.status === 'failed';

          return (
            <div key={step.id} class="flex items-start gap-3">
              {/* Icône de statut */}
              <div class="relative flex h-6 w-6 shrink-0 items-center justify-center">
                {isDone ? (
                  <div class="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-ok)] text-white animate-[scale-in_0.3s_ease-out]">
                    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : isFailed ? (
                  <div class="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-danger)] text-white">
                    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                ) : isActive ? (
                  <div class="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent" />
                ) : (
                  <div class="h-6 w-6 rounded-full border-2 border-[var(--color-line)]" />
                )}

                {/* Ligne de connexion */}
                {i < steps.length - 1 && (
                  <div
                    class={cn(
                      'absolute left-[11px] top-6 h-6 w-0.5 transition-colors',
                      isDone ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-line)]',
                    )}
                  />
                )}
              </div>

              {/* Label */}
              <div class="flex-1 pt-0.5">
                <p
                  class={cn(
                    'text-sm font-medium transition-colors',
                    isDone && 'text-[var(--color-ok)]',
                    isFailed && 'text-[var(--color-danger)]',
                    isActive && 'text-[var(--color-accent)]',
                    step.status === 'pending' && 'text-[var(--color-ink-muted)]',
                  )}
                >
                  {step.label}
                </p>
                {step.detail && (
                  <p class="mt-0.5 text-xs text-[var(--color-ink-faint)]">{step.detail}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showPublishButton && (
        <div class="mt-2 pt-3 border-t border-[var(--color-line)]">
          <Button
            variant="primary"
            class="w-full"
            onClick={handlePublish}
            disabled={publishing}
          >
            {publishing ? (
              <>
                <Spinner class="h-4 w-4 mr-2" />
                Publication en cours...
              </>
            ) : (
              <>
                <svg class="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Valider et publier
              </>
            )}
          </Button>
          {publishError && (
            <p class="mt-2 text-xs text-[var(--color-danger)]">{publishError}</p>
          )}
        </div>
      )}

      <p class="mt-2 text-xs text-[var(--color-ink-faint)]">
        {localFirst 
          ? 'Testez votre application dans la preview, puis cliquez sur « Valider et publier » pour créer le dépôt GitHub et déployer.'
          : 'Les étapes se mettent à jour automatiquement. Consultez le chat pour plus de détails.'
        }
      </p>
    </Card>
  );
}
