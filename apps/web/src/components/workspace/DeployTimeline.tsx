import { useState } from 'preact/hooks';
import { CheckCircle2, Circle, AlertCircle, Loader2, ChevronDown, ChevronRight, Terminal } from 'lucide-preact';
import { cn } from '../../lib/cn';
import { parseDeployTimeline } from '../../lib/deploy-timeline';
import { ficheForDeployStep, type Fiche } from '../../lib/fiches';

type Props = {
  logs: string | null | undefined;
  status: string;
  className?: string;
};

function FichePanel({ fiche }: { fiche: Fiche }) {
  return (
    <div
      class="df-fiche-in mt-2.5 rounded-lg border border-rose-500/25 bg-black/40 px-3 py-2.5"
      data-df-fiche={fiche.id}
    >
      <p class="text-[11px] font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">Cas</p>
      <p class="mt-1 text-sm text-[var(--color-ink)]">{fiche.cas}</p>
      <ul class="mt-2 space-y-1">
        {fiche.gestes.map((g) => (
          <li key={g} class="text-[12px] leading-snug text-[var(--color-ink-muted)]">
            {g}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DeployTimeline({ logs, status, className }: Props) {
  const parsed = parseDeployTimeline(logs, status);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [openFiche, setOpenFiche] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedStep((prev) => (prev === id ? null : id));
  };

  return (
    <div class={cn('space-y-3', className)}>
      <div class="relative pl-6 space-y-4 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-[var(--color-line)]">
        {parsed.steps.map((step) => {
          const isExpanded = expandedStep === step.id;
          const hasLogs = step.logs.length > 0;
          const fiche = step.state === 'failed' ? ficheForDeployStep(step.id) : null;
          const ficheOpen = fiche && openFiche === step.id;

          return (
            <div key={step.id} class="relative group">
              {/* Point de jalon */}
              <div
                class={cn(
                  'absolute -left-6 top-0.5 flex h-6 w-6 items-center justify-center rounded-full border bg-[var(--color-surface)] transition-all',
                  step.state === 'success' && 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10',
                  step.state === 'running' && 'border-blue-500 text-blue-400 animate-pulse bg-blue-500/10 shadow-[0_0_12px_rgba(59,130,246,0.3)]',
                  step.state === 'failed' && 'border-rose-500/30 text-rose-400 bg-rose-500/10',
                  step.state === 'pending' && 'border-[var(--color-line)] text-[var(--color-ink-muted)] opacity-60'
                )}
              >
                {step.state === 'success' && <CheckCircle2 size={13} strokeWidth={2.5} />}
                {step.state === 'running' && <Loader2 size={13} class="animate-spin" />}
                {step.state === 'failed' && <AlertCircle size={13} strokeWidth={2.5} />}
                {step.state === 'pending' && <Circle size={8} />}
              </div>

              {/* Contenu étape */}
              <div
                class={cn(
                  'rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 transition-colors',
                  step.state === 'running' && 'border-blue-500/40 bg-blue-500/[0.02]',
                  step.state === 'failed' && 'border-rose-500/40 bg-rose-500/[0.02]',
                  (hasLogs || fiche) && 'cursor-pointer hover:border-[var(--color-line-strong)]'
                )}
                onClick={() => {
                  if (fiche) setOpenFiche((prev) => (prev === step.id ? null : step.id));
                  else if (hasLogs) toggleExpand(step.id);
                }}
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-xs font-medium text-[var(--color-ink)]">{step.label}</span>
                      {step.state === 'running' && (
                        <span class="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-400">
                          en cours
                        </span>
                      )}
                      {fiche && (
                        <span class="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium text-rose-300">
                          {ficheOpen ? 'Fermer la fiche' : 'Ouvrir la fiche'}
                        </span>
                      )}
                    </div>
                    <p class="mt-0.5 text-[11px] text-[var(--color-ink-muted)]">{step.description}</p>
                  </div>

                  {hasLogs && (
                    <button
                      type="button"
                      class="flex items-center gap-1 text-[11px] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                      aria-label="Afficher les logs de cette étape"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(step.id);
                      }}
                    >
                      <Terminal size={12} />
                      <span>{step.logs.length}</span>
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  )}
                </div>

                {ficheOpen && fiche ? <FichePanel fiche={fiche} /> : null}

                {isExpanded && hasLogs && (
                  <div class="mt-2.5 rounded-lg border border-[var(--color-line)] bg-black/60 p-2 text-[11px] font-mono text-[var(--color-ink-muted)] overflow-x-auto max-h-48 whitespace-pre-wrap select-text">
                    {step.logs.join('\n')}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
