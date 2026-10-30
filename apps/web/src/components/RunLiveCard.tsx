import { useEffect, useState } from 'preact/hooks';
import { api, type RunLive, type StepState } from '../lib/api';
import { cn } from '../lib/cn';
import {
  LIVE_POLL_MS,
  OUTCOME_LABEL,
  STEP_LABEL,
  VERDICT_LABEL,
  counterPills,
  evidenceLink,
  needsHelp,
  outcomeTone,
  stepTone,
  verdictTone,
  workerState,
  type Tone,
} from '../lib/run-live';
import { Button, Spinner } from './ui';
import { WakeGrokButton } from './WakeGrokButton';

const TONE_TEXT: Record<Tone, string> = {
  accent: 'text-[var(--color-accent)]',
  ok: 'text-[var(--color-ok)]',
  danger: 'text-[var(--color-danger)]',
  warn: 'text-[var(--color-warn)]',
  muted: 'text-[var(--color-ink-faint)]',
};

const TONE_PILL: Record<Tone, string> = {
  accent: 'border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 text-[var(--color-accent)]',
  ok: 'border-emerald-500/25 bg-emerald-500/10 text-[var(--color-ok)]',
  danger: 'border-red-500/25 bg-red-500/10 text-[var(--color-danger)]',
  warn: 'border-amber-500/25 bg-amber-500/10 text-[var(--color-warn)]',
  muted: 'border-[var(--color-line)] bg-white/[0.03] text-[var(--color-ink-muted)]',
};

/** Sonde `/live` toutes les 2,5 s tant que le run (ou un de ses workers) travaille. */
export function useRunLive(runUuid: string | null): [RunLive | null, string | null] {
  const [live, setLive] = useState<RunLive | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!runUuid) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const r = await api.runLive(runUuid);
        if (stop) return;
        setLive(r.data);
        setError(null);
        if (r.data.live) timer = setTimeout(tick, LIVE_POLL_MS);
      } catch (e) {
        if (stop) return;
        setError(String((e as Error).message || e));
        timer = setTimeout(tick, LIVE_POLL_MS * 2);
      }
    };
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [runUuid]);
  return [live, error];
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'running') return <Spinner class="h-3.5 w-3.5" />;
  const glyph = { ok: '✓', failed: '✕', missing: '?', skipped: '–', pending: '•' }[state] ?? '•';
  return (
    <span aria-hidden class={cn('inline-flex h-4 w-4 items-center justify-center text-xs font-bold', TONE_TEXT[stepTone(state)])}>
      {glyph}
    </span>
  );
}

/**
 * Carte « Live » d'un run : texte d'état qui change, étapes / workers en grille,
 * pastilles compteurs, journal « Montre-moi ton travail », bouton « Réveiller le bot Grok ».
 */
export function RunLiveCard({ runUuid, compact = false }: { runUuid: string; compact?: boolean }) {
  const [live, error] = useRunLive(runUuid);
  const [journal, setJournal] = useState(false);

  if (!live) {
    return (
      <div class="flex items-center gap-2 rounded-2xl border border-[var(--color-line)] px-3 py-3 text-sm text-[var(--color-ink-muted)]">
        {error ? <span class="text-[var(--color-danger)]">{error}</span> : <><Spinner /> Chargement…</>}
      </div>
    );
  }

  const vt = verdictTone(live.verdict);
  const help = needsHelp(live);

  return (
    <section
      class={cn(
        'relative overflow-hidden rounded-2xl border bg-[var(--color-surface)] p-3 sm:p-4',
        live.live ? 'border-[var(--color-accent)]/40' : vt === 'ok' ? 'border-emerald-500/30' : vt === 'danger' ? 'border-red-500/30' : 'border-amber-500/30',
      )}
      aria-live="polite"
      data-testid="run-live-card"
    >
      {live.live && (
        <span
          aria-hidden
          class="pointer-events-none absolute inset-x-0 top-0 h-0.5 animate-pulse bg-gradient-to-r from-transparent via-[var(--color-accent)] to-transparent"
        />
      )}
      <div class="flex items-start gap-2">
        <span class="mt-1 flex h-2.5 w-2.5 shrink-0">
          <span class={cn('h-2.5 w-2.5 rounded-full', live.live ? 'animate-pulse bg-[var(--color-accent)]' : vt === 'ok' ? 'bg-[var(--color-ok)]' : vt === 'danger' ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-warn)]')} />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-x-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
            <span>{live.live ? 'Analyse en direct' : VERDICT_LABEL[live.verdict] || live.verdict}</span>
            {live.playbook && <span class="font-mono normal-case tracking-normal text-[var(--color-ink-muted)]">{live.playbook.slash}</span>}
          </div>
          <p
            key={live.status_text}
            class="df-status-in mt-0.5 break-words text-sm font-medium text-[var(--color-ink)]"
          >
            {live.status_text}
          </p>
        </div>
      </div>

      <div class="mt-3 flex flex-wrap gap-1.5">
        {counterPills(live).map((p) => (
          <span key={p.key} class={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium', TONE_PILL[p.tone])}>
            {p.label}
          </span>
        ))}
      </div>

      {live.steps.length > 0 && (
        <ol class="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          {live.steps.map((s) => (
            <li
              key={s.n}
              class={cn(
                'flex min-h-[44px] items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs',
                s.state === 'running' ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5' : 'border-[var(--color-line)]',
              )}
            >
              <StepIcon state={s.state} />
              <span class="min-w-0 flex-1 leading-snug text-[var(--color-ink)]">{s.label}</span>
              <span class={cn('shrink-0 text-[10px]', TONE_TEXT[stepTone(s.state)])}>{STEP_LABEL[s.state]}</span>
            </li>
          ))}
        </ol>
      )}

      {live.workers.length > 0 && (
        <ul class="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {live.workers.map((w) => {
            const st = workerState(w.status);
            return (
              <li key={w.run_uuid} class="flex min-h-[44px] items-center gap-2 rounded-xl border border-[var(--color-line)] px-2 py-1.5 text-xs" title={w.error || w.summary || ''}>
                <StepIcon state={st} />
                <span class="min-w-0 flex-1 truncate text-[var(--color-ink)]">{w.title || w.agent_name || 'Worker'}</span>
              </li>
            );
          })}
        </ul>
      )}

      {live.playbook && !compact && (
        <p class="mt-3 rounded-xl border border-[var(--color-line)] bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-[var(--color-ink-muted)]">
          <span class="font-medium text-[var(--color-ink)]">Règle :</span> {live.playbook.rule}
        </p>
      )}

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={journal}
          onClick={() => setJournal((v) => !v)}
        >
          Montre-moi ton travail ({live.decisions.length})
        </Button>
        <WakeGrokButton projectUuid={live.project_uuid} runUuid={live.run_uuid} variant={help ? 'primary' : 'ghost'} />
      </div>

      {journal && (
        <div class="mt-3 space-y-1.5">
          {live.decisions.length === 0 ? (
            <p class="text-xs text-[var(--color-ink-muted)]">Aucune décision notée pour l'instant.</p>
          ) : (
            live.decisions.map((d, i) => {
              const link = evidenceLink(d.evidence);
              return (
                <div key={i} class="rounded-xl border border-[var(--color-line)] px-2.5 py-2 text-xs">
                  <div class="flex items-start gap-2">
                    <span class={cn('shrink-0 font-semibold', TONE_TEXT[outcomeTone(d.outcome)])}>{OUTCOME_LABEL[d.outcome] || d.outcome}</span>
                    <span class="min-w-0 flex-1 font-medium text-[var(--color-ink)]">
                      {d.step ? `Étape ${d.step} · ` : ''}
                      {d.what}
                    </span>
                  </div>
                  <p class="mt-0.5 text-[var(--color-ink-muted)]">{d.why}</p>
                  <p class="mt-0.5 truncate font-mono text-[11px]">
                    {link ? (
                      <a
                        class="text-[var(--color-accent)] underline"
                        href={link.href}
                        {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                      >
                        {d.evidence}
                      </a>
                    ) : (
                      <span class="text-[var(--color-ink)]">{d.evidence}</span>
                    )}
                  </p>
                </div>
              );
            })
          )}
        </div>
      )}
    </section>
  );
}
