import { api, type Project } from '../lib/api';
import { projectStatusMeta, projectSyncMeta } from '../lib/status';
import { cn } from '../lib/cn';
import { AppShell } from './AppShell';
import { AppIcon, statusDotClass } from './AppIcon';
import { Alert, FadeIn, Skeleton } from './ui';
import { useEffect, useState } from 'preact/hooks';
import { NewGithubAppWizard } from './NewGithubAppWizard';

function AppCard({ project, index }: { project: Project; index: number }) {
  const status = projectStatusMeta(project.status);
  const sync = projectSyncMeta(project.sync);
  const badgeTone = status.tone === 'ok' ? 'ok' : status.tone;
  const showSyncWarn = sync.tone === 'warn' || sync.tone === 'danger';

  return (
    <FadeIn delay={Math.min(index * 40, 280)}>
      <a
        href={`/app/projects/view?uuid=${encodeURIComponent(project.uuid)}`}
        class="group flex aspect-square flex-col items-center justify-center gap-3 rounded-2xl bg-[#1c1c1e] px-3 py-4 transition duration-200 hover:-translate-y-0.5 hover:bg-[#252528] hover:ring-1 hover:ring-white/10"
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
        </div>
      </a>
    </FadeIn>
  );
}

export function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    api
      .projects()
      .then((r) => setProjects(r.data))
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell active="home" title="Applications">
      {error && (
        <Alert tone="warn" class="mb-4">
          Impossible de joindre le serveur.
        </Alert>
      )}

      {loading ? (
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} class="aspect-square rounded-2xl" />
          ))}
        </div>
      ) : (
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
          {projects.map((p, i) => (
            <AppCard key={p.uuid} project={p} index={i} />
          ))}

          <FadeIn delay={Math.min(projects.length * 40, 280)}>
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              class="flex aspect-square flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/15 bg-transparent px-3 py-4 text-[var(--color-ink-muted)] transition hover:border-white/30 hover:bg-white/[0.03] hover:text-white"
            >
              <div class="flex h-16 w-16 items-center justify-center rounded-[1.15rem] border border-dashed border-white/20 sm:h-[4.5rem] sm:w-[4.5rem]">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden>
                  <path d="M12 5v14M5 12h14" stroke-linecap="round" />
                </svg>
              </div>
              <span class="text-sm font-medium">Ajouter</span>
            </button>
          </FadeIn>
        </div>
      )}

      {!loading && !error && projects.length === 0 && (
        <p class="mt-6 text-center text-sm text-[var(--color-ink-muted)]">
          Aucune application pour l'instant. Crée-en une pour commencer.
        </p>
      )}

      {wizardOpen && (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div class="w-full max-w-2xl rounded-2xl bg-[var(--color-card)] p-6 shadow-2xl">
            <div class="mb-4 flex items-start justify-between">
              <div>
                <h2 class="text-xl font-semibold">Nouveau projet</h2>
                <p class="mt-1 text-sm text-[var(--color-ink-muted)]">
                  Importer depuis GitHub
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWizardOpen(false)}
                class="text-[var(--color-ink-muted)] transition hover:text-white"
                aria-label="Fermer"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <NewGithubAppWizard bare />
          </div>
        </div>
      )}
    </AppShell>
  );
}
