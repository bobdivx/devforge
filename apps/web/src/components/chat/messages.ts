import {
  normalizeToolCalls,
  planFromToolCalls,
  wroteLocalFiles,
  type AgentChatResult,
  type AgentToolCall,
  type StreamHandlers,
} from '../../lib/agent-stream';
import { applyMilestone, mergeLiveFinal } from '../../lib/activity';
import { localMessageId, serverMessageId } from '../../lib/chat-messages';
import { needsUserActionFrom } from '../../lib/publish-approval';
import type { Answer, Attachment, ChatMessage, Reaction } from './types';

/** Message tel que renvoyé par l'API (fil d'agent ou partage). */
export type ServerMessage = {
  uuid?: string | null;
  role: string;
  content: string;
  provider?: string | null;
  tool_calls_json?: string | null;
  attachments_json?: string | null;
  reply_to_uuid?: string | null;
  reactions_json?: string | null;
};

function parseJsonArray<T>(raw?: string | null): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

/** Réponse structurée (P5-04) portée par un message utilisateur. */
export function answerFrom(tools: AgentToolCall[]): Answer | undefined {
  const a = tools.find((t) => t.name === 'answer');
  const r = a?.result as Record<string, unknown> | undefined;
  if (!r) return undefined;
  return {
    answerTo: (r.answer_to as string) ?? null,
    optionId: (r.option_id as string) ?? null,
    label: String(r.label ?? ''),
    text: (r.text as string) ?? null,
  };
}

export function parseToolCalls(raw?: string | null): AgentToolCall[] {
  if (!raw) return [];
  try {
    return normalizeToolCalls(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Historique serveur → messages du fil (cartes d'action seulement sur le dernier tour). */
export function fromServerMessages(list: ServerMessage[]): ChatMessage[] {
  return list.map((m, i) => {
    const tools = parseToolCalls(m.tool_calls_json);
    const isLast = i === list.length - 1;
    const attachments = parseJsonArray<Attachment>(m.attachments_json);
    const reactions = parseJsonArray<Reaction>(m.reactions_json);
    return {
      id: serverMessageId(m.uuid ?? undefined, i),
      serverUuid: m.uuid ?? undefined,
      attachments: attachments.length ? attachments : undefined,
      reactions: reactions.length ? reactions : undefined,
      replyTo: m.reply_to_uuid ?? undefined,
      answer: m.role === 'user' ? answerFrom(tools) : undefined,
      role: m.role,
      content: m.content,
      provider: m.provider || undefined,
      toolCalls: tools,
      plan: planFromToolCalls(tools),
      canOpenPr: wroteLocalFiles(tools),
      // Dernier tour seulement (ex. réveil bloqué en attente de validation) : pas de vieux boutons.
      needsUserAction: isLast && m.role === 'assistant' ? needsUserActionFrom(tools) : undefined,
    };
  });
}

/** Brouillon de réponse vide (points de frappe), finalisé plus tard sur le même id. */
export function draftMessage(startedAt: number, id = localMessageId()): ChatMessage {
  return { id, role: 'assistant', content: '', streaming: true, startedAt, actions: [], reflections: [], milestones: [] };
}

/** Écouteurs de flux qui font évoluer un brouillon (run envoyé ici ou repris). */
export function draftHandlers(
  update: (fn: (m: ChatMessage) => ChatMessage) => void,
  onRunStarted?: (runUuid: string) => void,
): StreamHandlers {
  let seq = 0;
  return {
    onRunStarted: (runUuid) => {
      if (runUuid) onRunStarted?.(runUuid);
    },
    onAck: (text) => update((m) => ({ ...m, ack: text })),
    onThinking: (label, round, detail) => {
      update((m) => ({
        ...m,
        // L'accusé de réception reste affiché jusqu'au premier outil.
        liveLabel: detail?.trim() || (m.ack && !(m.actions ?? []).length) ? m.liveLabel : label,
        reflections: detail?.trim() ? [...(m.reflections ?? []), { label, detail, round, seq: seq++ }] : m.reflections,
      }));
    },
    onDelta: (text) => update((m) => ({ ...m, content: m.content + text })),
    onDeltaReset: (round) =>
      // Texte d'un tour à outils = raisonnement : il passe dans le groupe d'activité.
      update((m) => {
        const text = m.content.trim();
        if (!text) return { ...m, content: '' };
        const label = text.length > 120 ? `${text.slice(0, 120)}…` : text;
        return { ...m, content: '', reflections: [...(m.reflections ?? []), { label, detail: text, round, seq: seq++ }] };
      }),
    onMilestone: (label, status) => update((m) => ({ ...m, milestones: applyMilestone(m.milestones ?? [], label, status) })),
    onToolStart: (call) => {
      const s = seq++;
      update((m) => ({
        ...m,
        liveLabel: call.label || call.name.replace(/_/g, ' '),
        actions: [...(m.actions ?? []), { ...call, seq: s, status: 'running' }],
      }));
    },
    onToolDone: (call, ok) => {
      update((m) => {
        const next = [...(m.actions ?? [])];
        let idx = -1;
        for (let i = next.length - 1; i >= 0; i--) {
          const same = call.call_id && next[i].call_id ? next[i].call_id === call.call_id : next[i].name === call.name;
          if (same && next[i].status === 'running') {
            idx = i;
            break;
          }
        }
        if (idx >= 0) next[idx] = { ...next[idx], ...call, seq: next[idx].seq, status: ok ? 'ok' : 'fail' };
        else next.push({ ...call, seq: seq++, status: ok ? 'ok' : 'fail' });
        return { ...m, actions: next };
      });
    },
  };
}

/** Finalisation sur le même id : pas de nouveau message, pas de saut. */
export function finalizedMessage(m: ChatMessage, res: AgentChatResult, startedAt: number, now = Date.now()): ChatMessage {
  const tools = res.tool_calls ?? [];
  return {
    ...m,
    streaming: false,
    content: res.reply,
    provider: res.provider || undefined,
    toolCalls: tools,
    actions: mergeLiveFinal(m.actions ?? [], tools),
    reflections: m.reflections?.length ? m.reflections : (res.reflections ?? []),
    milestones: (m.milestones ?? []).map((x) => (x.status === 'running' ? { ...x, status: 'done' as const } : x)),
    plan: res.plan,
    canOpenPr: wroteLocalFiles(tools) || res.executed_plan === true,
    needsUserAction: needsUserActionFrom(tools),
    liveLabel: undefined,
    elapsedMs: now - startedAt,
  };
}

/**
 * Après un rechargement sans changement visible : on garde les messages affichés (aucun re-rendu
 * du run terminé) mais on adopte les uuids serveur (réactions, citations, réponses — P5).
 */
export function adoptServerUuids(prev: ChatMessage[], next: ChatMessage[]): ChatMessage[] {
  let k = 0;
  let changed = false;
  const out = prev.map((m) => {
    if (m.error) return m;
    const n = next[k++];
    if (n && n.role === m.role && n.serverUuid && m.serverUuid !== n.serverUuid) {
      changed = true;
      return { ...m, serverUuid: n.serverUuid, reactions: n.reactions, attachments: m.attachments ?? n.attachments };
    }
    return m;
  });
  return changed ? out : prev;
}
