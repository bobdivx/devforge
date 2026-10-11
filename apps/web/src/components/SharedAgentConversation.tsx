import { useEffect, useMemo, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { ChatThread, useStickToBottom } from './chat/ChatThread';
import { MessageItem } from './chat/MessageItem';
import { fromServerMessages, type ServerMessage } from './chat/messages';
import { Alert, Badge, Card, FadeIn, Spinner } from './ui';

/** Conversation partagée en lecture seule : mêmes bulles que le chat, sans aucune action. */
export function SharedAgentConversation({ token: tokenProp }: { token?: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('Conversation partagée');
  const [projectName, setProjectName] = useState<string | null>(null);
  const [raw, setRaw] = useState<ServerMessage[]>([]);
  const [token, setToken] = useState(tokenProp || '');
  const messages = useMemo(() => fromServerMessages(raw).map((m) => ({ ...m, needsUserAction: undefined })), [raw]);
  const historyIds = useMemo(() => new Set(messages.map((m) => m.id)), [messages]);
  const stick = useStickToBottom([], token);

  useEffect(() => {
    if (tokenProp) {
      setToken(tokenProp);
      return;
    }
    let t = new URLSearchParams(window.location.search).get('token') || '';
    if (!t) {
      const m = window.location.pathname.match(/\/share\/agent\/([^/?#]+)/);
      if (m) t = decodeURIComponent(m[1]);
    }
    setToken(t);
  }, [tokenProp]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError('Lien invalide — token manquant.');
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const d = (await api.sharedAgentConversation(token)).data;
        if (cancelled) return;
        setTitle(d.agent_name || 'Conversation');
        setProjectName(d.project_name || null);
        setRaw(d.messages || []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Impossible de charger le partage');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return (
      <div class="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-[var(--color-ink-muted)]">
        <Spinner /> Chargement…
      </div>
    );
  }
  if (error) {
    return (
      <div class="mx-auto max-w-lg p-6">
        <Alert tone="warn">{error}</Alert>
      </div>
    );
  }
  return (
    <FadeIn>
      <div class="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-8">
        <header class="mb-6">
          <p class="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">DevForge · partage</p>
          <h1 class="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">{title}</h1>
          {projectName && <p class="mt-1 text-sm text-[var(--color-ink-muted)]">{projectName}</p>}
          <Badge class="mt-3" tone="ok">
            Lecture seule
          </Badge>
        </header>
        <Card padding="none" class="flex flex-1 flex-col overflow-hidden">
          <ChatThread messages={[]} historyIds={historyIds} stick={stick}>
            {messages.length === 0 && <p class="text-sm text-[var(--color-ink-muted)]">Aucun message.</p>}
            {messages.map((m) => (
              <MessageItem key={m.id} m={m} busy={false} animate={false} readOnly />
            ))}
          </ChatThread>
        </Card>
      </div>
    </FadeIn>
  );
}
