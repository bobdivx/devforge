import { useCallback, useId, useRef, useState } from 'preact/hooks';
import { streamAgentChat } from '../lib/agent-stream';
import { localMessageId } from '../lib/chat-messages';
import { cancelQueued, EMPTY_QUEUE, enqueue, flushOnIdle, type ComposerQueue } from '../lib/composer-queue';
import { AppShell } from './AppShell';
import { ChatThread, useStickToBottom } from './chat/ChatThread';
import { Composer } from './chat/Composer';
import { MessageItem } from './chat/MessageItem';
import { draftHandlers, draftMessage, finalizedMessage } from './chat/messages';
import type { ChatMessage } from './chat/types';
import { useLlmStatus } from './chat/useLlmStatus';
import { Badge, Card } from './ui';

const NO_HISTORY = new Set<string>();

/** Chat global (hors projet) : mêmes bulles et même fil que le chat projet. */
export function AgentPage() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const llm = useLlmStatus();
  const inputId = useId();
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [queue, setQueueState] = useState<ComposerQueue>(EMPTY_QUEUE);
  const queueRef = useRef<ComposerQueue>(EMPTY_QUEUE);
  const setQueue = (q: ComposerQueue) => {
    queueRef.current = q;
    setQueueState(q);
  };
  const stick = useStickToBottom(messages, null);

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
    const startedAt = Date.now();
    const draft = draftMessage(startedAt);
    const update = (fn: (m: ChatMessage) => ChatMessage) => setMessages((prev) => prev.map((m) => (m.id === draft.id ? fn(m) : m)));
    setMessages((m) => [...m, { id: localMessageId(), role: 'user', content: text }, draft]);
    setInput('');
    stick.follow();
    try {
      const res = await streamAgentChat(text, {}, draftHandlers(update), controller.signal);
      update((m) => ({ ...finalizedMessage(m, res, startedAt), provider: res.provider ?? llm.mode }));
    } catch (err: unknown) {
      if (controller.signal.aborted || (err as Error)?.name === 'AbortError') {
        aborted = true;
        setMessages((prev) => prev.filter((m) => m.id !== draft.id));
      } else {
        update(() => ({ id: draft.id, role: 'assistant', content: String((err as Error).message || err), error: true }));
      }
    } finally {
      busyRef.current = false;
      abortRef.current = null;
      setBusy(false);
      const { state, send: next } = flushOnIdle(queueRef.current);
      setQueue(state);
      if (next) {
        if (aborted) setInput((cur) => (cur.trim() ? `${next}\n\n${cur}` : next));
        else window.setTimeout(() => void sendRef.current(next), 0);
      }
    }
  }
  const sendRef = useRef(send);
  sendRef.current = send;
  const onSend = useCallback((t: string) => void sendRef.current(t), []);

  return (
    <AppShell active="agent" title="Agent">
      <Card padding="none" class="flex h-[min(calc(100dvh-14rem),640px)] flex-col overflow-hidden lg:h-[min(70vh,640px)]">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3 text-sm text-[var(--color-ink-muted)]">
          <span class="min-w-0">Chat global · tools DevForge</span>
          {llm.ready ? (
            <span class="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-ok)]" title={`Modèle prêt (${llm.mode})`} role="img" aria-label="Modèle prêt" />
          ) : (
            <Badge tone="warn">Modèle indisponible</Badge>
          )}
        </div>
        <ChatThread messages={messages} historyIds={NO_HISTORY} stick={stick}>
          {messages.length === 0 && (
            <p class="text-sm text-[var(--color-ink-muted)]">
              {llm.error ? (
                <>
                  LLM configuré mais erreur : <strong>{llm.error}</strong>. Corrige-le dans{' '}
                </>
              ) : (
                '« liste les projets », « smoke ». Le modèle se configure dans '
              )}
              <a class="underline" href="/app/settings?tab=llm">
                Paramètres → Agents / LLM
              </a>
              .
            </p>
          )}
          {messages.map((m) => (
            <MessageItem key={m.id} m={m} busy={busy} animate onSend={onSend} />
          ))}
        </ChatThread>
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
