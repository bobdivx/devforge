import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { streamAgentChat, type AgentReflection, type AgentToolCall } from '../lib/agent-stream';
import { AppShell } from './AppShell';
import {
  AgentActionList,
  AgentReflectionList,
  AgentThinkingBlock,
  toLiveActions,
  type LiveAction,
} from './agents/AgentActionCards';
import { Badge, Button, Card, Input, Spinner } from './ui';

type Msg = {
  role: 'user' | 'assistant';
  content: string;
  provider?: string;
  toolCalls?: AgentToolCall[];
  reflections?: AgentReflection[];
};

export function AgentPage() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState<string | null>(null);
  const [thinkDetail, setThinkDetail] = useState<string | undefined>(undefined);
  const [thinkStarted, setThinkStarted] = useState(0);
  const [liveActions, setLiveActions] = useState<LiveAction[]>([]);
  const [liveReflections, setLiveReflections] = useState<AgentReflection[]>([]);
  const [llm, setLlm] = useState<string>('—');
  const [llmError, setLlmError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function checkLlm() {
      try {
        const h = await api.health();
        const mode = h.backends?.llm ?? 'stub';
        setLlm(mode);

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
        setLlm('offline');
        setLlmError(null);
      }
    }

    void checkLlm();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking, liveActions, liveReflections, thinkDetail]);

  async function send(e: Event) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setThinking('Analyse de la demande…');
    setThinkDetail(undefined);
    setThinkStarted(Date.now());
    setLiveActions([]);
    setLiveReflections([]);
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setInput('');
    try {
      const res = await streamAgentChat(
        text,
        {},
        {
          onThinking: (label, round, detail) => {
            setThinking(label);
            if (detail?.trim()) {
              setThinkDetail(detail);
              setLiveReflections((prev) => [...prev, { label, detail, round }]);
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
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: res.reply,
          provider: res.provider ?? llm,
          toolCalls: res.tool_calls ?? [],
          reflections: res.reflections ?? [],
        },
      ]);
    } catch (err: unknown) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: `Erreur: ${String((err as Error).message || err)}` },
      ]);
    } finally {
      setBusy(false);
      setThinking(null);
      setThinkDetail(undefined);
      setLiveActions([]);
      setLiveReflections([]);
    }
  }

  return (
    <AppShell active="agent" title="Agent">
      <Card padding="none" class="flex h-[min(calc(100dvh-14rem),640px)] flex-col overflow-hidden lg:h-[min(70vh,640px)]">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3 text-sm text-[var(--color-ink-muted)]">
          <span class="min-w-0">Chat global · tools DevForge</span>
          <Badge tone={llm === 'stub' || llm === 'offline' ? 'warn' : 'ok'}>LLM {llm}</Badge>
        </div>
        <div class="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && (
            <>
              {llmError ? (
                <p class="text-sm text-[var(--color-ink-muted)]">
                  LLM configuré mais erreur : <strong>{llmError}</strong>. Demande à l’admin
                  instance si le modèle ne répond pas.
                </p>
              ) : (
                <p class="text-sm text-[var(--color-ink-muted)]">
                  « liste les projets », « smoke ». Le modèle est configuré par l’admin instance.
                </p>
              )}
            </>
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
        <form class="flex min-w-0 gap-2 border-t border-[var(--color-line)] p-3" onSubmit={send}>
          <div class="min-w-0 flex-1">
            <Input
              value={input}
              onInput={(e) => setInput((e.target as HTMLInputElement).value)}
              placeholder="Message…"
              disabled={busy}
            />
          </div>
          <Button type="submit" variant="secondary" disabled={busy} class="shrink-0">
            {busy ? <Spinner /> : 'Envoyer'}
          </Button>
        </form>
      </Card>
    </AppShell>
  );
}
