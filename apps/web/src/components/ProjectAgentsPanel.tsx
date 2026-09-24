import { useEffect, useRef, useState } from 'preact/hooks';
import { MessageSquare, Plus, Share2 } from 'lucide-preact';
import { api, type ProjectAgent } from '../lib/api';
import {
  planFromToolCalls,
  streamAgentChat,
  wroteLocalFiles,
  type AgentPlan,
  type AgentReflection,
  type AgentToolCall,
} from '../lib/agent-stream';
import { cn } from '../lib/cn';
import {
  AgentActionList,
  AgentPlanActions,
  AgentReflectionList,
  AgentThinkingBlock,
  toLiveActions,
  type LiveAction,
} from './agents/AgentActionCards';
import { markLaunchedStatus } from '../lib/launched-agents';
import { Alert, Badge, Button, Card, FadeIn, Input, Spinner, useToast } from './ui';

const ROLE_META: Record<string, { label: string; blurb: string; starters: string[] }> = {
  coordinator: {
    label: 'Coordinateur',
    blurb: 'Fil permanent du projet — contexte accumulé, workers éphémères',
    starters: [
      'Où en est le projet ?',
      'Que s’est-il passé récemment ?',
      'Propose un plan pour la prochaine étape',
    ],
  },
  ops: {
    label: 'Ops',
    blurb: 'Santé, logs, environnement',
    starters: ['Où en est la santé du projet ?', 'Montre les derniers logs', 'Les variables d’env sont-elles cohérentes ?'],
  },
  deploy: {
    label: 'Déploiements',
    blurb: 'Builds, versions, logs de déploiement',
    starters: ['Quel est le statut du dernier déploiement ?', 'Pourquoi le dernier build a échoué ?', 'Quelle version est en ligne ?'],
  },
  runner: {
    label: 'Runners',
    blurb: 'Runners GitHub du dépôt',
    starters: ['Les runners sont-ils en ligne ?', 'Un runner est-il occupé ou en erreur ?'],
  },
  actions: {
    label: 'Actions',
    blurb: 'Workflows et jobs CI',
    starters: ['Quel est le dernier workflow ?', 'Y a-t-il un job en échec ?'],
  },
  crons: {
    label: 'Crons',
    blurb: 'Tâches planifiées du projet',
    starters: ['Quelles tâches sont actives ?', 'La dernière exécution a-t-elle échoué ?'],
  },
  reviewer: {
    label: 'Revue',
    blurb: 'Risques, qualité, CI',
    starters: ['Lance une revue sécurité du projet', 'Quels risques vois-tu ?', 'La CI est-elle verte ?'],
  },
  custom: {
    label: 'Agent',
    blurb: 'Assistant projet',
    starters: [
      'Où en est le projet ?',
      'Améliore le design en local',
      'Déploie la dernière version',
    ],
  },
  worker: {
    label: 'Worker',
    blurb: 'Sous-tâche',
    starters: [],
  },
};

const THREAD_STARTERS = [
  'Où en est le projet ?',
  'Améliore le design en local',
  'Déploie la dernière version',
];

type ChatMessage = {
  role: string;
  content: string;
  provider?: string;
  toolCalls?: AgentToolCall[];
  reflections?: AgentReflection[];
  plan?: AgentPlan | null;
  canOpenPr?: boolean;
  needsUserAction?: {
    kind: string;
    message_fr: string;
    settings_href?: string;
    resume_hint?: string;
  };
};

function metaFor(agent: ProjectAgent) {
  if (agent.kind === 'subagent') {
    return {
      label: agent.name || 'Sous-agent',
      blurb: 'Worker éphémère sous le Coordinateur',
      starters: [] as string[],
    };
  }
  return ROLE_META[agent.role] || ROLE_META.custom;
}

/** Racines + enfants kind=subagent indentés sous leur parent. */
function nestAgentRows(
  roots: ProjectAgent[],
  all: ProjectAgent[],
): { agent: ProjectAgent; depth: number }[] {
  const byParent = new Map<string, ProjectAgent[]>();
  for (const a of all) {
    if (a.kind !== 'subagent' || !a.parent_agent_uuid) continue;
    const kids = byParent.get(a.parent_agent_uuid) ?? [];
    kids.push(a);
    byParent.set(a.parent_agent_uuid, kids);
  }
  for (const kids of byParent.values()) kids.sort(sortByRecent);

  const seen = new Set<string>();
  const out: { agent: ProjectAgent; depth: number }[] = [];
  for (const root of roots) {
    if (seen.has(root.uuid)) continue;
    seen.add(root.uuid);
    out.push({ agent: root, depth: 0 });
    for (const kid of byParent.get(root.uuid) ?? []) {
      if (seen.has(kid.uuid)) continue;
      seen.add(kid.uuid);
      out.push({ agent: kid, depth: 1 });
    }
  }
  // Orphelins (parent hors liste) — toujours visibles
  for (const a of all) {
    if (a.kind !== 'subagent' || seen.has(a.uuid)) continue;
    out.push({ agent: a, depth: 1 });
    seen.add(a.uuid);
  }
  return out;
}

function sortByRecent(a: ProjectAgent, b: ProjectAgent) {
  const ta = a.updated_at || '';
  const tb = b.updated_at || '';
  return tb.localeCompare(ta);
}

/** Coordinateur piné en tête ; le reste par activité récente. */
function sortAgentsPinned(list: ProjectAgent[]): ProjectAgent[] {
  const coord = list.filter((a) => a.role === 'coordinator');
  const rest = list.filter((a) => a.role !== 'coordinator').sort(sortByRecent);
  return [...coord, ...rest];
}

function titleFromMessage(text: string) {
  const oneLine = text.trim().replace(/\s+/g, ' ');
  if (oneLine.length <= 48) return oneLine;
  return `${oneLine.slice(0, 48)}…`;
}

function threadStorageKey(projectUuid: string) {
  return `devforge.workspaceThread.${projectUuid}`;
}

function readStoredThread(projectUuid: string): string | null {
  try {
    return localStorage.getItem(threadStorageKey(projectUuid));
  } catch {
    return null;
  }
}

function storeThread(projectUuid: string, agentUuid: string) {
  try {
    localStorage.setItem(threadStorageKey(projectUuid), agentUuid);
  } catch {
    // Navigation privée
  }
}

type Props = {
  projectUuid: string;
  defaultAgentUuid?: string;
  builderMode?: boolean;
  /** `threads` = workspace style Cursor ; `team` = liste Ops/Deploy/Reviewer */
  mode?: 'threads' | 'team';
  /** Remplit la colonne chat du workspace (preview et fichiers à côté). */
  embedded?: boolean;
};

/** Chat agents projet — mode équipe ou fils de conversation. */
export function ProjectAgentsPanel({
  projectUuid,
  defaultAgentUuid,
  builderMode,
  mode = 'team',
  embedded = false,
}: Props) {
  const threadsMode = mode === 'threads';
  const toast = useToast();
  const [agents, setAgents] = useState<ProjectAgent[]>([]);
  const [threads, setThreads] = useState<ProjectAgent[]>([]);
  const [selected, setSelected] = useState<string | null>(defaultAgentUuid || null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [thinking, setThinking] = useState<string | null>(null);
  const [thinkDetail, setThinkDetail] = useState<string | undefined>(undefined);
  const [thinkStarted, setThinkStarted] = useState(0);
  const [liveActions, setLiveActions] = useState<LiveAction[]>([]);
  const [liveReflections, setLiveReflections] = useState<AgentReflection[]>([]);
  const [llmMode, setLlmMode] = useState<string>('—');
  const [llmError, setLlmError] = useState<string | null>(null);
  const [pollEnabled, setPollEnabled] = useState(builderMode || false);
  const [sharing, setSharing] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const bootstrapped = useRef(false);

  const list = threadsMode ? threads : agents;
  const current = list.find((a) => a.uuid === selected) ?? agents.find((a) => a.uuid === selected) ?? null;
  const currentMeta = current ? metaFor(current) : null;
  const llmReady = llmMode !== 'stub' && llmMode !== '—' && llmMode !== 'offline';
  const starters = threadsMode ? THREAD_STARTERS : currentMeta?.starters ?? [];

  const displayRows = threadsMode
    ? nestAgentRows(
        list.filter((a) => a.kind !== 'subagent'),
        list,
      )
    : nestAgentRows(
        sortAgentsPinned(agents.filter((a) => a.kind !== 'subagent')),
        agents,
      );

  async function resolveThreads(main: ProjectAgent[]): Promise<ProjectAgent[]> {
    // Workspace = fil coordinateur permanent + tâches isolées. Ops/Reviewer restent dans Agents.
    const customs = main.filter((a) => a.kind === 'custom');
    const coordinator = main.find((a) => a.role === 'coordinator');
    const extras: ProjectAgent[] = [];
    const add = (agent?: ProjectAgent) => {
      if (!agent) return;
      if (agent.role === 'coordinator') return;
      if (customs.some((c) => c.uuid === agent.uuid)) return;
      if (extras.some((e) => e.uuid === agent.uuid)) return;
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

  function threadLabel(a: ProjectAgent) {
    if (a.role === 'coordinator') return 'Coordinateur';
    if (a.kind === 'subagent') return a.name || 'Sous-agent';
    if (a.kind === 'custom') return a.name;
    // Ne jamais afficher Ops / Deploy / Reviewer comme noms de chat
    if (a.role === 'deploy' || a.name === 'Deploy') return 'Construction';
    if (a.name === 'Nouveau chat' || a.name === 'Tâche isolée') return a.name;
    return a.name.startsWith('Chat') ? a.name : 'Chat';
  }

  async function loadAgents(preferUuid?: string | null) {
    try {
      const r = await api.projectAgents(projectUuid);
      const all = r.data ?? [];
      const main = all.filter((a) => a.kind !== 'subagent');
      // Garder aussi les subagents pour le nest UI (sélection + indentation).
      setAgents(all);

      if (threadsMode) {
        let nextThreads = await resolveThreads(main);
        // Inclure les sous-agents dont le parent est dans la liste des fils.
        const rootIds = new Set(nextThreads.map((t) => t.uuid));
        const nestedSubs = all
          .filter(
            (a) =>
              a.kind === 'subagent' &&
              a.parent_agent_uuid &&
              rootIds.has(a.parent_agent_uuid),
          )
          .sort(sortByRecent);
        for (const s of nestedSubs) {
          if (!nextThreads.some((t) => t.uuid === s.uuid)) nextThreads.push(s);
        }

        // Le coordinateur (seed) est le fil par défaut — pas de chat vide auto.
        if (nextThreads.length === 0 && !bootstrapped.current) {
          bootstrapped.current = true;
          const created = await api.createProjectAgent(projectUuid, {
            name: 'Tâche isolée',
            role: 'custom',
            kind: 'custom',
          });
          nextThreads = [created.data];
          setAgents((prev) => [...prev, created.data]);
        }

        setThreads(nextThreads);

        const remembered = readStoredThread(projectUuid);
        const pick =
          (preferUuid && nextThreads.some((a) => a.uuid === preferUuid) && preferUuid) ||
          (selected && nextThreads.some((a) => a.uuid === selected) && selected) ||
          (defaultAgentUuid && nextThreads.some((a) => a.uuid === defaultAgentUuid)
            ? defaultAgentUuid
            : null) ||
          (remembered && nextThreads.some((a) => a.uuid === remembered) ? remembered : null) ||
          nextThreads.find((a) => a.status === 'working')?.uuid ||
          nextThreads.find((a) => a.role === 'coordinator')?.uuid ||
          nextThreads.find((a) => a.role === 'deploy')?.uuid ||
          nextThreads[0]?.uuid ||
          null;
        setSelected(pick);
        if (pick) storeThread(projectUuid, pick);
        if (nextThreads.find((a) => a.uuid === pick)?.status === 'working') {
          setPollEnabled(true);
        }
      } else {
        const orderedRoots = sortAgentsPinned(main);
        const ordered = [
          ...orderedRoots,
          ...all.filter((a) => a.kind === 'subagent').sort(sortByRecent),
        ];
        setAgents(ordered);
        const selectDefault = async (prev: string | null) => {
          if (prev && ordered.some((a) => a.uuid === prev)) return prev;
          if (defaultAgentUuid && ordered.some((a) => a.uuid === defaultAgentUuid)) {
            return defaultAgentUuid;
          }
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
        };
        setSelected(await selectDefault(preferUuid ?? selected));
      }

      setError(null);
    } catch (e: unknown) {
      setError(String((e as Error).message || e));
    }
  }

  async function loadMessages(agentUuid: string) {
    try {
      const r = await api.agentMessages(projectUuid, agentUuid);
      setMessages(
        (r.data ?? []).map((m) => {
          let tools: AgentToolCall[] = [];
          if (m.tool_calls_json) {
            try {
              tools = JSON.parse(m.tool_calls_json) as AgentToolCall[];
            } catch {
              tools = [];
            }
          }
          const plan = planFromToolCalls(tools);
          return {
            role: m.role,
            content: m.content,
            provider: m.provider || undefined,
            toolCalls: tools,
            plan,
            canOpenPr: wroteLocalFiles(tools),
          };
        }),
      );
    } catch {
      setMessages([]);
    }
  }

  async function createThread() {
    if (creating) return;
    setCreating(true);
    try {
      const coordinator =
        agents.find((a) => a.role === 'coordinator') ||
        threads.find((a) => a.role === 'coordinator');
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
        return coord
          ? [coord, created.data, ...rest]
          : [created.data, ...rest];
      });
      setSelected(created.data.uuid);
      storeThread(projectUuid, created.data.uuid);
      setMessages([]);
    } catch (e: unknown) {
      toast.push({
        title: 'Impossible de créer la tâche',
        detail: String((e as Error).message || e),
        tone: 'danger',
      });
    } finally {
      setCreating(false);
    }
  }

  useEffect(() => {
    bootstrapped.current = false;
    void loadAgents(defaultAgentUuid || null);

    async function checkLlm() {
      try {
        const status = await api.llmStatus();
        const mode = status.mode || 'stub';
        setLlmMode(mode);
        if (mode === 'stub') {
          const providers = await api.llmProviders();
          const unhealthy = providers.data.filter((p) => p.enabled && p.healthy === false);
          if (unhealthy.length > 0) {
            setLlmError(unhealthy[0].last_probe_error || 'provider unhealthy');
          } else {
            setLlmError(null);
          }
        } else {
          setLlmError(null);
        }
      } catch {
        setLlmMode('offline');
        setLlmError(null);
      }
    }
    void checkLlm();
  }, [projectUuid, threadsMode]);

  useEffect(() => {
    if (!pollEnabled || !selected) return;
    let pollCount = 0;
    let idleStreak = 0;
    const interval = setInterval(async () => {
      if (busy) return;
      try {
        await loadMessages(selected);
        const agentsRes = await api.projectAgents(projectUuid);
        const currentAgent = agentsRes.data.find((a) => a.uuid === selected);
        pollCount++;
        if (currentAgent?.status === 'idle') idleStreak += 1;
        else idleStreak = 0;
        if (pollCount > 90 || idleStreak >= 3) {
          setPollEnabled(false);
          clearInterval(interval);
        }
      } catch (err) {
        console.error('[ProjectAgentsPanel] Poll error:', err);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [pollEnabled, selected, projectUuid, busy]);

  useEffect(() => {
    if (selected) {
      storeThread(projectUuid, selected);
      void loadMessages(selected);
    } else setMessages([]);
  }, [selected, projectUuid]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking, liveActions, liveReflections, thinkDetail]);

  async function clearChat() {
    if (!selected) return;
    await api.clearAgentMessages(projectUuid, selected);
    setMessages([]);
  }

  async function shareChat() {
    if (!selected || sharing) return;
    setSharing(true);
    try {
      const r = await api.shareAgentConversation(projectUuid, selected);
      const url =
        r.url.startsWith('http') ? r.url : `${window.location.origin}${r.path || r.url}`;
      await navigator.clipboard.writeText(url);
      toast.push({ title: 'Lien de partage copié', tone: 'ok' });
    } catch (e) {
      toast.push({
        title: 'Partage impossible',
        detail: e instanceof Error ? e.message : String(e),
        tone: 'danger',
      });
    } finally {
      setSharing(false);
    }
  }

  async function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy || !selected) return;
    setBusy(true);
    markLaunchedStatus(selected, 'working');
    setThinking('Analyse de la demande…');
    setThinkDetail(undefined);
    setThinkStarted(Date.now());
    setLiveActions([]);
    setLiveReflections([]);
    setMessages((m) => [...m, { role: 'user', content: trimmed }]);
    setInput('');

    if (threadsMode && (current?.name === 'Nouveau chat' || current?.name === 'Tâche isolée') && messages.length === 0) {
      const title = titleFromMessage(trimmed);
      try {
        const renamed = await api.renameProjectAgent(projectUuid, selected, title);
        setThreads((prev) =>
          prev
            .map((t) => (t.uuid === selected ? renamed.data : t))
            .sort(sortByRecent),
        );
        setAgents((prev) => prev.map((a) => (a.uuid === selected ? renamed.data : a)));
      } catch {
        // Titre non critique
      }
    }

    try {
      const res = await streamAgentChat(
        trimmed,
        {
          project_uuid: projectUuid,
          agent_uuid: selected,
        },
        {
          onThinking: (label, _round, detail) => {
            setThinking(label);
            if (detail?.trim()) {
              setThinkDetail(detail);
              setLiveReflections((prev) => [...prev, { label, detail, round: _round }]);
            }
          },
          onToolStart: (call) => {
            setThinking(call.name.replace(/_/g, ' '));
            setThinkDetail(undefined);
            setLiveActions((prev) => [...prev, { ...call, status: 'running' }]);
          },
          onToolDone: (call, ok) => {
            setLiveActions((prev) => {
              const next = [...prev];
              let idx = -1;
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i].name === call.name && next[i].status === 'running') {
                  idx = i;
                  break;
                }
              }
              const done: LiveAction = { ...call, status: ok ? 'ok' : 'fail' };
              if (idx >= 0) next[idx] = done;
              else next.push(done);
              return next;
            });
          },
        },
      );
      const tools = res.tool_calls ?? [];
      let needsUserAction: ChatMessage['needsUserAction'];
      for (const tool of tools) {
        if (tool.result?.needs_user_action === true) {
          needsUserAction = {
            kind: tool.result.kind || 'unknown',
            message_fr: tool.result.message_fr || 'Action utilisateur requise',
            settings_href: tool.result.settings_href,
            resume_hint: tool.result.resume_hint,
          };
          break;
        }
      }

      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: res.reply,
          provider: res.provider || undefined,
          toolCalls: tools,
          reflections: res.reflections ?? [],
          plan: res.plan,
          canOpenPr: wroteLocalFiles(tools),
          needsUserAction,
        },
      ]);
      api
        .llmStatus()
        .then((s) => setLlmMode(s.mode || llmMode))
        .catch(() => undefined);
      if (
        tools.some(
          (t) => t.name === 'start_local_preview' && t.result?.public_ok === false,
        )
      ) {
        setPollEnabled(true);
      }
      if (threadsMode) {
        setThreads((prev) => {
          const now = new Date().toISOString();
          return prev
            .map((t) => (t.uuid === selected ? { ...t, updated_at: now } : t))
            .sort(sortByRecent);
        });
      }
    } catch (err: unknown) {
      const msg = String((err as Error).message || err);
      setMessages((m) => [...m, { role: 'assistant', content: msg }]);
      toast.push({ title: 'Agent KO', detail: msg, tone: 'danger' });
    } finally {
      setBusy(false);
      markLaunchedStatus(selected, 'idle');
      setThinking(null);
      setThinkDetail(undefined);
      setLiveActions([]);
      setLiveReflections([]);
    }
  }

  function onSubmit(e: Event) {
    e.preventDefault();
    void sendText(input);
  }

  const chatHeaderTitle = threadsMode
    ? (current ? threadLabel(current) : 'Chat')
    : currentMeta?.label || 'Agent';
  const isCoordinator = current?.role === 'coordinator';
  const isSubagent = current?.kind === 'subagent';
  const chatHeaderBlurb = isCoordinator
    ? 'Fil permanent du projet — contexte accumulé, workers éphémères'
    : isSubagent
      ? 'Sous-agent — tâche déléguée par le Coordinateur'
      : threadsMode
        ? 'Assistant projet — planifie, édite en local, preview'
        : currentMeta?.blurb;

  const sidebar = threadsMode ? (
    <div class="flex flex-col gap-2">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={creating || busy}
        onClick={() => void createThread()}
        class="w-full justify-start"
      >
        {creating ? <Spinner /> : <Plus size={14} strokeWidth={2} aria-hidden />}
        Nouvelle tâche isolée
      </Button>
      {error && (
        <Alert tone="warn" class="mb-1">
          {error}
        </Alert>
      )}
      <ul class="space-y-0.5">
        {displayRows.map(({ agent: a, depth }) => {
          const on = selected === a.uuid;
          return (
            <li key={a.uuid}>
              <button
                type="button"
                class={cn(
                  'flex w-full items-start gap-2 rounded-xl py-2.5 text-left transition',
                  depth > 0 ? 'pl-7 pr-3' : 'px-3',
                  on ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-surface)]',
                )}
                onClick={() => setSelected(a.uuid)}
              >
                <MessageSquare
                  size={14}
                  strokeWidth={2}
                  class="mt-0.5 shrink-0 text-[var(--color-ink-faint)]"
                  aria-hidden
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium tracking-tight">
                    {depth > 0 ? `↳ ${threadLabel(a)}` : threadLabel(a)}
                  </span>
                  {a.kind === 'subagent' && (
                    <span class="mt-0.5 block text-[10px] text-[var(--color-ink-faint)]">
                      Sous-agent
                    </span>
                  )}
                  {a.status === 'working' && (
                    <span class="mt-0.5 block text-[10px] text-[var(--color-accent)]">En cours…</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {displayRows.length === 0 && !error && (
        <p class="px-1 text-sm text-[var(--color-ink-muted)]">Aucun chat…</p>
      )}
    </div>
  ) : (
    <Card>
      <p class="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
        Équipe
      </p>
      {error && (
        <Alert tone="warn" class="mb-3">
          {error}
        </Alert>
      )}
      <ul class="space-y-1">
        {displayRows.map(({ agent: a, depth }) => {
          const meta = metaFor(a);
          const on = selected === a.uuid;
          return (
            <li key={a.uuid}>
              <button
                type="button"
                class={cn(
                  'flex w-full flex-col rounded-xl py-2.5 text-left transition',
                  depth > 0 ? 'pl-7 pr-3' : 'px-3',
                  on ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-surface)]',
                )}
                onClick={() => setSelected(a.uuid)}
              >
                <span class="flex items-center gap-2 font-medium tracking-tight">
                  {depth > 0 ? `↳ ${meta.label}` : meta.label}
                  {a.role === 'coordinator' && (
                    <Badge tone="accent" class="!px-1.5 !py-0 text-[10px]">
                      Fil permanent
                    </Badge>
                  )}
                  {a.kind === 'subagent' && (
                    <Badge tone="neutral" class="!px-1.5 !py-0 text-[10px]">
                      Sous-agent
                    </Badge>
                  )}
                </span>
                <span class="mt-0.5 text-xs text-[var(--color-ink-faint)]">{meta.blurb}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {agents.length === 0 && !error && (
        <p class="text-sm text-[var(--color-ink-muted)]">Chargement des agents…</p>
      )}
    </Card>
  );

  const mobileThreadBar = threadsMode ? (
    <div class={cn('mb-2 flex shrink-0 items-center gap-2', !embedded && 'lg:hidden')}>
      <div class="min-w-0 flex-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div class="flex w-max gap-1">
          {displayRows.map(({ agent: a, depth }) => (
            <button
              key={a.uuid}
              type="button"
              onClick={() => setSelected(a.uuid)}
              class={cn(
                'max-w-[10rem] shrink-0 truncate rounded-lg px-2.5 py-1.5 text-xs font-medium transition',
                selected === a.uuid
                  ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                  : 'bg-white/[0.03] text-[var(--color-ink-muted)] hover:bg-white/5',
              )}
            >
              {depth > 0 ? `↳ ${threadLabel(a)}` : threadLabel(a)}
            </button>
          ))}
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={creating || busy}
        onClick={() => void createThread()}
        aria-label="Nouvelle tâche isolée"
        title="Nouvelle tâche isolée"
      >
        {creating ? <Spinner /> : <Plus size={14} strokeWidth={2} aria-hidden />}
      </Button>
    </div>
  ) : null;

  return (
    <FadeIn class={embedded ? 'flex h-full min-h-0 flex-col' : undefined}>
      {mobileThreadBar}
      <div
        class={cn(
          'grid min-h-0 gap-4',
          embedded ? 'h-full flex-1 grid-cols-1' : threadsMode ? 'lg:grid-cols-[200px_1fr]' : 'lg:grid-cols-[240px_1fr]',
        )}
      >
        <div class={cn(embedded ? 'hidden' : threadsMode && 'hidden lg:block')}>{sidebar}</div>

        <Card
          padding="none"
          class={cn(
            'flex min-h-0 flex-col overflow-hidden',
            embedded
              ? 'h-full'
              : threadsMode
                ? 'h-[min(calc(100dvh-12rem),720px)] lg:h-[min(calc(100dvh-10rem),800px)]'
                : 'h-[min(calc(100dvh-14rem),600px)] lg:h-[min(64vh,600px)]',
          )}
        >
          <div class="flex items-center justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="truncate font-medium tracking-tight">{chatHeaderTitle}</span>
                {isCoordinator && <Badge tone="accent">Coordinateur</Badge>}
                {isSubagent && <Badge tone="neutral">Sous-agent</Badge>}
                <Badge tone={llmReady ? 'ok' : 'warn'}>{llmMode}</Badge>
              </div>
              {chatHeaderBlurb && (
                <p class="mt-0.5 truncate text-xs text-[var(--color-ink-faint)]">{chatHeaderBlurb}</p>
              )}
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!selected || sharing || messages.length === 0}
                onClick={() => void shareChat()}
                title="Copier un lien de partage"
                aria-label="Partager la conversation"
              >
                {sharing ? <Spinner /> : <Share2 size={14} strokeWidth={2} aria-hidden />}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!selected || busy || messages.length === 0}
                onClick={() => void clearChat()}
              >
                Effacer
              </Button>
            </div>
          </div>

          {!llmReady && (
            <Alert tone="warn" class="m-3 mb-0">
                  {llmError ? (
                <>
                  LLM configuré mais erreur : <strong>{llmError}</strong>
                  {' '}
                  —{' '}
                  <a class="underline" href="/app/settings?tab=llm">
                    corrige dans Paramètres → Agents / LLM
                  </a>
                  .
                </>
              ) : (
                <>
                  Aucun LLM prêt. Configure le tien dans{' '}
                  <a class="underline" href="/app/settings?tab=llm">
                    Paramètres → Agents / LLM
                  </a>
                  . Les agents répondront dès qu'un modèle est actif.
                </>
              )}
            </Alert>
          )}

          <div class="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div class="space-y-3">
                <p class="text-sm text-[var(--color-ink-muted)]">
                  {threadsMode
                    ? 'Décris ce que tu veux. L’assistant modifie le projet ; la preview et les fichiers sont à côté.'
                    : 'Cet agent surveille sa partie du projet. Pose une question, ou choisis une piste.'}
                </p>
                <div class="flex flex-wrap gap-2">
                  {starters.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={busy || !selected}
                      class="rounded-full border border-[var(--color-line)] px-3 py-1.5 text-xs text-[var(--color-ink-muted)] transition hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]"
                      onClick={() => void sendText(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} class="space-y-2">
                {m.role === 'user' ? (
                  <div class="ml-auto max-w-[90%] whitespace-pre-wrap break-words rounded-2xl bg-[var(--color-accent)] px-3 py-2 text-sm text-white">
                    {m.content}
                  </div>
                ) : (
                  <>
                    {m.reflections && m.reflections.length > 0 && (
                      <AgentReflectionList items={m.reflections} />
                    )}
                    {m.toolCalls && m.toolCalls.length > 0 && (
                      <AgentActionList actions={toLiveActions(m.toolCalls)} />
                    )}
                    {m.content.trim() && (
                      <div class="max-w-[92%] whitespace-pre-wrap break-words text-sm text-[var(--color-ink)]">
                        {m.content}
                        {m.provider && (
                          <div class="mt-1 text-[11px] text-[var(--color-ink-faint)]">{m.provider}</div>
                        )}
                      </div>
                    )}
                    {m.plan && m.plan.steps.length > 0 && (
                      <AgentPlanActions
                        plan={m.plan}
                        canOpenPr={m.canOpenPr}
                        busy={busy}
                        onApprovePlan={
                          m.canOpenPr
                            ? undefined
                            : () =>
                                void sendText(
                                  'Go — exécute ce plan en local, puis lance la preview.',
                                )
                        }
                        onOpenPr={() =>
                          void sendText(
                            'Valide les changements locaux et ouvre une pull request.',
                          )
                        }
                      />
                    )}
                    {m.needsUserAction && (
                      <Card class="max-w-[92%] border-l-4 border-l-[var(--color-warn)]">
                        <div class="flex items-start gap-3">
                          <span class="text-2xl" aria-hidden>
                            !
                          </span>
                          <div class="flex-1">
                            <p class="mb-2 text-sm font-medium">Action requise</p>
                            <p class="mb-3 text-sm text-[var(--color-ink-muted)]">
                              {m.needsUserAction.message_fr}
                            </p>
                            {m.needsUserAction.settings_href && (
                              <Button
                                size="sm"
                                variant="outline"
                                href={m.needsUserAction.settings_href}
                                class="mb-2"
                              >
                                Ouvrir les paramètres
                              </Button>
                            )}
                            {m.needsUserAction.resume_hint && (
                              <p class="mt-2 text-xs text-[var(--color-ink-faint)]">
                                {m.needsUserAction.resume_hint}
                              </p>
                            )}
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => void sendText('Continuer')}
                              class="mt-3"
                            >
                              Continuer
                            </Button>
                          </div>
                        </div>
                      </Card>
                    )}
                  </>
                )}
              </div>
            ))}
            {busy && liveReflections.length > 0 && (
              <AgentReflectionList items={liveReflections} />
            )}
            {busy && liveActions.length > 0 && <AgentActionList actions={liveActions} />}
            {busy && thinking && (
              <AgentThinkingBlock
                label={thinking}
                detail={thinkDetail}
                startedAt={thinkStarted || Date.now()}
              />
            )}
            <div ref={endRef} />
          </div>

          <form class="flex min-w-0 gap-2 border-t border-[var(--color-line)] p-3" onSubmit={onSubmit}>
            <div class="min-w-0 flex-1">
              <Input
                value={input}
                placeholder={threadsMode ? 'Message…' : current ? `Message pour ${chatHeaderTitle}…` : 'Message…'}
                onInput={(ev) => setInput((ev.target as HTMLInputElement).value)}
                disabled={busy || !selected}
              />
            </div>
            <Button
              type="submit"
              variant="secondary"
              disabled={busy || !selected || !input.trim()}
              class="shrink-0"
            >
              {busy ? <Spinner /> : 'Envoyer'}
            </Button>
          </form>
        </Card>
      </div>
    </FadeIn>
  );
}
