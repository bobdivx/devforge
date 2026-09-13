import { getToken } from './auth';

const SERVER_BASE =
  import.meta.env.PUBLIC_SERVER_URL ??
  import.meta.env.PUBLIC_API_URL ??
  'http://127.0.0.1:8000/api/v1';

export type AgentToolCall = {
  name: string;
  arguments?: Record<string, unknown>;
  result?: {
    ok?: boolean;
    mode?: string;
    path?: string;
    needs_user_action?: boolean;
    kind?: string;
    message_fr?: string;
    settings_href?: string;
    resume_hint?: string;
    preview_url?: string;
    plan?: { title?: string; summary?: string; steps?: string[] };
    [key: string]: unknown;
  };
};

export type AgentPlan = {
  title: string;
  summary?: string;
  steps: string[];
};

export type AgentChatResult = {
  reply: string;
  provider?: string;
  tool_calls: AgentToolCall[];
  plan?: AgentPlan | null;
};

type StreamHandlers = {
  onThinking?: (label: string, round: number) => void;
  onToolStart?: (call: AgentToolCall) => void;
  onToolDone?: (call: AgentToolCall, ok: boolean) => void;
  onPlan?: (plan: AgentPlan) => void;
};

export function notifyPreviewRefresh(detail?: { url?: string; reason?: string }) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('devforge:preview-refresh', { detail: detail ?? {} }));
}

export function planFromToolCalls(tools: AgentToolCall[]): AgentPlan | null {
  for (const t of tools) {
    if (t.name !== 'propose_plan') continue;
    const raw = t.result?.plan;
    if (!raw?.title || !Array.isArray(raw.steps) || raw.steps.length === 0) continue;
    return {
      title: String(raw.title),
      summary: raw.summary ? String(raw.summary) : undefined,
      steps: raw.steps.map((s) => String(s)),
    };
  }
  return null;
}

export function wroteLocalFiles(tools: AgentToolCall[]): boolean {
  return tools.some(
    (t) =>
      t.name === 'write_project_file' &&
      (t.result?.mode === 'local' || t.arguments?.mode === 'local' || !t.arguments?.mode),
  );
}

export function previewUrlFromTools(tools: AgentToolCall[]): string | undefined {
  for (const t of tools) {
    if (t.name === 'start_local_preview' && typeof t.result?.preview_url === 'string') {
      return t.result.preview_url;
    }
  }
  return undefined;
}

function parseSseBlock(block: string): { event: string; data: string } | null {
  const lines = block.split('\n');
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

export async function streamAgentChat(
  message: string,
  extra: {
    tool?: string;
    arguments?: Record<string, unknown>;
    project_uuid?: string;
    agent_uuid?: string;
  },
  handlers: StreamHandlers = {},
): Promise<AgentChatResult> {
  const token = getToken();
  const res = await fetch(`${SERVER_BASE}/agent/chat`, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ message, stream: true, ...extra }),
  });

  if (!res.ok) {
    const text = await res.text();
    let msg = text || res.statusText;
    try {
      const j = JSON.parse(text);
      if (j.error) msg = j.error;
    } catch {
      /* keep */
    }
    throw new Error(msg);
  }

  const ctype = res.headers.get('content-type') || '';
  if (!ctype.includes('text/event-stream')) {
    const json = (await res.json()) as { data?: AgentChatResult };
    const data = json.data ?? { reply: '', tool_calls: [] };
    const plan = planFromToolCalls(data.tool_calls ?? []);
    if (plan) handlers.onPlan?.(plan);
    const preview = previewUrlFromTools(data.tool_calls ?? []);
    if (
      preview ||
      wroteLocalFiles(data.tool_calls ?? []) ||
      (data.tool_calls ?? []).some((t) => t.name === 'start_local_preview')
    ) {
      notifyPreviewRefresh({ url: preview, reason: 'agent' });
    }
    return { ...data, plan };
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('Flux agent indisponible');
  }

  const decoder = new TextDecoder();
  let buf = '';
  let reply = '';
  let provider: string | undefined;
  let toolCalls: AgentToolCall[] = [];
  let plan: AgentPlan | null = null;
  let streamError: string | null = null;

  const consume = (chunk: string) => {
    const parts = chunk.split('\n\n');
    buf = parts.pop() ?? '';
    for (const part of parts) {
      const parsed = parseSseBlock(part.trim());
      if (!parsed) continue;
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(parsed.data) as Record<string, unknown>;
      } catch {
        continue;
      }
      const type = String(payload.type || parsed.event);
      if (type === 'thinking') {
        handlers.onThinking?.(String(payload.label || 'Réflexion…'), Number(payload.round || 0));
      } else if (type === 'tool_start') {
        handlers.onToolStart?.({
          name: String(payload.name || '?'),
          arguments: (payload.arguments as Record<string, unknown>) || {},
        });
      } else if (type === 'tool_done') {
        const ok = payload.ok !== false;
        handlers.onToolDone?.(
          {
            name: String(payload.name || '?'),
            arguments: (payload.arguments as Record<string, unknown>) || {},
            result: (payload.result as AgentToolCall['result']) || { ok },
          },
          ok,
        );
      } else if (type === 'plan') {
        const steps = Array.isArray(payload.steps) ? payload.steps.map((s) => String(s)) : [];
        plan = {
          title: String(payload.title || 'Plan'),
          summary: payload.summary ? String(payload.summary) : undefined,
          steps,
        };
        handlers.onPlan?.(plan);
      } else if (type === 'reply') {
        reply = String(payload.content || '');
        provider = payload.provider ? String(payload.provider) : undefined;
        toolCalls = Array.isArray(payload.tool_calls)
          ? (payload.tool_calls as AgentToolCall[])
          : [];
        if (!plan) plan = planFromToolCalls(toolCalls);
      } else if (type === 'error') {
        streamError = String(payload.message || 'Erreur agent');
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    consume(decoder.decode(value, { stream: true }));
  }
  if (buf.trim()) consume(`${buf}\n\n`);

  if (streamError) throw new Error(streamError);
  if (!reply && toolCalls.length === 0 && !plan) {
    throw new Error('Réponse agent vide');
  }

  const preview = previewUrlFromTools(toolCalls);
  if (preview || wroteLocalFiles(toolCalls) || toolCalls.some((t) => t.name === 'start_local_preview')) {
    notifyPreviewRefresh({ url: preview, reason: 'agent' });
  }

  return { reply: reply || 'Terminé.', provider, tool_calls: toolCalls, plan };
}
