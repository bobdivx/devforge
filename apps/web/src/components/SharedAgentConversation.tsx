import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import {
  AgentActionList,
  toLiveActions,
  type LiveAction,
} from './agents/AgentActionCards';
import type { AgentToolCall } from '../lib/agent-stream';
import { Alert, Badge, Card, FadeIn, Spinner } from './ui';

type SharedMsg = {
  uuid: string;
  role: string;
  content: string;
  provider?: string;
  tool_calls_json?: string;
  created_at: string;
};

function parseTools(raw?: string): AgentToolCall[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((t) => ({
      name: String(t.name || ''),
      arguments: t.arguments || {},
      result: t.result,
    }));
  } catch {
    return [];
  }
}

export function SharedAgentConversation({ token: tokenProp }: { token?: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('Conversation partagée');
  const [projectName, setProjectName] = useState<string | null>(null);
  const [messages, setMessages] = useState<SharedMsg[]>([]);
  const [token, setToken] = useState(tokenProp || '');

  useEffect(() => {
    if (tokenProp) {
      setToken(tokenProp);
      return;
    }
    const params = new URLSearchParams(window.location.search);
    let t = params.get('token') || '';
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
        const r = await api.sharedAgentConversation(token);
        if (cancelled) return;
        const d = r.data;
        setTitle(d.agent_name || 'Conversation');
        setProjectName(d.project_name || null);
        setMessages(d.messages || []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Impossible de charger le partage');
        }
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
          <p class="text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
            DevForge · partage
          </p>
          <h1 class="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
            {title}
          </h1>
          {projectName && (
            <p class="mt-1 text-sm text-[var(--color-ink-muted)]">{projectName}</p>
          )}
          <Badge class="mt-3" tone="ok">
            Lecture seule
          </Badge>
        </header>

        <Card padding="none" class="flex flex-1 flex-col overflow-hidden">
          <div class="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <p class="text-sm text-[var(--color-ink-muted)]">Aucun message.</p>
            )}
            {messages.map((m) => {
              const tools = parseTools(m.tool_calls_json);
              const actions: LiveAction[] = toLiveActions(tools);
              if (m.role === 'user') {
                return (
                  <div
                    key={m.uuid}
                    class="ml-auto max-w-[90%] whitespace-pre-wrap break-words rounded-2xl bg-[var(--color-accent)] px-3 py-2 text-sm text-white"
                  >
                    {m.content}
                  </div>
                );
              }
              return (
                <div key={m.uuid} class="space-y-2">
                  {actions.length > 0 && <AgentActionList actions={actions} />}
                  {m.content.trim() && (
                    <div class="max-w-[92%] whitespace-pre-wrap break-words text-sm text-[var(--color-ink)]">
                      {m.content}
                      {m.provider && (
                        <div class="mt-1 text-[11px] text-[var(--color-ink-faint)]">
                          {m.provider}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </FadeIn>
  );
}
