import { useEffect, useRef, useState } from 'preact/hooks';
import { api, type ProjectAgent } from '../lib/api';
import { cn } from '../lib/cn';
import { Alert, Badge, Button, Card, FadeIn, Input, useToast } from './ui';

const ROLE_META: Record<
  string,
  { label: string; blurb: string; starters: string[] }
> = {
  ops: {
    label: 'Ops',
    blurb: 'État, logs, smoke tests',
    starters: ['Où en est le projet ?', 'Montre les derniers logs', 'Lance un smoke test'],
  },
  deploy: {
    label: 'Deploy',
    blurb: 'Build, déploiement, versions',
    starters: ['Déploie la dernière version', 'Quel est le statut du dernier deploy ?'],
  },
  reviewer: {
    label: 'Reviewer',
    blurb: 'Revue, qualité, suggestions',
    starters: ['Review le dernier changement', 'Quels risques vois-tu ?'],
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

function metaFor(agent: ProjectAgent) {
  return ROLE_META[agent.role] || ROLE_META.custom;
}

/** Agents projet — seed auto, chat prêt, zéro config manuelle. */
export function ProjectAgentsPanel({ projectUuid }: { projectUuid: string }) {
  const toast = useToast();
  const [agents, setAgents] = useState<ProjectAgent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<
    Array<{ role: string; content: string; provider?: string; tools?: string }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [llmMode, setLlmMode] = useState<string>('—');
  const [llmError, setLlmError] = useState<string | null>(null);
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
      setSelected((prev) => {
        if (prev && main.some((a) => a.uuid === prev)) return prev;
        return main[0]?.uuid ?? null;
      });
      setError(null);
    } catch (e: unknown) {
      setError(String((e as Error).message || e));
    }
  }

  async function loadMessages(agentUuid: string) {
    try {
      const r = await api.agentMessages(projectUuid, agentUuid);
      setMessages(
        (r.data ?? []).map((m) => ({
          role: m.role,
          content: m.content,
          provider: m.provider || undefined,
        })),
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
          const unhealthy = providers.data.filter(p => p.enabled && !p.healthy);
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

  useEffect(() => {
    if (selected) void loadMessages(selected);
    else setMessages([]);
  }, [selected, projectUuid]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function clearChat() {
    if (!selected) return;
    await api.clearAgentMessages(projectUuid, selected);
    setMessages([]);
  }

  async function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy || !selected) return;
    setBusy(true);
    setMessages((m) => [...m, { role: 'user', content: trimmed }]);
    setInput('');
    try {
      const res = await api.agentChat(trimmed, {
        project_uuid: projectUuid,
        agent_uuid: selected,
      });
      const tools = (res.data.tool_calls as Array<{ name?: string }> | undefined) ?? [];
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: res.data.reply,
          provider: res.data.provider || undefined,
          tools:
            tools.length > 0
              ? tools.map((t) => t.name ?? '?').join(', ')
              : undefined,
        },
      ]);
      // Refresh LLM badge if chain just became available
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
                  Parle naturellement — l’agent utilise les outils du projet si besoin.
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
              <div
                key={i}
                class={cn(
                  'max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm',
                  m.role === 'user'
                    ? 'ml-auto bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-surface)]',
                )}
              >
                {m.content}
                {(m.provider || m.tools) && (
                  <div class="mt-1 text-[11px] opacity-60">
                    {[m.provider, m.tools ? `tools: ${m.tools}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                )}
              </div>
            ))}
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
              {busy ? '…' : 'Envoyer'}
            </Button>
          </form>
        </Card>
      </div>
    </FadeIn>
  );
}
