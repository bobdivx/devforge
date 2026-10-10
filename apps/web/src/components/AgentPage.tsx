import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { AlertTriangle } from 'lucide-preact';
import { api } from '../lib/api';
import { streamAgentChat, type AgentReflection, type AgentToolCall } from '../lib/agent-stream';
import { localMessageId } from '../lib/chat-messages';
import { cancelQueued, EMPTY_QUEUE, enqueue, flushOnIdle, type ComposerQueue } from '../lib/composer-queue';
import { Markdown, MD_MESSAGE_CLASS } from '../lib/markdown';
import { prefersReducedMotion } from '../lib/motion';
import { AppShell } from './AppShell';
import { Composer } from './chat/Composer';
import { MessageEnter } from './chat/MessageEnter';
import {
  AgentActionList,
  AgentReflectionList,
  AgentThinkingBlock,
  toLiveActions,
  type LiveAction,
} from './agents/AgentActionCards';
import { Badge, Card } from './ui';

type Msg = {
  id: string;
  role: 'user' | 'assistant';
  error?: boolean;
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [queue, setQueueState] = useState<ComposerQueue>(EMPTY_QUEUE);
  const queueRef = useRef<ComposerQueue>(EMPTY_QUEUE);
  const setQueue = (q: ComposerQueue) => {
    queueRef.current = q;
    setQueueState(q);
  };
  const sendRef = useRef<(text: string) => Promise<void>>(async () => undefined);

  useEffect(() => {
    async function checkLlm() {
      try {
        const status = await api.llmStatus();
        const mode = status.mode || 'stub';
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
    // Seule la zone des messages défile (pas la page).
    const box = scrollRef.current;
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [messages, thinking, liveActions, liveReflections, thinkDetail]);

  async function send(raw: string) {
    const text = raw.trim();
    if (!text) return;
    if (busyRef.current) {
      setQueue(enqueue(queueRef.current, text));
      setInput('');
      return;
    }
    busyRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    let aborted = false;
    setBusy(true);
    setThinking('Analyse de la demande…');
    setThinkDetail(undefined);
    setThinkStarted(Date.now());
    setLiveActions([]);
    setLiveReflections([]);
    setMessages((m) => [...m, { id: localMessageId(), role: 'user', content: text }]);
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
                const same = call.call_id && next[i].call_id ? next[i].call_id === call.call_id : next[i].name === call.name;
                if (same && next[i].status === 'running') {
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
        controller.signal,
      );
      setMessages((m) => [
        ...m,
        {
          id: localMessageId(),
          role: 'assistant',
          content: res.reply,
          provider: res.provider ?? llm,
          toolCalls: res.tool_calls ?? [],
          reflections: res.reflections ?? [],
        },
      ]);
    } catch (err: unknown) {
      if (controller.signal.aborted || (err as Error)?.name === 'AbortError') {
        aborted = true;
      } else {
        setMessages((m) => [
          ...m,
          { id: localMessageId(), role: 'assistant', content: String((err as Error).message || err), error: true },
        ]);
      }
    } finally {
      busyRef.current = false;
      abortRef.current = null;
      setBusy(false);
      setThinking(null);
      setThinkDetail(undefined);
      setLiveActions([]);
      setLiveReflections([]);
      const { state, send: next } = flushOnIdle(queueRef.current);
      setQueue(state);
      if (next) {
        if (aborted) setInput((cur) => (cur.trim() ? `${next}\n\n${cur}` : next));
        else window.setTimeout(() => void sendRef.current(next), 0);
      }
    }
  }
  sendRef.current = send;

  return (
    <AppShell active="agent" title="Agent">
      <Card padding="none" class="flex h-[min(calc(100dvh-14rem),640px)] flex-col overflow-hidden lg:h-[min(70vh,640px)]">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3 text-sm text-[var(--color-ink-muted)]">
          <span class="min-w-0">Chat global · tools DevForge</span>
          {llm === 'stub' || llm === 'offline' || llm === '—' ? (
            <Badge tone="warn">Modèle indisponible</Badge>
          ) : (
            <span
              class="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-ok)]"
              title={`Modèle prêt (${llm})`}
              role="img"
              aria-label="Modèle prêt"
            />
          )}
        </div>
        <div ref={scrollRef} class="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
          {messages.length === 0 && (
            <>
              {llmError ? (
                <p class="text-sm text-[var(--color-ink-muted)]">
                  LLM configuré mais erreur : <strong>{llmError}</strong>. Corrige-le dans{' '}
                  <a class="underline" href="/app/settings?tab=llm">
                    Paramètres → Agents / LLM
                  </a>
                  .
                </p>
              ) : (
                <p class="text-sm text-[var(--color-ink-muted)]">
                  « liste les projets », « smoke ». Le modèle se configure dans{' '}
                  <a class="underline" href="/app/settings?tab=llm">
                    Paramètres → Agents / LLM
                  </a>
                  .
                </p>
              )}
            </>
          )}
          {messages.map((m) => (
            <MessageEnter key={m.id} role={m.role} animate class="space-y-2">
              {m.role === 'user' ? (
                <div class="ml-auto w-fit max-w-[90%] whitespace-pre-wrap break-words rounded-2xl bg-[var(--color-accent)] px-3 py-2 text-sm text-white [overflow-wrap:anywhere]">
                  {m.content}
                </div>
              ) : m.error ? (
                <div
                  role="alert"
                  class="flex max-w-[92%] items-start gap-2.5 rounded-xl border border-[var(--color-line)] border-l-4 border-l-[var(--color-danger)] bg-[var(--color-danger)]/[0.06] px-3 py-2.5 text-sm"
                >
                  <AlertTriangle size={16} strokeWidth={2} class="mt-0.5 shrink-0 text-[var(--color-danger)]" aria-hidden />
                  <div class="min-w-0">
                    <p class="font-medium text-[var(--color-ink)]">L’agent n’a pas pu répondre</p>
                    <p class="mt-0.5 break-words text-[var(--color-ink-muted)] [overflow-wrap:anywhere]">{m.content}</p>
                  </div>
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
                    <div class="max-w-full">
                      <Markdown text={m.content} class={MD_MESSAGE_CLASS} />
                      {m.provider && (
                        <div class="mt-1 text-[11px] text-[var(--color-ink-faint)]">{m.provider}</div>
                      )}
                    </div>
                  )}
                </>
              )}
            </MessageEnter>
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
        </div>
        <Composer
          inputId={inputId}
          value={input}
          onChange={setInput}
          onSubmit={(text) => void send(text)}
          busy={busy}
          onStop={() => abortRef.current?.abort()}
          queued={queue.queued}
          onCancelQueued={() => setQueue(cancelQueued(queueRef.current))}
          placeholder="Message…"
          class="shrink-0 border-t border-[var(--color-line)] p-3"
        />
      </Card>
    </AppShell>
  );
}
