import { memo } from 'preact/compat';
import { AlertTriangle, RotateCcw } from 'lucide-preact';
import type { Job } from '../../lib/jobs';
import { Button } from '../ui';
import { AssistantMessage } from './AssistantMessage';
import { MessageEnter } from './MessageEnter';
import type { ChatMessage, ChatPersona } from './types';

export type MessageItemProps = {
  m: ChatMessage;
  persona?: ChatPersona;
  busy: boolean;
  animate: boolean;
  /** Partage / lecture seule : aucune action. */
  readOnly?: boolean;
  onSend?: (text: string) => void;
  onRetry?: (errorId: string) => void;
  /** Accord de publication puis message à l'agent. */
  onApprovePublish?: (text: string) => void;
  /** Carte de job : ouvrir le fil du worker (absent en mode persona). */
  onOpenThread?: (workerUuid: string) => void;
  /** Une carte de job vient de se terminer : recharger le fil (carte de résultat). */
  onJobFinished?: (job: Job) => void;
};

const WAKE_RE = /COORD-WAKE|Événement projet|Déploiement :/;

function UserBubble({ content }: { content: string }) {
  if (WAKE_RE.test(content)) {
    const summary = content.split('\n').slice(0, 3).join(' ').slice(0, 180) + (content.length > 180 ? '…' : '');
    return (
      <div class="mx-auto max-w-[92%] rounded-lg border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10 px-3 py-2 text-xs text-[var(--color-ink-muted)]">
        <span class="font-medium text-[var(--color-warn)]">Événement</span> · {summary}
      </div>
    );
  }
  return (
    <div class="ml-auto w-fit max-w-[90%] whitespace-pre-wrap break-words rounded-2xl bg-[var(--color-accent)] px-3 py-2 text-sm text-white [overflow-wrap:anywhere]">
      {content}
    </div>
  );
}

function ErrorCard({ m, busy, onRetry }: { m: ChatMessage; busy: boolean; onRetry?: (id: string) => void }) {
  return (
    <div
      role="alert"
      class="max-w-[92%] rounded-xl border border-[var(--color-line)] border-l-4 border-l-[var(--color-danger)] bg-[var(--color-danger)]/[0.06] px-3 py-2.5"
    >
      <div class="flex items-start gap-2.5">
        <AlertTriangle size={16} strokeWidth={2} class="mt-0.5 shrink-0 text-[var(--color-danger)]" aria-hidden />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-[var(--color-ink)]">L’agent n’a pas pu répondre</p>
          <p class="mt-0.5 break-words text-sm text-[var(--color-ink-muted)] [overflow-wrap:anywhere]">{m.content}</p>
          {onRetry && (
            <Button size="sm" variant="outline" class="mt-2" disabled={busy} onClick={() => onRetry(m.id)}>
              <RotateCcw size={13} strokeWidth={2} aria-hidden />
              Réessayer
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Un message du fil : bulle utilisateur, événement de réveil, erreur ou réponse d'agent. */
export function MessageItemView({ m, persona, busy, animate, readOnly, onSend, onRetry, onApprovePublish, onOpenThread, onJobFinished }: MessageItemProps) {
  const role = m.role === 'user' ? 'user' : 'assistant';
  return (
    <MessageEnter role={role} animate={animate} class="space-y-2">
      {m.role === 'user' ? (
        <UserBubble content={m.content} />
      ) : m.error ? (
        <ErrorCard m={m} busy={busy} onRetry={readOnly ? undefined : onRetry} />
      ) : (
        <AssistantMessage
          m={m}
          persona={persona}
          busy={busy}
          readOnly={readOnly}
          onSend={onSend}
          onApprovePublish={onApprovePublish}
          onOpenThread={onOpenThread}
          onJobFinished={onJobFinished}
        />
      )}
    </MessageEnter>
  );
}

/** Mémoïsé : un run en direct ne re-rend (ni ne re-parse le Markdown) que le message qui change. */
export const MessageItem = memo(
  MessageItemView,
  (a, b) =>
    (a.m === b.m || !(a.m.streaming || b.m.streaming || a.m.elapsedMs !== b.m.elapsedMs)) &&
    a.m.id === b.m.id &&
    a.m.content.length === b.m.content.length &&
    (a.m.toolCalls?.length ?? 0) === (b.m.toolCalls?.length ?? 0) &&
    !!a.m.error === !!b.m.error &&
    a.busy === b.busy &&
    a.animate === b.animate &&
    a.readOnly === b.readOnly &&
    a.persona === b.persona &&
    a.onSend === b.onSend &&
    a.onRetry === b.onRetry &&
    a.onApprovePublish === b.onApprovePublish &&
    a.onOpenThread === b.onOpenThread &&
    a.onJobFinished === b.onJobFinished &&
    (a.m.actions?.length ?? 0) === (b.m.actions?.length ?? 0) &&
    !!a.m.needsUserAction === !!b.m.needsUserAction,
);
