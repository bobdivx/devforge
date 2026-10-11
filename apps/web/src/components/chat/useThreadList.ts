import { useRef, useState } from 'preact/hooks';
import { api, type ProjectAgent } from '../../lib/api';
import { useToast } from '../ui';
import { nestAgentRows, readStoredThread, sortAgentsPinned, sortByRecent, storeThread, titleFromMessage } from './thread-meta';

type Options = {
  projectUuid: string;
  threadsMode: boolean;
  /** Fil principal présenté comme un personnage : toujours le coordinateur, jamais mémorisé. */
  persona: boolean;
  defaultAgentUuid?: string;
  builderMode?: boolean;
  /** Le fil choisi travaille déjà : relever son état tout de suite. */
  onWorkingPicked?: () => void;
};

/** Liste des fils / agents du projet, sélection, création et renommage. */
export function useThreadList({ projectUuid, threadsMode, persona, defaultAgentUuid, builderMode, onWorkingPicked }: Options) {
  const toast = useToast();
  const [agents, setAgents] = useState<ProjectAgent[]>([]);
  const [threads, setThreads] = useState<ProjectAgent[]>([]);
  const [selected, setSelected] = useState<string | null>(defaultAgentUuid || null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const bootstrapped = useRef(false);

  const list = threadsMode ? threads : agents;
  const current = list.find((a) => a.uuid === selected) ?? agents.find((a) => a.uuid === selected) ?? null;
  const rows = threadsMode
    ? nestAgentRows(list.filter((a) => a.kind !== 'subagent'), list)
    : nestAgentRows(sortAgentsPinned(agents.filter((a) => a.kind !== 'subagent')), agents);

  async function resolveThreads(main: ProjectAgent[]): Promise<ProjectAgent[]> {
    // Workspace = fil coordinateur permanent + tâches isolées. Ops/Reviewer restent dans Agents.
    const customs = main.filter((a) => a.kind === 'custom');
    const coordinator = main.find((a) => a.role === 'coordinator');
    const extras: ProjectAgent[] = [];
    const add = (agent?: ProjectAgent) => {
      if (!agent || agent.role === 'coordinator') return;
      if (customs.some((c) => c.uuid === agent.uuid) || extras.some((e) => e.uuid === agent.uuid)) return;
      extras.push(agent);
    };
    if (defaultAgentUuid) add(main.find((a) => a.uuid === defaultAgentUuid));
    const remembered = readStoredThread(projectUuid);
    if (remembered) add(main.find((a) => a.uuid === remembered));
    const deploy = main.find((a) => a.role === 'deploy');
    if (deploy) {
      try {
        const msgs = await api.agentMessages(projectUuid, deploy.uuid);
        if ((msgs.data ?? []).length > 0) add(deploy);
      } catch {
        // Le fil deploy reste masqué si l’historique est illisible
      }
    }
    const rest = [...extras, ...customs].sort(sortByRecent);
    return coordinator ? [coordinator, ...rest] : rest;
  }

  async function pickTeamDefault(ordered: ProjectAgent[], prev: string | null) {
    if (prev && ordered.some((a) => a.uuid === prev)) return prev;
    if (defaultAgentUuid && ordered.some((a) => a.uuid === defaultAgentUuid)) return defaultAgentUuid;
    const working = ordered.find((a) => a.status === 'working');
    if (working) return working.uuid;
    const coordinator = ordered.find((a) => a.role === 'coordinator');
    if (coordinator) return coordinator.uuid;
    const deployAgent = ordered.find((a) => a.role === 'deploy');
    if (deployAgent) {
      try {
        const msgs = await api.agentMessages(projectUuid, deployAgent.uuid);
        if (msgs.data && msgs.data.length > 0) return deployAgent.uuid;
      } catch {
        // Ignorer
      }
      if (builderMode) return deployAgent.uuid;
    }
    for (const agent of ordered) {
      if (agent.uuid === deployAgent?.uuid) continue;
      try {
        const msgs = await api.agentMessages(projectUuid, agent.uuid);
        if (msgs.data && msgs.data.length > 0) return agent.uuid;
      } catch {
        // Ignorer
      }
    }
    return ordered[0]?.uuid ?? null;
  }

  async function loadAgents(preferUuid?: string | null) {
    try {
      const r = await api.projectAgents(projectUuid);
      const all = r.data ?? [];
      const main = all.filter((a) => a.kind !== 'subagent');
      // Garder aussi les subagents pour le nest UI (sélection + indentation).
      setAgents(all);
      if (threadsMode) {
        let next = await resolveThreads(main);
        // Inclure les sous-agents dont le parent est dans la liste des fils.
        const rootIds = new Set(next.map((t) => t.uuid));
        const nestedSubs = all
          .filter((a) => a.kind === 'subagent' && a.parent_agent_uuid && rootIds.has(a.parent_agent_uuid))
          .sort(sortByRecent);
        for (const s of nestedSubs) if (!next.some((t) => t.uuid === s.uuid)) next.push(s);
        // Le coordinateur (seed) est le fil par défaut — pas de chat vide auto.
        if (next.length === 0 && !bootstrapped.current) {
          bootstrapped.current = true;
          const created = await api.createProjectAgent(projectUuid, { name: 'Tâche isolée', role: 'custom', kind: 'custom' });
          next = [created.data];
          setAgents((prev) => [...prev, created.data]);
        }
        setThreads(next);
        const has = (id?: string | null) => !!id && next.some((a) => a.uuid === id);
        const remembered = readStoredThread(projectUuid);
        const coordinatorUuid = next.find((a) => a.role === 'coordinator')?.uuid;
        const pick =
          (persona && coordinatorUuid) ||
          (has(preferUuid) && preferUuid) ||
          (has(selected) && selected) ||
          (has(defaultAgentUuid) ? defaultAgentUuid : null) ||
          (has(remembered) ? remembered : null) ||
          next.find((a) => a.status === 'working')?.uuid ||
          coordinatorUuid ||
          next.find((a) => a.role === 'deploy')?.uuid ||
          next[0]?.uuid ||
          null;
        setSelected(pick);
        if (pick && !persona) storeThread(projectUuid, pick);
        if (next.find((a) => a.uuid === pick)?.status === 'working') onWorkingPicked?.();
      } else {
        const ordered = [...sortAgentsPinned(main), ...all.filter((a) => a.kind === 'subagent').sort(sortByRecent)];
        setAgents(ordered);
        setSelected(await pickTeamDefault(ordered, preferUuid ?? selected));
      }
      setError(null);
    } catch (e: unknown) {
      setError(String((e as Error).message || e));
    }
  }

  async function createThread(): Promise<boolean> {
    if (creating) return false;
    setCreating(true);
    try {
      const coordinator = agents.find((a) => a.role === 'coordinator') || threads.find((a) => a.role === 'coordinator');
      const created = await api.createProjectAgent(projectUuid, {
        name: 'Tâche isolée',
        role: 'custom',
        kind: 'custom',
        parent_agent_uuid: coordinator?.uuid,
      });
      setAgents((prev) => sortAgentsPinned([created.data, ...prev]));
      setThreads((prev) => {
        const without = prev.filter((t) => t.uuid !== created.data.uuid);
        const coord = without.find((t) => t.role === 'coordinator');
        const rest = without.filter((t) => t.role !== 'coordinator');
        return coord ? [coord, created.data, ...rest] : [created.data, ...rest];
      });
      setSelected(created.data.uuid);
      storeThread(projectUuid, created.data.uuid);
      return true;
    } catch (e: unknown) {
      toast.push({ title: 'Impossible de créer la tâche', detail: String((e as Error).message || e), tone: 'danger' });
      return false;
    } finally {
      setCreating(false);
    }
  }

  /** Premier message d'une tâche isolée : elle prend le titre du message. */
  async function nameFromFirstMessage(agentUuid: string, text: string) {
    try {
      const renamed = await api.renameProjectAgent(projectUuid, agentUuid, titleFromMessage(text));
      setThreads((prev) => prev.map((t) => (t.uuid === agentUuid ? renamed.data : t)).sort(sortByRecent));
      setAgents((prev) => prev.map((a) => (a.uuid === agentUuid ? renamed.data : a)));
    } catch {
      // Titre non critique
    }
  }

  /** Activité récente : le fil remonte dans la liste. */
  function touch(agentUuid: string) {
    if (!threadsMode) return;
    const now = new Date().toISOString();
    setThreads((prev) => prev.map((t) => (t.uuid === agentUuid ? { ...t, updated_at: now } : t)).sort(sortByRecent));
  }

  /** Run fini ou annulé : plus de badge « Au travail… » en attendant le prochain relevé. */
  function markIdle(agentUuid: string) {
    const idle = <T extends { uuid: string; status?: string | null }>(a: T): T =>
      a.uuid === agentUuid && a.status === 'working' ? { ...a, status: 'idle' } : a;
    setAgents((prev) => prev.map(idle));
    setThreads((prev) => prev.map(idle));
  }

  return {
    agents,
    rows,
    selected,
    setSelected,
    current,
    error,
    creating,
    bootstrapped,
    loadAgents,
    createThread,
    nameFromFirstMessage,
    touch,
    markIdle,
  };
}
