import { useEffect, useRef, useState } from 'preact/hooks';
import { api, type ProjectAgent } from '../lib/api';
import {
  planFromToolCalls,
  streamAgentChat,
  wroteLocalFiles,
  type AgentPlan,
  type AgentToolCall,
} from '../lib/agent-stream';
import { cn } from '../lib/cn';
import {
  AgentActionList,
  AgentPlanActions,
  AgentThinkingBlock,
  toLiveActions,
  type LiveAction,
} from './agents/AgentActionCards';
import { Alert, Badge, Button, Card, FadeIn, Input, Spinner, useToast } from './ui';

const ROLE_META: Record<
  string,
  { label: string; blurb: string; starters: string[] }
> = {
  ops: {
    label: 'Ops',
    blurb: 'État, logs, corrections locales',
    starters: ['Où en est le projet ?', 'Diagnostique et corrige en local', 'Lance un smoke test'],
  },
  deploy: {
    label: 'Deploy',
    blurb: 'Build, déploiement, versions',
    starters: ['Déploie la dernière version', 'Quel est le statut du dernier deploy ?'],
  },
  reviewer: {
    label: 'Reviewer',
    blurb: 'Plan, preview, PR sur validation',
    starters: ['Propose un plan d’amélioration', 'Améliore le design en local', 'Quels risques vois-tu ?'],
  },
  custom: {
    label: 'Agent',
    blurb: 'Assistant projet',
    starters: ['Aide-moi sur ce projet'],
  },
  worker: {
    label: 'Worker',
    blurb: 'Sous-tâche',
    starters: [],
  },
};

type ChatMessage = {
  role: string;
  content: string;
  provider?: string;
  toolCalls?: AgentToolCall[];
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
  return ROLE_META[agent.role] || ROLE_META.custom;
}

/** Agents projet — seed auto, chat prêt, zéro config manuelle. */
export function ProjectAgentsPanel({ 
  projectUuid, 
  defaultAgentUuid, 
  builderMode 
}: { 
  projectUuid: string;
  defaultAgentUuid?: string;
  builderMode?: boolean;
}) {
  const toast = useToast();
  const [agents, setAgents] = useState<ProjectAgent[]>([]);
  const [selected, setSelected] = useState<string | null>(defaultAgentUuid || null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState<string | null>(null);
  const [thinkStarted, setThinkStarted] = useState(0);
  const [liveActions, setLiveActions] = useState<LiveAction[]>([]);
  const [llmMode, setLlmMode] = useState<string>('—');
  const [llmError, setLlmError] = useState<string | null>(null);
  const [pollEnabled, setPollEnabled] = useState(builderMode || false);
  const endRef = useRef<HTMLDivElement>(null);

  const current = agents.find((a) => a.uuid === selected) ?? null;
  const currentMeta = current ? metaFor(current) : null;
  const llmReady = llmMode !== 'stub' && llmMode !== '—' && llmMode !== 'offline';

  async function loadAgents() {
    try {
      const r = await api.projectAgents(projectUuid);
      // Masquer les sous-agents dans la liste principale (spawn auto plus tard).
      const main = (r.data ?? []).filter((a) => a.kind !== 'subagent');
      setAgents(main);
      
      // Sélection intelligente de l'agent par défaut
      const selectDefault = async (prev: string | null) => {
        if (prev && main.some((a) => a.uuid === prev)) return prev;
        
        // Priorité 1 : agent actuellement en cours de travail (status=working)
        const working = main.find((a) => a.status === 'working');
        if (working) return working.uuid;
        
        // Priorité 2 : agent Deploy (celui qui construit le projet après scaffold)
        const deployAgent = main.find((a) => a.role === 'deploy');
        
        // Vérifier si Deploy a des messages (signe qu'il a été utilisé)
        if (deployAgent) {
          try {
            const msgs = await api.agentMessages(projectUuid, deployAgent.uuid);
            if (msgs.data && msgs.data.length > 0) {
              return deployAgent.uuid;
            }
          } catch {
            // Ignorer erreur
          }
          
          // Si en mode builder, sélectionner Deploy même sans messages
          if (builderMode || defaultAgentUuid) {
            return deployAgent.uuid;
          }
        }
        
        // Priorité 3 : vérifier les autres agents pour celui qui a des messages
        for (const agent of main) {
          if (agent.uuid === deployAgent?.uuid) continue; // Déjà vérifié
          try {
            const msgs = await api.agentMessages(projectUuid, agent.uuid);
            if (msgs.data && msgs.data.length > 0) {
              return agent.uuid;
            }
          } catch {
            // Ignorer erreur, passer au suivant
          }
        }
        
        // Priorité 4 : fallback sur le premier agent
        return main[0]?.uuid ?? null;
      };
      
      const selected = await selectDefault(null);
      setSelected(selected);
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

  useEffect(() => {
    void loadAgents();
    
    async function checkLlm() {
      try {
        const h = await api.health();
        const mode = h.backends?.llm ?? 'stub';
        setLlmMode(mode);
        
        if (mode === 'stub') {
          const providers = await api.llmProviders();
          const unhealthy = providers.data.filter((p) => p.enabled && p.healthy === false);
          if (unhealthy.length > 0) {
            const err = unhealthy[0];
            setLlmError(err.last_probe_error || 'provider unhealthy');
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
  }, [projectUuid]);

  // Polling des messages en mode builder
  useEffect(() => {
    if (!pollEnabled || !selected) return;

    let pollCount = 0;
    const interval = setInterval(async () => {
      if (busy) return;
      try {
        await loadMessages(selected);
        
        // Vérifier le statut de l'agent
        const agentsRes = await api.projectAgents(projectUuid);
        const currentAgent = agentsRes.data.find((a) => a.uuid === selected);
        
        pollCount++;
        
        // Arrêter le polling après 60 secondes ou si l'agent est idle
        if (pollCount > 60 || (currentAgent && currentAgent.status === 'idle')) {
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
    if (selected) void loadMessages(selected);
    else setMessages([]);
  }, [selected, projectUuid]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking, liveActions]);

  async function clearChat() {
    if (!selected) return;
    await api.clearAgentMessages(projectUuid, selected);
    setMessages([]);
  }

  async function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy || !selected) return;
    setBusy(true);
    setThinking('Analyse de la demande…');
    setThinkStarted(Date.now());
    setLiveActions([]);
    setMessages((m) => [...m, { role: 'user', content: trimmed }]);
    setInput('');
    try {
      const res = await streamAgentChat(
        trimmed,
        {
          project_uuid: projectUuid,
          agent_uuid: selected,
        },
        {
          onThinking: (label) => setThinking(label),
          onToolStart: (call) => {
            setThinking(call.name.replace(/_/g, ' '));
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
          plan: res.plan,
          canOpenPr: wroteLocalFiles(tools),
          needsUserAction,
        },
      ]);
      api
        .health()
        .then((h) => setLlmMode(h.backends?.llm ?? llmMode))
        .catch(() => undefined);
    } catch (err: unknown) {
      const msg = String((err as Error).message || err);
      setMessages((m) => [...m, { role: 'assistant', content: msg }]);
      toast.push({ title: 'Agent KO', detail: msg, tone: 'danger' });
    } finally {
      setBusy(false);
      setThinking(null);
      setLiveActions([]);
    }
  }

  function onSubmit(e: Event) {
    e.preventDefault();
    void sendText(input);
  }

  return (
    <FadeIn>
      <div class="grid gap-4 lg:grid-cols-[240px_1fr]">
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
            {agents.map((a) => {
              const meta = metaFor(a);
              const on = selected === a.uuid;
              return (
                <li key={a.uuid}>
                  <button
                    type="button"
                    class={cn(
                      'flex w-full flex-col rounded-xl px-3 py-2.5 text-left transition',
                      on
                        ? 'bg-[var(--color-accent-soft)]'
                        : 'hover:bg-[var(--color-surface)]',
                    )}
                    onClick={() => setSelected(a.uuid)}
                  >
                    <span class="font-medium tracking-tight">{meta.label}</span>
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

        <Card padding="none" class="flex h-[min(calc(100dvh-14rem),600px)] flex-col overflow-hidden lg:h-[min(64vh,600px)]">
          <div class="flex items-center justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-medium tracking-tight">
                  {currentMeta?.label || 'Agent'}
                </span>
                <Badge tone={llmReady ? 'ok' : 'warn'}>{llmMode}</Badge>
              </div>
              {currentMeta && (
                <p class="mt-0.5 text-xs text-[var(--color-ink-faint)]">{currentMeta.blurb}</p>
              )}
            </div>
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

          {!llmReady && (
            <Alert tone="warn" class="m-3 mb-0">
              {llmError ? (
                <>
                  LLM configuré mais erreur : <strong>{llmError}</strong> —{' '}
                  <a class="underline" href="/app/settings?tab=llm">
                    corrige dans Settings → Agents / LLM
                  </a>
                  .
                </>
              ) : (
                <>
                  Aucun LLM prêt — configure Ollama / Gemini dans{' '}
                  <a class="underline" href="/app/settings?tab=llm">
                    Settings → Agents / LLM
                  </a>
                  . Les agents répondront dès qu'un modèle est actif.
                </>
              )}
            </Alert>
          )}

          <div class="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && currentMeta && (
              <div class="space-y-3">
                <p class="text-sm text-[var(--color-ink-muted)]">
                  L’agent planifie, travaille dans le dossier du projet, puis lance la preview. Une PR n’est ouverte que si tu valides.
                </p>
                <div class="flex flex-wrap gap-2">
                  {currentMeta.starters.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={busy}
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
                          <span class="text-2xl">⚠️</span>
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
            {busy && liveActions.length > 0 && <AgentActionList actions={liveActions} />}
            {busy && thinking && (
              <AgentThinkingBlock label={thinking} startedAt={thinkStarted || Date.now()} />
            )}
            <div ref={endRef} />
          </div>

          <form class="flex min-w-0 gap-2 border-t border-[var(--color-line)] p-3" onSubmit={onSubmit}>
            <div class="min-w-0 flex-1">
              <Input
                value={input}
                placeholder={
                  current ? `Message pour ${currentMeta?.label || current.name}…` : 'Message…'
                }
                onInput={(ev) => setInput((ev.target as HTMLInputElement).value)}
                disabled={busy || !selected}
              />
            </div>
            <Button type="submit" variant="secondary" disabled={busy || !selected || !input.trim()} class="shrink-0">
              {busy ? <Spinner /> : 'Envoyer'}
            </Button>
          </form>
        </Card>
      </div>
    </FadeIn>
  );
}
