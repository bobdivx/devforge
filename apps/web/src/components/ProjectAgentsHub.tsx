import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Activity, Clock, GitBranch, MessageSquare, Rocket, Search, Server } from 'lucide-preact';
import { api, type ProjectAgent } from '../lib/api';
import { cn } from '../lib/cn';
import {
  launchAgent,
  markLaunchedStatus,
  subscribeOpenAgent,
  syncLaunchedProjectName,
} from '../lib/launched-agents';
import { ProjectAgentsPanel } from './ProjectAgentsPanel';
import { Alert, HubGrid, HubTile, Modal, Skeleton } from './ui';

type Watcher = {
  role: string;
  title: string;
  blurb: string;
  icon: ComponentChildren;
};

const WATCHERS: Watcher[] = [
  {
    role: 'coordinator',
    title: 'Coordinateur',
    blurb: 'Fil permanent du projet',
    icon: <MessageSquare size={28} strokeWidth={1.75} aria-hidden />,
  },
  {
    role: 'deploy',
    title: 'Déploiements',
    blurb: 'Builds, versions, logs',
    icon: <Rocket size={28} strokeWidth={1.75} aria-hidden />,
  },
  {
    role: 'runner',
    title: 'Runners',
    blurb: 'Runners GitHub du dépôt',
    icon: <Server size={28} strokeWidth={1.75} aria-hidden />,
  },
  {
    role: 'actions',
    title: 'Actions',
    blurb: 'Workflows et jobs CI',
    icon: <GitBranch size={28} strokeWidth={1.75} aria-hidden />,
  },
  {
    role: 'ops',
    title: 'Ops',
    blurb: 'Santé, logs, environnement',
    icon: <Activity size={28} strokeWidth={1.75} aria-hidden />,
  },
  {
    role: 'crons',
    title: 'Crons',
    blurb: 'Tâches planifiées',
    icon: <Clock size={28} strokeWidth={1.75} aria-hidden />,
  },
  {
    role: 'reviewer',
    title: 'Revue',
    blurb: 'Secrets, dépendances, en-têtes',
    icon: <Search size={28} strokeWidth={1.75} aria-hidden />,
  },
];

function statusOf(agent: ProjectAgent): { label: string; tone: 'ok' | 'warn' | 'neutral' } {
  if (agent.status === 'working') return { label: 'En cours', tone: 'warn' };
  if (agent.status === 'idle') return { label: 'En veille', tone: 'ok' };
  return { label: agent.status || 'Inconnu', tone: 'neutral' };
}

function dotClass(tone: 'ok' | 'warn' | 'neutral') {
  if (tone === 'ok') return 'bg-[var(--color-ok)]';
  if (tone === 'warn') return 'bg-[var(--color-warn)]';
  return 'bg-[var(--color-ink-faint)]';
}

export function ProjectAgentsHub({
  projectUuid,
  projectName = '',
}: {
  projectUuid: string;
  projectName?: string;
}) {
  const [agents, setAgents] = useState<ProjectAgent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<ProjectAgent | null>(null);
  const openedFromQuery = useRef(false);
  const projectNameRef = useRef(projectName);
  projectNameRef.current = projectName;

  function remember(agent: ProjectAgent) {
    const watcher = WATCHERS.find((item) => item.role === agent.role);
    launchAgent({
      uuid: agent.uuid,
      projectUuid,
      projectName,
      title: watcher?.title || agent.name,
      role: agent.role,
      status: agent.status,
    });
  }

  useEffect(() => {
    syncLaunchedProjectName(projectUuid, projectName);
  }, [projectUuid, projectName]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .projectAgents(projectUuid)
      .then((r) => {
        if (cancelled) return;
        const list = (r.data ?? []).filter((a) => a.kind !== 'subagent');
        setAgents(list);
        for (const agent of list) {
          if (agent.status === 'working') {
            const watcher = WATCHERS.find((item) => item.role === agent.role);
            launchAgent({
              uuid: agent.uuid,
              projectUuid,
              projectName: projectNameRef.current,
              title: watcher?.title || agent.name,
              role: agent.role,
              status: agent.status,
            });
          } else {
            markLaunchedStatus(agent.uuid, agent.status);
          }
        }
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(String((e as Error).message || e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectUuid]);

  useEffect(() => {
    if (loading || openedFromQuery.current) return;
    const openId = new URLSearchParams(window.location.search).get('open');
    if (!openId) return;
    const agent = agents.find((item) => item.uuid === openId);
    if (!agent) return;
    openedFromQuery.current = true;
    setOpen(agent);
    remember(agent);
  }, [loading, agents, projectUuid, projectName]);

  useEffect(() => {
    return subscribeOpenAgent((launched) => {
      if (launched.projectUuid !== projectUuid) return;
      const agent = agents.find((item) => item.uuid === launched.uuid);
      if (agent) setOpen(agent);
    });
  }, [agents, projectUuid]);

  const tiles = WATCHERS.flatMap((watcher) => {
    const agent = agents.find((a) => a.role === watcher.role && a.kind === 'required')
      ?? agents.find((a) => a.role === watcher.role);
    if (!agent) return [];
    return [{ watcher, agent }];
  });

  const openMeta = open ? WATCHERS.find((w) => w.role === open.role) : null;

  return (
    <>
      {error && (
        <Alert tone="warn" class="mb-4">
          {error}
        </Alert>
      )}

      {loading ? (
        <HubGrid cols={5}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} class="aspect-square rounded-2xl" />
          ))}
        </HubGrid>
      ) : (
        <HubGrid cols={5}>
          {tiles.map(({ watcher, agent }, i) => {
            const status = statusOf(agent);
            return (
              <HubTile
                key={agent.uuid}
                index={i}
                title={watcher.title}
                onClick={() => {
                  remember(agent);
                  setOpen(agent);
                }}
                iconClass="!bg-[#2a2a2e] !text-[var(--color-ink)]"
                icon={watcher.icon}
                badge={
                  <span
                    class={cn(
                      'absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full ring-2 ring-[#1c1c1e]',
                      dotClass(status.tone),
                      status.tone === 'warn' ? 'animate-pulse' : '',
                    )}
                    title={status.label}
                    aria-hidden
                  />
                }
                subtitle={
                  <div class="mt-1 space-y-0.5">
                    <div
                      class={cn(
                        'text-[11px] font-medium',
                        status.tone === 'ok' && 'text-[var(--color-ok)]',
                        status.tone === 'warn' && 'text-[var(--color-warn)]',
                        status.tone === 'neutral' && 'text-[var(--color-ink-faint)]',
                      )}
                    >
                      {status.label}
                    </div>
                    <div class="truncate text-[10px] text-[var(--color-ink-faint)]">
                      {watcher.blurb}
                    </div>
                  </div>
                }
              />
            );
          })}
        </HubGrid>
      )}

      {!loading && !error && tiles.length === 0 && (
        <p class="mt-6 text-center text-sm text-[var(--color-ink-muted)]">
          Aucun agent de surveillance pour ce projet.
        </p>
      )}

      <Modal
        open={!!open}
        onClose={() => setOpen(null)}
        title={openMeta?.title || open?.name || 'Agent'}
        description={
          open?.role === 'coordinator'
            ? 'Fil permanent du projet — contexte accumulé, workers éphémères'
            : openMeta?.blurb
        }
        size="xl"
        padded={false}
        bodyClass="overflow-hidden"
      >
        {open && (
          <div class="h-[min(70dvh,640px)] min-h-[22rem]">
            <ProjectAgentsPanel
              key={open.uuid}
              projectUuid={projectUuid}
              defaultAgentUuid={open.uuid}
              mode="team"
              embedded
            />
          </div>
        )}
      </Modal>
    </>
  );
}
