import { useState } from 'preact/hooks';
import { Check, HelpCircle, MessageSquare } from 'lucide-preact';
import type { AgentToolCall } from '../../lib/agent-stream';
import { cn } from '../../lib/cn';
import type { QuestionChoice } from './useAgentThread';
import type { Answer } from './types';

export type QuestionOption = { id: string; label: string; description?: string; action?: string; style?: string };
export type Question = { question: string; options: QuestionOption[]; allowFreeText: boolean };

/** Question `ask_user` (P5-04) lue dans les appels d'outils du message. */
export function questionFrom(tools: AgentToolCall[] | undefined): Question | null {
  const call = [...(tools ?? [])].reverse().find((t) => t.name === 'ask_user' && t.result && (t.result as { ok?: boolean }).ok !== false);
  const r = call?.result as Record<string, unknown> | undefined;
  if (!r || typeof r.question !== 'string' || !Array.isArray(r.options)) return null;
  const options = (r.options as QuestionOption[]).filter((o) => o && typeof o.id === 'string' && typeof o.label === 'string');
  if (options.length < 2) return null;
  return { question: r.question, options, allowFreeText: r.allow_free_text !== false };
}

export type QuestionState = 'open' | 'answered' | 'stale';

type Props = {
  q: Question;
  state: QuestionState;
  answer?: Answer;
  busy?: boolean;
  /** La question est déjà affichée juste au-dessus (bulle du run). */
  hideQuestion?: boolean;
  onAnswer?: (choice: QuestionChoice) => void;
};

const STYLE: Record<string, string> = {
  primary: 'bg-[var(--color-accent)] text-zinc-950 hover:brightness-110',
  danger: 'bg-[var(--color-danger)]/15 text-[var(--color-danger)] ring-1 ring-inset ring-[var(--color-danger)]/40 hover:bg-[var(--color-danger)]/25',
  secondary: 'bg-white/[0.06] text-[var(--color-ink)] ring-1 ring-inset ring-[var(--color-line-strong)] hover:bg-white/[0.1]',
};

/** Carte de question : un clic suffit ; ensuite lecture seule « Tu as choisi : X ». */
export function QuestionCard({ q, state, answer, busy, hideQuestion, onAnswer }: Props) {
  const [picked, setPicked] = useState<string | null>(null);
  const [other, setOther] = useState(false);
  const [text, setText] = useState('');
  const chosenId = answer?.optionId ?? picked;
  const done = state !== 'open' || picked !== null;
  const interactive = !done && !!onAnswer && !busy;

  function choose(o: QuestionOption) {
    if (!interactive) return;
    setPicked(o.id);
    onAnswer?.({ optionId: o.id, label: o.label, action: o.action });
  }
  function sendOther() {
    const t = text.trim();
    if (!t || !interactive) return;
    setPicked('__other');
    onAnswer?.({ label: 'Autre', text: t });
  }

  const answeredLabel = answer ? (answer.text ? `${answer.label && answer.label !== 'Autre' ? `${answer.label} — ` : ''}${answer.text}` : answer.label) : null;

  return (
    <div
      class="max-w-[min(100%,34rem)] rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface-2)]/60 p-3"
      role="group"
      aria-label="Question de l’agent"
      data-question={state === 'open' && !picked ? 'open' : 'done'}
    >
      <p class={cn('flex items-start gap-2 text-sm font-medium text-[var(--color-ink)]', hideQuestion && 'sr-only')}>
        <HelpCircle size={16} class="mt-0.5 shrink-0 text-[var(--color-accent)]" aria-hidden />
        <span class="min-w-0 [overflow-wrap:anywhere]">{q.question}</span>
      </p>
      {answeredLabel ? (
        <p class="mt-2 inline-flex first:mt-0 items-center gap-1.5 text-sm text-[var(--color-ink-muted)]" data-question-answer>
          <Check size={14} class="text-[var(--color-ok)]" aria-hidden />
          Tu as choisi : <span class="font-medium text-[var(--color-ink)]">{answeredLabel}</span>
        </p>
      ) : (
        <>
          <div class={cn('flex flex-wrap gap-2', !hideQuestion && 'mt-2.5')}>
            {q.options.map((o) => {
              const isChosen = chosenId === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  disabled={!interactive}
                  aria-pressed={isChosen}
                  title={o.description}
                  class={cn(
                    'df-tap-skip min-h-11 rounded-lg px-3 py-2 text-left text-sm font-medium transition-[opacity,transform,filter] duration-150 active:scale-[0.97] sm:min-h-9',
                    STYLE[o.style ?? 'secondary'] ?? STYLE.secondary,
                    done && !isChosen && 'opacity-40',
                    done && isChosen && 'ring-2 ring-[var(--color-accent)]',
                    'disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]',
                  )}
                  onClick={() => choose(o)}
                >
                  <span class="block">{o.label}</span>
                  {o.description && <span class="mt-0.5 block text-xs font-normal opacity-75">{o.description}</span>}
                </button>
              );
            })}
            {q.allowFreeText && interactive && !other && (
              <button
                type="button"
                class="df-tap-skip inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-[var(--color-ink-muted)] hover:bg-white/5 hover:text-[var(--color-ink)] sm:min-h-9"
                onClick={() => setOther(true)}
              >
                <MessageSquare size={14} aria-hidden />
                Autre…
              </button>
            )}
          </div>
          {other && interactive && (
            <form
              class="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                sendOther();
              }}
            >
              <input
                autoFocus
                value={text}
                maxLength={500}
                onInput={(e) => setText(e.currentTarget.value)}
                placeholder="Ta réponse…"
                aria-label="Ta réponse"
                class="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-base text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]/50 sm:min-h-9 sm:text-sm"
              />
              <button type="submit" disabled={!text.trim()} class="df-tap-skip min-h-11 rounded-lg bg-[var(--color-accent)] px-3 text-sm font-medium text-zinc-950 disabled:opacity-50 sm:min-h-9">
                Envoyer
              </button>
            </form>
          )}
          {state === 'stale' && !picked && <p class="mt-2 text-xs text-[var(--color-ink-faint)]">La conversation a continué : question sans réponse.</p>}
        </>
      )}
    </div>
  );
}
