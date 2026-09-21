import { api, type ClusterNode, type Project } from '../lib/api';
import { nodeShortLabel } from '../lib/cluster-display';
import { projectStatusMeta, projectSyncMeta } from '../lib/status';
import { cn } from '../lib/cn';
import { AppShell } from './AppShell';
import { AppIcon, statusDotClass } from './AppIcon';
import { Alert, HubAddTile, HubGrid, Skeleton } from './ui';
import { enterUp, interactiveLift, motion } from '../lib/motion';
import { useEffect, useState } from 'preact/hooks';
import { NewGithubAppWizard } from './NewGithubAppWizard';
import { NewBuilderWizard } from './NewBuilderWizard';

function AppCard({
  project,
  index,
  nodes,
}: {
  project: Project;
  index: number;
  nodes: ClusterNode[];
}) {
  const status = projectStatusMeta(project.status);
  const sync = projectSyncMeta(project.sync);
  const badgeTone = status.tone === 'ok' ? 'ok' : status.tone;
  const showSyncWarn = sync.tone === 'warn' || sync.tone === 'danger';
  const node = nodeShortLabel(nodes, project.server_id);

  return (
    <a
      href={`/app/projects/view?uuid=${encodeURIComponent(project.uuid)}`}
      class="group flex aspect-square h-full w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl bg-[#1c1c1e] px-3 py-4"
      animate={motion(enterUp(Math.min(index * 0.04, 0.28)), interactiveLift())}
    >
        <div class="relative">
          <AppIcon project={project} statusTone={status.tone} class="group-hover:scale-[1.03]" />

          <span
            class={cn(
              'absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full ring-2 ring-[#1c1c1e]',
              statusDotClass(status.tone),
              status.tone === 'ok' || status.tone === 'warn' ? 'animate-pulse' : '',
            )}
            title={status.label}
            aria-hidden
          />

          {showSyncWarn && (
            <span
              class="absolute -bottom-1 -left-1 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-950"
              title={sync.title || sync.label}
            >
              Sync
            </span>
          )}
        </div>

        <div class="w-full text-center">
          <div class="truncate text-sm font-medium text-white">{project.name}</div>
          <div
            class={cn(
              'mt-1 text-[11px] font-medium',
              badgeTone === 'ok' && 'text-[var(--color-ok)]',
              badgeTone === 'warn' && 'text-[var(--color-warn)]',
              badgeTone === 'danger' && 'text-[var(--color-danger)]',
              badgeTone === 'neutral' && 'text-[var(--color-ink-faint)]',
            )}
          >
            {status.label}
          </div>
          <div class="mt-0.5 truncate text-[10px] text-[var(--color-ink-faint)]">{node}</div>
        </div>
    </a>
  );
}

export function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [nodes, setNodes] = useState<ClusterNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardMode, setWizardMode] = useState<'choice' | 'github' | 'builder'>('choice');

  // Fonction pour charger les projets
  async function loadProjects() {
    try {
      const [r, n] = await Promise.all([
        api.projects(),
        api.clusterNodes().catch(() => null),
      ]);
      setProjects(r.data);
      if (n?.nodes) setNodes(n.nodes);
      setError(null);
    } catch (e: unknown) {
      // Soft-fail: ne pas écraser les projets existants en cas d'erreur pendant le polling
      if (projects.length === 0) {
        setError(String((e as Error).message || e));
      }
    } finally {
      if (loading) {
        setLoading(false);
      }
    }
  }

  // Chargement initial
  useEffect(() => {
    loadProjects();
  }, []);

  // Polling automatique avec gestion de la visibilité
  useEffect(() => {
    // Détermine l'intervalle de polling en fonction de l'état des projets
    // 5-8s si un projet est en déploiement/building/queued ou sync behind/deploying/error
    // 15-20s sinon
    const shouldPollFast = projects.some(
      (p) =>
        ['deploying', 'building', 'queued'].includes(p.status) ||
        ['behind', 'deploying', 'error'].includes(p.sync?.state || ''),
    );
    const interval = shouldPollFast ? 7000 : 17000; // 7s ou 17s (milieux des plages demandées)

    // Ne démarre pas le polling immédiatement si on est en loading initial
    if (loading) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    let isVisible = !document.hidden;

    const handleVisibilityChange = () => {
      const wasVisible = isVisible;
      isVisible = !document.hidden;

      if (!wasVisible && isVisible) {
        // On redevient visible : charge immédiatement et redémarre le timer
        loadProjects();
        startPolling();
      } else if (wasVisible && !isVisible) {
        // On devient caché : arrête le polling
        stopPolling();
      }
    };

    const startPolling = () => {
      stopPolling();
      if (isVisible) {
        timer = setInterval(() => {
          loadProjects();
        }, interval);
      }
    };

    const stopPolling = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    // Démarre le polling si visible
    if (isVisible) {
      startPolling();
    }

    // Écoute les changements de visibilité
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loading, projects]);

  function openWizard() {
    setWizardMode('choice');
    setWizardOpen(true);
  }

  function closeWizard() {
    setWizardMode('choice');
    setWizardOpen(false);
  }

  return (
    <AppShell active="home" title="Applications">
      {error && (
        <Alert tone="warn" class="mb-4">
          Impossible de joindre le serveur.
        </Alert>
      )}

      {loading ? (
        <HubGrid cols={5}>
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} class="aspect-square rounded-2xl" />
          ))}
        </HubGrid>
      ) : (
        <HubGrid cols={5}>
          {projects.map((p, i) => (
            <AppCard key={p.uuid} project={p} index={i} nodes={nodes} />
          ))}

          <HubAddTile index={projects.length} label="Ajouter" onClick={openWizard} />
        </HubGrid>
      )}

      {!loading && !error && projects.length === 0 && (
        <p class="mt-6 text-center text-sm text-[var(--color-ink-muted)]">
          Aucune application pour l'instant. Crée-en une pour commencer.
        </p>
      )}

      {wizardOpen && (
        <div class="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <button
            type="button"
            aria-label="Fermer"
            class="df-modal-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={closeWizard}
          />
          <div class="df-modal-panel relative z-10 w-full max-w-2xl rounded-t-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-6 shadow-2xl sm:rounded-2xl">
            <div class="mb-4 flex items-start justify-between">
              <div>
                <h2 class="text-xl font-semibold">Nouvelle application</h2>
                <p class="mt-1 text-sm text-[var(--color-ink-muted)]">
                  {wizardMode === 'choice' && 'Choisis ta méthode'}
                  {wizardMode === 'github' && 'Importer depuis GitHub'}
                  {wizardMode === 'builder' && 'Créer avec un agent'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeWizard}
                class="rounded-lg px-2 py-1 text-[var(--color-ink-muted)] transition duration-200 hover:bg-white/5 hover:text-white"
                aria-label="Fermer"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            {wizardMode === 'choice' && (
              <div class="space-y-3">
                <button
                  type="button"
                  onClick={() => setWizardMode('builder')}
                  class="group flex w-full flex-col gap-2 rounded-xl border border-[var(--color-line)] p-4 text-left transition-[border-color,background-color,transform] duration-200 hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] active:scale-[0.99]"
                >
                  <div class="flex items-center gap-2">
                    <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-accent-soft)] text-[var(--color-accent)] transition-transform duration-200 group-hover:scale-105">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 20h9M12 4L4 8l8 4 8-4-8-4zM4 12l8 4 8-4" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </div>
                    <span class="font-semibold">Créer avec un agent</span>
                  </div>
                  <p class="text-sm text-[var(--color-ink-muted)]">
                    Décris ton app en français, l'agent DevForge scaffold le projet et configure le build.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setWizardMode('github')}
                  class="group flex w-full flex-col gap-2 rounded-xl border border-[var(--color-line)] p-4 text-left transition-[border-color,background-color,transform] duration-200 hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] active:scale-[0.99]"
                >
                  <div class="flex items-center gap-2">
                    <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-surface)] text-white transition-transform duration-200 group-hover:scale-105">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                      </svg>
                    </div>
                    <span class="font-semibold">Importer depuis GitHub</span>
                  </div>
                  <p class="text-sm text-[var(--color-ink-muted)]">
                    Configure un repo existant : branche, build, domaine, env vars.
                  </p>
                </button>
              </div>
            )}

            {wizardMode === 'builder' && <NewBuilderWizard bare onClose={closeWizard} />}
            {wizardMode === 'github' && <NewGithubAppWizard bare />}
          </div>
        </div>
      )}
    </AppShell>
  );
}
