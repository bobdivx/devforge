import { api, type ClusterNode, type Project } from '../lib/api';
import { nodeShortLabel } from '../lib/cluster-display';
import { projectStatusMeta, projectSyncMeta } from '../lib/status';
import { cn } from '../lib/cn';
import { AppShell } from './AppShell';
import { AppIcon, groupFaceProject, statusDotClass } from './AppIcon';
import { Alert, BetaBadge, Button, HubAddTile, HubGrid, Input, Portal, Skeleton } from './ui';
import { interactiveLift, motion, settleIn } from '../lib/motion';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { NewGithubAppWizard } from './NewGithubAppWizard';
import { NewBuilderWizard } from './NewBuilderWizard';

function statusLineClass(tone: string) {
  return cn(
    'mt-1 text-[11px] font-medium leading-[14px]',
    tone === 'ok' && 'text-[var(--color-ok)]',
    tone === 'warn' && 'text-[var(--color-warn)]',
    tone === 'danger' && 'text-[var(--color-danger)]',
    tone === 'neutral' && 'text-[var(--color-ink-faint)]',
  );
}

function AppCard({
  project,
  index,
  nodes,
  showNode,
}: {
  project: Project;
  index: number;
  nodes: ClusterNode[];
  showNode: boolean;
}) {
  const status = projectStatusMeta(project.status);
  const sync = projectSyncMeta(project.sync);
  const badgeTone = status.tone === 'ok' ? 'ok' : status.tone;
  const showSyncWarn = sync.tone === 'warn' || sync.tone === 'danger';
  const node = nodeShortLabel(nodes, project.server_id);

  return (
    <a
      href={`/app/projects/view?uuid=${encodeURIComponent(project.uuid)}`}
      class="group flex aspect-square h-full w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl bg-[#1c1c1e] px-2.5 py-3 ring-1 ring-transparent transition-[background-color,box-shadow,ring-color] duration-200 hover:bg-[#252528] hover:ring-white/15 hover:shadow-[0_12px_40px_rgb(0_0_0/0.35)] sm:gap-3 sm:px-3 sm:py-4"
      animate={motion(settleIn(Math.min(index * 0.05, 0.32)), interactiveLift())}
    >
        <div class="relative">
          <AppIcon project={project} statusTone={status.tone} class="group-hover:scale-[1.03]" />

          <span
            class={cn(
              'absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full ring-2 ring-[#1c1c1e]',
              statusDotClass(status.tone),
              status.tone === 'warn' ? 'animate-pulse' : '',
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
          <div class={statusLineClass(badgeTone)}>{status.label}</div>
          <div class="mt-0.5 truncate text-[10px] leading-[14px] text-[var(--color-ink-faint)]">
            {showNode ? node : '\u00a0'}
          </div>
        </div>
    </a>
  );
}

function aggregateStatus(members: Project[]): string {
  if (members.some((p) => ['deploying', 'building', 'queued'].includes(p.status))) return 'deploying';
  if (members.some((p) => ['failed', 'error', 'unhealthy', 'unrouted'].includes(p.status))) return 'unhealthy';
  if (members.some((p) => p.status === 'live' || p.status === 'running')) return 'live';
  return members[0]?.status || 'ready';
}

function GroupCard({
  uuid,
  name,
  roles,
  status,
  face,
  index,
}: {
  uuid: string;
  name: string;
  roles: string[];
  status: string;
  face?: Project;
  index: number;
}) {
  const meta = projectStatusMeta(status);
  return (
    <a
      href={`/app/groups/view?uuid=${encodeURIComponent(uuid)}`}
      class="group flex aspect-square h-full w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl bg-[#1c1c1e] px-2.5 py-3 ring-1 ring-transparent transition-[background-color,box-shadow,ring-color] duration-200 hover:bg-[#252528] hover:ring-white/15 hover:shadow-[0_12px_40px_rgb(0_0_0/0.35)] sm:gap-3 sm:px-3 sm:py-4"
      animate={motion(settleIn(Math.min(index * 0.05, 0.32)), interactiveLift())}
    >
      <div class="relative">
        {face ? (
          <AppIcon project={face} statusTone={meta.tone} class="group-hover:scale-[1.03]" />
        ) : (
          <div class="flex h-16 w-16 items-center justify-center rounded-[1.15rem] bg-white/10 text-lg font-semibold text-white sm:h-[4.5rem] sm:w-[4.5rem]">
            {name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <span
          class={cn(
            'absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full ring-2 ring-[#1c1c1e]',
            statusDotClass(meta.tone),
            meta.tone === 'warn' ? 'animate-pulse' : '',
          )}
          title={meta.label}
          aria-hidden
        />
      </div>
      <div class="w-full text-center">
        <div class="truncate text-sm font-medium text-white">{name}</div>
        <div class={statusLineClass(meta.tone)}>{meta.label}</div>
        <div class="mt-0.5 truncate text-[10px] leading-[14px] text-[var(--color-ink-faint)]">
          {roles.length ? roles.join(' · ') : 'Groupe'}
        </div>
      </div>
    </a>
  );
}

function EmptyActionTile({
  index,
  title,
  detail,
  invite,
  onClick,
  icon,
}: {
  index: number;
  title: string;
  detail: string;
  invite?: boolean;
  onClick: () => void;
  icon: ComponentChildren;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-df-empty-action={invite ? 'next' : 'alt'}
      class={cn(
        'group flex aspect-square h-full w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl bg-[#1c1c1e] px-2.5 py-3 text-center ring-1 transition-[background-color,box-shadow,ring-color] duration-200 hover:bg-[#252528] hover:shadow-[0_12px_40px_rgb(0_0_0/0.35)] sm:gap-3 sm:px-3 sm:py-4',
        invite ? 'df-invite ring-[var(--color-accent)]/55' : 'ring-transparent hover:ring-white/15',
      )}
      animate={motion(settleIn(index * 0.06), interactiveLift())}
    >
      <div class="flex h-16 w-16 items-center justify-center rounded-[1.15rem] bg-white/10 text-white sm:h-[4.5rem] sm:w-[4.5rem]">
        {icon}
      </div>
      <div class="w-full">
        <div class="truncate text-sm font-medium text-white">{title}</div>
        <div class="mt-1 line-clamp-2 text-[11px] leading-snug text-[var(--color-ink-muted)]">{detail}</div>
      </div>
    </button>
  );
}

export function EmptyAppGrid({
  agentBuilder,
  onImport,
  onAgent,
}: {
  agentBuilder: boolean;
  onImport: () => void;
  onAgent: () => void;
}) {
  return (
    <>
      {agentBuilder && (
        <EmptyActionTile
          index={0}
          invite
          title="Nouvelle application"
          detail="Écrire la spec, puis l’approuver. Rien n’est publié."
          onClick={onAgent}
          icon={
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden>
              <path d="M12 20h9M12 4L4 8l8 4 8-4-8-4zM4 12l8 4 8-4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          }
        />
      )}
      <EmptyActionTile
        index={agentBuilder ? 1 : 0}
        invite={!agentBuilder}
        title="Importer"
        detail="Un dépôt GitHub déjà là."
        onClick={onImport}
        icon={
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
          </svg>
        }
      />
    </>
  );
}

export function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [nodes, setNodes] = useState<ClusterNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardMode, setWizardMode] = useState<'choice' | 'github' | 'builder'>('choice');
  const [landWorkspace, setLandWorkspace] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [agentBuilder, setAgentBuilder] = useState(true);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupBusy, setGroupBusy] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  // Fonction pour charger les projets
  async function loadProjects() {
    try {
      const boot = await api.bootstrap().catch(() => null);
      const admin = boot?.user?.role === 'instance_admin';
      setIsAdmin(admin);
      setAgentBuilder(boot?.features?.agent_builder !== false);
      const [r, n] = await Promise.all([
        api.projects(),
        admin ? api.clusterNodes().catch(() => null) : Promise.resolve(null),
      ]);
      setProjects(r.data);
      if (admin && n?.nodes) setNodes(n.nodes);
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
    const q = new URLSearchParams(window.location.search);
    if (q.get('nouvelle') === '1') {
      setLandWorkspace(true);
      setWizardMode('choice');
      setWizardOpen(true);
      q.delete('nouvelle');
      const next = q.toString();
      window.history.replaceState({}, '', next ? `/app?${next}` : '/app');
    }
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

  function openWizard(mode: 'choice' | 'github' | 'builder' = 'choice') {
    setWizardMode(mode);
    setWizardOpen(true);
  }

  function closeWizard() {
    setWizardMode('choice');
    setWizardOpen(false);
  }

  async function createGroup(e: Event) {
    e.preventDefault();
    const name = groupName.trim();
    if (!name) return;
    setGroupBusy(true);
    try {
      const r = await api.createGroup({ name });
      window.location.href = `/app/groups/view?uuid=${encodeURIComponent(r.data.uuid)}`;
    } catch (err) {
      setGroupError(String((err as Error).message || err));
      setGroupBusy(false);
    }
  }

  const grouped = new Map<string, { uuid: string; name: string; roles: string[]; members: Project[] }>();
  const solo: Project[] = [];
  for (const p of projects) {
    if (!p.group_uuid) {
      solo.push(p);
      continue;
    }
    const bucket = grouped.get(p.group_uuid) ?? {
      uuid: p.group_uuid,
      name: p.group_name || 'Groupe',
      roles: [],
      members: [],
    };
    bucket.members.push(p);
    if (p.role) bucket.roles.push(p.role);
    grouped.set(p.group_uuid, bucket);
  }
  const groups = [...grouped.values()];

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
        <>
          <HubGrid cols={5}>
            {groups.map((g, i) => (
              <GroupCard
                key={g.uuid}
                uuid={g.uuid}
                name={g.name}
                roles={g.roles}
                status={aggregateStatus(g.members)}
                face={groupFaceProject(g.members)}
                index={i}
              />
            ))}
            {solo.map((p, i) => (
              <AppCard
                key={p.uuid}
                project={p}
                index={groups.length + i}
                nodes={nodes}
                showNode={isAdmin}
              />
            ))}

            {projects.length === 0 ? (
              <EmptyAppGrid
                agentBuilder={agentBuilder}
                onImport={() => openWizard('github')}
                onAgent={() => openWizard('builder')}
              />
            ) : (
              <HubAddTile
                settle
                index={groups.length + solo.length}
                label="Nouvelle application"
                lines={3}
                onClick={() => openWizard(agentBuilder ? 'builder' : 'choice')}
              />
            )}
          </HubGrid>
        </>
      )}

      {groupOpen && (
        <Portal>
        <div class="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-4">
          <button
            type="button"
            aria-label="Fermer"
            class="df-modal-backdrop absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setGroupOpen(false)}
          />
          <form
            class="df-modal-panel relative z-10 w-full max-w-md rounded-t-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-6 shadow-2xl sm:rounded-2xl"
            onSubmit={createGroup}
          >
            <h2 class="text-xl font-semibold">Nouveau groupe</h2>
            <p class="mt-1 text-sm text-[var(--color-ink-muted)]">
              Regroupe plusieurs repos (site, client, serveur) sur un réseau commun.
            </p>
            <div class="mt-4">
              <Input
                label="Nom"
                value={groupName}
                onInput={(e) => setGroupName((e.target as HTMLInputElement).value)}
              />
            </div>
            {groupError && (
              <Alert tone="warn" class="mt-3">
                {groupError}
              </Alert>
            )}
            <div class="mt-4 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setGroupOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={groupBusy || !groupName.trim()}>
                {groupBusy ? 'Création…' : 'Créer'}
              </Button>
            </div>
          </form>
        </div>
        </Portal>
      )}


      {wizardOpen && (
        <Portal>
        <div class="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-4">
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
                  {wizardMode === 'builder' && 'Prochaine étape : approuver la spec. Le modèle reste en local, rien n’est publié.'}
                </p>
                {wizardMode === 'builder' && (
                  <button
                    type="button"
                    class="mt-2 text-xs text-[var(--color-ink-muted)] underline"
                    onClick={() => setWizardMode('github')}
                  >
                    Importer un dépôt à la place
                  </button>
                )}
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
                {agentBuilder && (
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
                    <span class="font-semibold">Nouvelle application</span>
                    <BetaBadge />
                  </div>
                  <p class="text-sm text-[var(--color-ink-muted)]">
                    Décris l’app. DevForge écrit la spec et s’arrête. Tu approuves, ensuite preview locale. Aucun dépôt tant que tu ne le demandes pas.
                  </p>
                </button>
                )}

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

                <button
                  type="button"
                  onClick={() => {
                    closeWizard();
                    setGroupOpen(true);
                  }}
                  class="group flex w-full flex-col gap-2 rounded-xl border border-[var(--color-line)] p-4 text-left transition-[border-color,background-color,transform] duration-200 hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] active:scale-[0.99]"
                >
                  <div class="flex items-center gap-2">
                    <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--color-surface)] text-white transition-transform duration-200 group-hover:scale-105">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke-linecap="round" stroke-linejoin="round" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </div>
                    <span class="font-semibold">Créer un groupe</span>
                  </div>
                  <p class="text-sm text-[var(--color-ink-muted)]">
                    Regroupe plusieurs apps (site, client, serveur) sur un réseau commun.
                  </p>
                </button>
              </div>
            )}

            {wizardMode === 'builder' && <NewBuilderWizard bare onClose={closeWizard} />}
            {wizardMode === 'github' && <NewGithubAppWizard bare landInWorkspace={landWorkspace} />}
          </div>
        </div>
        </Portal>
      )}
    </AppShell>
  );
}
