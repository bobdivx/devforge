import { useEffect, useState } from 'preact/hooks';
import { fmtElapsed } from '../../lib/activity';
import { TypingDots, THINKING_COUNTER_AFTER_S } from '../agents/AgentActionCards';
import { StreamingText } from './StreamingText';

/**
 * Bulle de l'agent pendant et après un run (P2-05) : une seule zone vivante.
 * En-tête discret (accusé de réception → étape courante → « Terminé · 34 s »),
 * puis les points de frappe tant qu'aucun texte n'est arrivé, puis le texte streamé.
 */
export function RunBubble({
  content,
  streaming,
  ack,
  label,
  startedAt,
  elapsedMs,
}: {
  content: string;
  streaming: boolean;
  ack?: string;
  label?: string;
  startedAt?: number;
  elapsedMs?: number;
}) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!streaming || !startedAt) return;
    const tick = () => setSecs(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [streaming, startedAt]);

  const header = streaming
    ? label || ack || 'Réflexion…'
    : typeof elapsedMs === 'number'
      ? `Terminé · ${fmtElapsed(elapsedMs)}`
      : '';
  const empty = !content.trim();

  return (
    <div class="max-w-full" data-testid="run-bubble" data-streaming={streaming ? 'true' : 'false'}>
      {header ? (
        <div class="mb-1 flex h-5 min-w-0 items-center gap-2 text-[12px] text-[var(--color-ink-faint)]">
          <span role="status" aria-live="polite" class="min-w-0 truncate">
            {/* Nouvelle clé = fondu entre deux libellés. */}
            <span key={header} class="df-fade-in inline-block max-w-full truncate align-bottom">
              {header}
            </span>
          </span>
          {streaming && secs >= THINKING_COUNTER_AFTER_S ? (
            <span class="shrink-0 tabular-nums" aria-hidden>
              · {secs} s
            </span>
          ) : null}
        </div>
      ) : null}
      {streaming && empty ? (
        <div class="flex h-5 items-center" data-testid="typing">
          <TypingDots />
        </div>
      ) : (
        <StreamingText key="text" text={content} streaming={streaming} class="df-fade-in" />
      )}
    </div>
  );
}
