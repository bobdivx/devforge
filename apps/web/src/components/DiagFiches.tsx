import { useState } from 'preact/hooks';
import { constatsFromDiagnostic, type Fiche } from '../lib/fiches';

function FicheBody({ fiche }: { fiche: Fiche }) {
  return (
    <div class="df-fiche-in mt-2 rounded-xl border border-[var(--color-line)] bg-black/30 px-3 py-2.5" data-df-fiche={fiche.id}>
      <p class="text-[11px] font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">Cas</p>
      <p class="mt-1 text-sm text-[var(--color-ink)]">{fiche.cas}</p>
      <ul class="mt-2 space-y-1">
        {fiche.gestes.map((g) => (
          <li key={g} class="text-sm leading-snug text-[var(--color-ink-muted)]">
            {g}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Constats de la capture diagnostic : chaque ligne ouvre sa fiche. */
export function DiagFiches({ text }: { text: string }) {
  const constats = constatsFromDiagnostic(text);
  const [open, setOpen] = useState<string | null>(null);

  if (!text.trim()) return null;

  return (
    <div class="space-y-2" data-df-diag>
      {constats.length === 0 ? (
        <p class="text-sm text-[var(--color-ink-muted)]">Rien à signaler dans cette capture.</p>
      ) : (
        constats.map((c) => {
          const on = open === c.id;
          return (
            <div key={c.id}>
              <button
                type="button"
                class="flex w-full items-center justify-between gap-2 rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-left text-sm text-[var(--color-ink)] hover:border-rose-500/50"
                aria-expanded={on}
                onClick={() => setOpen(on ? null : c.id)}
              >
                <span>{c.label}</span>
                <span class="text-[11px] text-[var(--color-ink-muted)]">{on ? 'Fermer' : 'Fiche'}</span>
              </button>
              {on ? <FicheBody fiche={c.fiche} /> : null}
            </div>
          );
        })
      )}
    </div>
  );
}
