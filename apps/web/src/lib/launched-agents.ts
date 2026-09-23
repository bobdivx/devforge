import { api } from './api';

const STORAGE_KEY = 'devforge.launchedAgents';
const CHANGE_EVENT = 'devforge:launched-agents';
const OPEN_EVENT = 'devforge:open-agent';
const MAX_LAUNCHED = 8;

export type LaunchedAgent = {
  uuid: string;
  projectUuid: string;
  projectName: string;
  title: string;
  role: string;
  status: string;
  launchedAt: number;
};

function isLaunched(value: unknown): value is LaunchedAgent {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<LaunchedAgent>;
  return Boolean(row.uuid && row.projectUuid && row.title);
}

export function readLaunchedAgents(): LaunchedAgent[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLaunched).slice(0, MAX_LAUNCHED);
  } catch {
    return [];
  }
}

function write(list: LaunchedAgent[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_LAUNCHED)));
  } catch {
    // Navigation privée ou quota
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function subscribeLaunchedAgents(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

export function launchAgent(agent: Omit<LaunchedAgent, 'launchedAt'> & { launchedAt?: number }) {
  const next: LaunchedAgent = {
    ...agent,
    projectName: agent.projectName || '',
    status: agent.status || 'idle',
    launchedAt: agent.launchedAt ?? Date.now(),
  };
  const rest = readLaunchedAgents().filter((row) => row.uuid !== next.uuid);
  write([next, ...rest]);
}

export function dismissLaunchedAgent(uuid: string) {
  write(readLaunchedAgents().filter((row) => row.uuid !== uuid));
}

export function markLaunchedStatus(uuid: string, status: string) {
  const list = readLaunchedAgents();
  const index = list.findIndex((row) => row.uuid === uuid);
  if (index < 0 || list[index].status === status) return;
  const next = list.slice();
  next[index] = { ...list[index], status };
  write(next);
}

export function syncLaunchedProjectName(projectUuid: string, projectName: string) {
  if (!projectName) return;
  const list = readLaunchedAgents();
  let changed = false;
  const next = list.map((row) => {
    if (row.projectUuid !== projectUuid || row.projectName === projectName) return row;
    changed = true;
    return { ...row, projectName };
  });
  if (changed) write(next);
}

export function launchedStatusLabel(status: string): string {
  if (status === 'working') return 'En cours';
  if (status === 'idle') return 'En veille';
  return status || 'Inconnu';
}

export function agentHref(agent: LaunchedAgent): string {
  const params = new URLSearchParams({
    uuid: agent.projectUuid,
    tab: 'agents',
    open: agent.uuid,
  });
  return `/app/projects/view?${params.toString()}`;
}

function onAgentsTab(projectUuid: string): boolean {
  const path = window.location.pathname.replace(/\/$/, '');
  if (path !== '/app/projects/view') return false;
  const query = new URLSearchParams(window.location.search);
  return query.get('uuid') === projectUuid && query.get('tab') === 'agents';
}

/** Ouvre l’agent. Sur l’onglet déjà affiché, sans recharger la page. */
export function openLaunchedAgent(agent: LaunchedAgent) {
  const href = agentHref(agent);
  if (onAgentsTab(agent.projectUuid)) {
    const url = new URL(href, window.location.origin);
    history.replaceState({}, '', `${url.pathname}${url.search}`);
    window.dispatchEvent(new CustomEvent<LaunchedAgent>(OPEN_EVENT, { detail: agent }));
    return;
  }
  window.location.assign(href);
}

export function subscribeOpenAgent(onOpen: (agent: LaunchedAgent) => void) {
  const handler = (event: Event) => {
    const agent = (event as CustomEvent<LaunchedAgent>).detail;
    if (agent?.uuid) onOpen(agent);
  };
  window.addEventListener(OPEN_EVENT, handler);
  return () => window.removeEventListener(OPEN_EVENT, handler);
}

/** Rafraîchit le statut des agents épinglés tant que l’onglet est visible. */
export function pollLaunchedAgents(intervalMs = 8000) {
  let timer = 0;
  let cancelled = false;

  const tick = async () => {
    if (document.hidden) return;
    const projects = [...new Set(readLaunchedAgents().map((row) => row.projectUuid))];
    await Promise.all(
      projects.map(async (projectUuid) => {
        try {
          const response = await api.projectAgents(projectUuid);
          if (cancelled) return;
          for (const agent of response.data ?? []) {
            markLaunchedStatus(agent.uuid, agent.status || 'idle');
          }
        } catch {
          // Le dock reste utilisable hors ligne
        }
      }),
    );
  };

  void tick();
  timer = window.setInterval(() => void tick(), intervalMs);
  const onVisible = () => {
    if (!document.hidden) void tick();
  };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    cancelled = true;
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
