import { memo } from 'preact/compat';
import { useState } from 'preact/hooks';
import { AlertTriangle, Check, CornerDownRight, RotateCcw } from 'lucide-preact';
import { prefersReducedMotion } from '../../lib/motion';
import type { Job } from '../../lib/jobs';
import { Button } from '../ui';
import { AssistantMessage } from './AssistantMessage';
import { MessageEnter } from './MessageEnter';
import { ImageGrid } from './ImageAttachment';
import type { QuestionState } from './QuestionCard';
import { MessageActions, ReactionPicker, ReactionPills, useLongPress } from './Reactions';
import type { QuestionChoice } from './useAgentThread';
import type { Answer, ChatMessage, ChatPersona } from './types';

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
  /** P5-03 : réagir (id d'affichage du message). */
  onReact?: (id: string, emoji: string) => void;
  /** P5-06 : répondre à ce message. */
  onReply?: (m: ChatMessage) => void;
  /** P5-06 : extrait du message cité (bulle utilisateur). */
  quote?: { targetId: string; excerpt: string } | null;
  /** P5-04 : question `ask_user` de ce message. */
  questionState?: QuestionState;
  questionAnswer?: Answer;
  onAnswer?: (m: ChatMessage, question: string, choice: QuestionChoice) => void;
};

/** Fait défiler jusqu'au message cité et le surligne 1 s. */
export function jumpToMessage(id: string) {
  const el = document.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(id)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  el.classList.remove('df-flash');
  void el.offsetWidth;
  el.classList.add('df-flash');
  window.setTimeout(() => el.classList.remove('df-flash'), 1100);
}

function QuoteChip({ quote, align }: { quote: { targetId: string; excerpt: string }; align: 'end' | 'start' }) {
  return (
    <button
      type="button"
      class={`df-tap-skip flex max-w-[85%] items-start gap-1.5 rounded-lg border-l-2 border-[var(--color-accent)]/60 bg-white/[0.04] px-2 py-1 text-left text-xs text-[var(--color-ink-muted)] hover:bg-white/[0.07] ${align === 'end' ? 'ml-auto' : ''}`}
      onClick={() => jumpToMessage(quote.targetId)}
      aria-label={`Voir le message cité : ${quote.excerpt}`}
      data-quote
    >
      <CornerDownRight size={12} class="mt-0.5 shrink-0" aria-hidden />
      <span class="line-clamp-2 [overflow-wrap:anywhere]">{quote.excerpt}</span>
    </button>
  );
}

const WAKE_RE = /COORD-WAKE|Événement projet|Déploiement :/;

function UserBubble({ m, quote }: { m: ChatMessage; quote?: { targetId: string; excerpt: string } | null }) {
  const content = m.content;
  if (WAKE_RE.test(content)) {
    const summary = content.split('\n').slice(0, 3).join(' ').slice(0, 180) + (content.length > 180 ? '…' : '');
    return (
      <div class="mx-auto max-w-[92%] rounded-lg border border-[var(--color-warn)]/40 bg-[var(--color-warn)]/10 px-3 py-2 text-xs text-[var(--color-ink-muted)]">
        <span class="font-medium text-[var(--color-warn)]">Événement</span> · {summary}
      </div>
    );
  }
  if (m.answer) {
    // P5-04 : réponse à une question, affichée « ✓ choix ».
    const a = m.answer;
    const label = a.text ? `${a.label && a.label !== 'Autre' ? `${a.label} — ` : ''}${a.text}` : a.label;
    return (
      <div class="ml-auto inline-flex w-fit max-w-[90%] items-center gap-1.5 rounded-2xl bg-[var(--color-accent)] px-3 py-2 text-sm text-white [overflow-wrap:anywhere]" data-answer>
        <Check size={14} strokeWidth={2.4} aria-hidden />
        {label}
      </div>
    );
  }
  return (
    <div class="space-y-1">
      {quote && <QuoteChip quote={quote} align="end" />}
      {m.attachments && m.attachments.length > 0 && <ImageGrid images={m.attachments} />}
      {content.trim() && (
        <div class="ml-auto w-fit max-w-[90%] whitespace-pre-wrap break-words rounded-2xl bg-[var(--color-accent)] px-3 py-2 text-sm text-white [overflow-wrap:anywhere]">
          {content}
        </div>
      )}
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
export function MessageItemView(props: MessageItemProps) {
  const { m, persona, busy, animate, readOnly, onSend, onRetry, onApprovePublish, onOpenThread, onJobFinished, onReact, onReply, quote } = props;
  const role = m.role === 'user' ? 'user' : 'assistant';
  const [picker, setPicker] = useState(false);
  // Réactions et réponses : messages persistés, run terminé, hors lecture seule.
  const canAct = !readOnly && !!m.serverUuid && !m.streaming && !m.error && m.role === 'assistant';
  const react = canAct && onReact ? (emoji: string) => onReact(m.id, emoji) : undefined;
  const reply = canAct && onReply ? () => onReply(m) : undefined;
  const longPress = useLongPress(() => react && setPicker(true));
  return (
    <MessageEnter role={role} animate={animate} class="space-y-2">
      <div data-msg-id={m.id} class="group/msg relative space-y-1.5">
        {m.role === 'user' ? (
          <UserBubble m={m} quote={quote} />
        ) : m.error ? (
          <ErrorCard m={m} busy={busy} onRetry={readOnly ? undefined : onRetry} />
        ) : (
          <div {...(react ? longPress : {})}>
            <AssistantMessage
              m={m}
              persona={persona}
              busy={busy}
              readOnly={readOnly}
              onSend={onSend}
              onApprovePublish={onApprovePublish}
              onOpenThread={onOpenThread}
              onJobFinished={onJobFinished}
              questionState={props.questionState}
              questionAnswer={props.questionAnswer}
              onAnswer={readOnly ? undefined : props.onAnswer}
            />
          </div>
        )}
        {m.role !== 'user' && !m.error && ((m.reactions?.length ?? 0) > 0 || react || reply) && (
          <div class={persona ? 'flex flex-wrap items-center gap-1 pl-[2.375rem]' : 'flex flex-wrap items-center gap-1'}>
            <ReactionPills reactions={m.reactions ?? []} onToggle={react} />
            <MessageActions onReact={react} onReply={reply} />
            {picker && react && (
              <div class="relative">
                <ReactionPicker onPick={react} onReply={reply} onClose={() => setPicker(false)} />
              </div>
            )}
          </div>
        )}
      </div>
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
    a.onReact === b.onReact &&
    a.onReply === b.onReply &&
    a.onAnswer === b.onAnswer &&
    a.m.reactions === b.m.reactions &&
    a.m.serverUuid === b.m.serverUuid &&
    a.m.attachments === b.m.attachments &&
    a.m.answer === b.m.answer &&
    a.questionState === b.questionState &&
    a.questionAnswer === b.questionAnswer &&
    a.quote?.excerpt === b.quote?.excerpt &&
    (a.m.actions?.length ?? 0) === (b.m.actions?.length ?? 0) &&
    !!a.m.needsUserAction === !!b.m.needsUserAction,
);
