import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { AppShell } from './AppShell';
import { Badge, Button, Card, Input } from './ui';

type Msg = { role: 'user' | 'assistant'; content: string; meta?: string };

export function AgentPage() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [llm, setLlm] = useState<string>('—');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .health()
      .then((h) => setLlm(h.backends?.llm ?? 'stub'))
      .catch(() => setLlm('offline'));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send(e: Event) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setMessages((m) => [...m, { role: 'user', content: text }]);
    setInput('');
    try {
      const res = await api.agentChat(text);
      const tools = (res.data.tool_calls as Array<{ name?: string }> | undefined) ?? [];
      const toolHint =
        tools.length > 0 ? `tools: ${tools.map((t) => t.name ?? '?').join(', ')}` : undefined;
      const provider = res.data.provider ?? llm;
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content: res.data.reply,
          meta: [provider, toolHint].filter(Boolean).join(' · ') || undefined,
        },
      ]);
    } catch (err: unknown) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: `Erreur: ${String((err as Error).message || err)}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell active="agent" title="Agent">
      <Card padding="none" class="flex h-[min(70vh,640px)] flex-col overflow-hidden">
        <div class="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3 text-sm text-[var(--color-ink-muted)]">
          <span>Chat global · tools DevForge</span>
          <Badge tone={llm === 'stub' || llm === 'offline' ? 'warn' : 'ok'}>LLM {llm}</Badge>
        </div>
        <div class="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && (
            <p class="text-sm text-[var(--color-ink-muted)]">
              « liste les projets », « smoke », ou configure DEVFORGE_LLM_API_KEY pour un vrai modèle.
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              class={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                m.role === 'user'
                  ? 'ml-auto bg-[var(--color-accent)] text-white'
                  : 'bg-[var(--color-surface)] text-[var(--color-ink)]'
              }`}
            >
              {m.content}
              {m.meta && <div class="mt-1 text-xs opacity-70">{m.meta}</div>}
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <form class="flex gap-2 border-t border-[var(--color-line)] p-3" onSubmit={send}>
          <div class="flex-1">
            <Input
              value={input}
              onInput={(e) => setInput((e.target as HTMLInputElement).value)}
              placeholder="Message…"
              disabled={busy}
            />
          </div>
          <Button type="submit" variant="secondary" disabled={busy}>
            Envoyer
          </Button>
        </form>
      </Card>
    </AppShell>
  );
}
