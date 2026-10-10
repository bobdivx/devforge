import { getToken } from './auth';

const SERVER_BASE =
  import.meta.env.PUBLIC_SERVER_URL ??
  import.meta.env.PUBLIC_API_URL ??
  'http://127.0.0.1:8000/api/v1';

export type AgentToolCall = {
  /** Id de l'appel (tool call LLM) — clé React stable des cartes d'outils. */
  call_id?: string;
  name: string;
  /** Libellé humain envoyé par le serveur (« Lecture de src/app.ts »). */
  label?: string;
  /** Une ligne : « ✓ build OK · 12 s ». */
  summary?: string;
  elapsed_ms?: number;
  /** Ordre d'arrivée pendant le run (outils et réflexions mêlés). */
  seq?: number;
  arguments?: Record<string, unknown>;
  result?: {
    ok?: boolean;
    mode?: string;
    path?: string;
    needs_user_action?: boolean;
    code?: string;
    kind?: string;
    message_fr?: string;
    settings_href?: string;
    resume_hint?: string;
    preview_url?: string;
    public_ok?: boolean;
    previous_content?: string | null;
    unified_diff?: string;
    additions?: number;
    deletions?: number;
    created?: boolean;
    plan?: { title?: string; summary?: string; steps?: string[] };
    [key: string]: unknown;
  };
};

export type AgentPlan = {
  title: string;
  summary?: string;
  steps: string[];
};

export type AgentReflection = {
  label: string;
  detail?: string;
  round?: number;
  seq?: number;
};

export type AgentChatResult = {
  reply: string;
  provider?: string;
  tool_calls: AgentToolCall[];
  plan?: AgentPlan | null;
  reflections?: AgentReflection[];
  /** Le plan a déjà été exécuté dans ce tour (écritures locales). */
  executed_plan?: boolean;
};

export type MilestoneStatus = 'running' | 'done' | 'failed';

export type StreamHandlers = {
  onRunStarted?: (runUuid: string, messageUuid: string) => void;
  /** Accusé de réception immédiat (« Je regarde. »), jamais persisté. */
  onAck?: (text: string) => void;
  onThinking?: (label: string, round: number, detail?: string) => void;
  /** Morceau de texte du modèle (streaming). */
  onDelta?: (text: string, round: number) => void;
  /** Le texte streamé de ce tour était du raisonnement : à déplacer vers la réflexion. */
  onDeltaReset?: (round: number) => void;
  onMilestone?: (label: string, status: MilestoneStatus) => void;
  onToolStart?: (call: AgentToolCall) => void;
  onToolDone?: (call: AgentToolCall, ok: boolean) => void;
  onPlan?: (plan: AgentPlan) => void;
};

/**
 * Normalise les tool calls venant du serveur (`ToolCallRecord` : champ `id`)
 * vers `AgentToolCall` (`call_id`). Tolère l'ancien format sans id.
 */
export function normalizeToolCalls(raw: unknown): AgentToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t) => {
      const { id, ...rest } = t as { id?: unknown } & Record<string, unknown>;
      const call = rest as unknown as AgentToolCall;
      const callId = typeof call.call_id === 'string' && call.call_id ? call.call_id : typeof id === 'string' && id ? id : undefined;
      return callId ? { ...call, call_id: callId } : call;
    });
}

/** Clé React d'une carte d'outil : id de l'appel, sinon nom + position. */
export function toolCallKey(call: Pick<AgentToolCall, 'call_id' | 'name'>, index: number): string {
  return call.call_id || `${call.name}-${index}`;
}

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

export function humanAgentHttpError(status: number, text: string): string {
  const trimmed = text.trim();
  try {
    const j = JSON.parse(trimmed) as { error?: string };
    if (j.error) return j.error;
  } catch {
    /* corps HTML ou texte brut */
  }
  if (
    status === 524 ||
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html') ||
    /A timeout occurred/i.test(trimmed) ||
    /Error code 524/.test(trimmed)
  ) {
    return 'Le serveur n’a pas répondu à temps. La revue a été coupée par le délai du proxy. Réessaie.';
  }
  return trimmed || `Erreur HTTP ${status}`;
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

/**
 * Découpe un flux SSE en événements. Un événement peut être coupé entre deux paquets
 * réseau : le reste est gardé jusqu'au paquet suivant (indispensable avec les deltas).
 */
export function createSseParser(onEvent: (event: string, data: string) => void) {
  let buf = '';
  const drain = (final: boolean) => {
    const parts = buf.split('\n\n');
    buf = final ? '' : (parts.pop() ?? '');
    for (const part of parts) {
      const parsed = parseSseBlock(part.trim());
      if (parsed) onEvent(parsed.event, parsed.data);
    }
  };
  return {
    push(chunk: string) {
      buf += chunk.replace(/\r\n?/g, '\n');
      drain(false);
    },
    flush() {
      if (buf.trim()) {
        buf += '\n\n';
        drain(true);
      }
    },
  };
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
  signal?: AbortSignal,
): Promise<AgentChatResult> {
  const token = getToken();
  const res = await fetch(`${SERVER_BASE}/agent/chat`, {
    method: 'POST',
    signal,
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ message, stream: true, ...extra }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(humanAgentHttpError(res.status, text));
  }

  const ctype = res.headers.get('content-type') || '';
  if (!ctype.includes('text/event-stream')) {
    const json = (await res.json()) as { data?: AgentChatResult };
    const data = json.data ?? { reply: '', tool_calls: [] };
    data.tool_calls = normalizeToolCalls(data.tool_calls);
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
  let reply = '';
  let provider: string | undefined;
  let toolCalls: AgentToolCall[] = [];
  const liveTools: AgentToolCall[] = [];
  const reflections: AgentReflection[] = [];
  let plan: AgentPlan | null = null;
  let streamError: string | null = null;
  let executedPlan = false;
  /** Texte streamé par tour (déplacé vers la réflexion sur `delta_reset`). */
  const roundText = new Map<number, string>();
  let seq = 0;

  const onEvent = (event: string, data: string) => {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = String(payload.type || event);
    if (type === 'run_started') {
      handlers.onRunStarted?.(String(payload.run_uuid || ''), String(payload.message_uuid || ''));
    } else if (type === 'ack') {
      handlers.onAck?.(String(payload.text || ''));
    } else if (type === 'thinking') {
      const label = String(payload.label || 'Réflexion…');
      const detail = payload.detail ? String(payload.detail) : '';
      const round = Number(payload.round || 0);
      if (detail.trim()) {
        reflections.push({ label, detail, round, seq: seq++ });
      }
      handlers.onThinking?.(label, round, detail || undefined);
    } else if (type === 'delta') {
      const text = String(payload.text ?? '');
      const round = Number(payload.round || 0);
      roundText.set(round, (roundText.get(round) ?? '') + text);
      handlers.onDelta?.(text, round);
    } else if (type === 'delta_reset') {
      const round = Number(payload.round || 0);
      const text = (roundText.get(round) ?? '').trim();
      roundText.delete(round);
      if (text) {
        const label = text.length > 120 ? `${text.slice(0, 120)}…` : text;
        reflections.push({ label, detail: text, round, seq: seq++ });
      }
      handlers.onDeltaReset?.(round);
    } else if (type === 'milestone') {
      const label = String(payload.label || '');
      const status = payload.status as MilestoneStatus | undefined;
      if (status === 'running' || status === 'done' || status === 'failed') {
        handlers.onMilestone?.(label, status);
      } else {
        // Ancien serveur : jalon = « nouvel essai » affiché comme étape en cours.
        handlers.onThinking?.(label || 'Nouvel essai…', Number(payload.round || 0));
      }
    } else if (type === 'tool_start') {
      const call: AgentToolCall = {
        call_id: payload.id ? String(payload.id) : undefined,
        name: String(payload.name || '?'),
        arguments: (payload.arguments as Record<string, unknown>) || {},
        label: payload.label ? String(payload.label) : undefined,
        seq: seq++,
      };
      liveTools.push(call);
      handlers.onToolStart?.(call);
    } else if (type === 'tool_done') {
      const ok = payload.ok !== false;
      const call: AgentToolCall = {
        call_id: payload.id ? String(payload.id) : undefined,
        name: String(payload.name || '?'),
        arguments: (payload.arguments as Record<string, unknown>) || {},
        result: (payload.result as AgentToolCall['result']) || { ok },
        label: payload.label ? String(payload.label) : undefined,
        summary: payload.summary ? String(payload.summary) : undefined,
        elapsed_ms: typeof payload.elapsed_ms === 'number' ? payload.elapsed_ms : undefined,
      };
      // Rétro-compatibilité : sans id, appariement par nom (dernier appel sans résultat).
      const idx = [...liveTools]
        .map((t, i) => ({ t, i }))
        .reverse()
        .find((x) =>
          call.call_id && x.t.call_id ? x.t.call_id === call.call_id : x.t.name === call.name && !x.t.result,
        )?.i;
      if (idx != null) {
        const prev = liveTools[idx];
        Object.assign(call, { label: call.label ?? prev.label, seq: prev.seq });
        liveTools[idx] = call;
      } else {
        call.seq = seq++;
        liveTools.push(call);
      }
      handlers.onToolDone?.(call, ok);
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
      executedPlan = payload.executed_plan === true;
      provider = payload.provider ? String(payload.provider) : undefined;
      toolCalls = Array.isArray(payload.tool_calls) ? normalizeToolCalls(payload.tool_calls) : [...liveTools];
      if (!plan) plan = planFromToolCalls(toolCalls);
    } else if (type === 'error') {
      streamError = String(payload.message || 'Erreur agent');
    } else if (event === 'tool' && payload.name) {
      // Fallback ancien format
      const call = payload as unknown as AgentToolCall;
      liveTools.push(call);
      handlers.onToolDone?.(call, call.result?.ok !== false);
    }
  };

  const parser = createSseParser(onEvent);
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.flush();

  if (streamError) throw new Error(streamError);
  if (!toolCalls.length && liveTools.length) toolCalls = [...liveTools];
  if (!reply && toolCalls.length === 0 && !plan) {
    throw new Error('Réponse agent vide');
  }

  const preview = previewUrlFromTools(toolCalls);
  if (preview || wroteLocalFiles(toolCalls) || toolCalls.some((t) => t.name === 'start_local_preview')) {
    notifyPreviewRefresh({ url: preview, reason: 'agent' });
  }

  return {
    reply: reply || 'Terminé.',
    provider,
    tool_calls: toolCalls,
    plan,
    reflections,
    executed_plan: executedPlan,
  };
}
