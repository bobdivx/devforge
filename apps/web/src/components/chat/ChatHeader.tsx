import { Share2 } from 'lucide-preact';
import { Alert, Badge, Button, Spinner } from '../ui';
import type { ChatPersona } from './types';

type Props = {
  persona?: ChatPersona;
  title: string;
  blurb?: string;
  isCoordinator: boolean;
  isSubagent: boolean;
  /** Persona : badge « Au travail… » quand le fil travaille sans flux suivi ici. */
  working: boolean;
  llmReady: boolean;
  llmMode: string;
  canShare: boolean;
  sharing: boolean;
  onShare(): void;
  /** Absent en mode persona (l'effacement passe par Réglages avancés). */
  onClear?: () => void;
  canClear: boolean;
};

/** En-tête du chat : personnage (avatar, statut) ou fil (titre, badges, modèle) + partager / effacer. */
export function ChatHeader({ persona, title, blurb, isCoordinator, isSubagent, working, llmReady, llmMode, canShare, sharing, onShare, onClear, canClear }: Props) {
  return (
    <div class="flex items-center justify-between gap-2 border-b border-[var(--color-line)] px-4 py-3">
      {persona ? (
        <div class="flex min-w-0 items-center gap-3">
          {persona.avatar}
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="truncate text-[15px] font-semibold tracking-tight">{persona.name}</span>
              <span class="rounded-full border border-[var(--color-line)] bg-white/[0.04] px-2 py-0.5 text-[11px] text-[var(--color-ink-muted)]">
                {persona.title}
              </span>
              {working && <Badge tone="accent">Au travail…</Badge>}
            </div>
            <div class="mt-0.5 h-4 min-w-0" aria-live="polite">
              {persona.status || <p class="truncate text-xs leading-4 text-[var(--color-ink-faint)]">{persona.tagline}</p>}
            </div>
          </div>
        </div>
      ) : (
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="truncate font-medium tracking-tight">{title}</span>
            {isCoordinator && <Badge tone="accent">Coordinateur</Badge>}
            {isSubagent && <Badge tone="neutral">Sous-agent</Badge>}
            {llmReady ? (
              <span
                class="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-ok)]"
                title={`Modèle prêt (${llmMode})`}
                role="img"
                aria-label="Modèle prêt"
              />
            ) : (
              <Badge tone="warn">Modèle indisponible</Badge>
            )}
          </div>
          {blurb && <p class="mt-0.5 truncate text-xs text-[var(--color-ink-faint)]">{blurb}</p>}
        </div>
      )}
      <div class="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!canShare || sharing}
          onClick={onShare}
          title="Copier un lien de partage"
          aria-label="Partager la conversation"
        >
          {sharing ? <Spinner /> : <Share2 size={14} strokeWidth={2} aria-hidden />}
        </Button>
        {onClear && (
          <Button type="button" size="sm" variant="ghost" disabled={!canClear} onClick={onClear}>
            Effacer
          </Button>
        )}
      </div>
    </div>
  );
}

/** Aucun modèle prêt (ou fournisseur en erreur) : lien vers les réglages. */
export function LlmAlert({ error }: { error: string | null }) {
  return (
    <Alert tone="warn" class="m-3 mb-0">
      {error ? (
        <>
          LLM configuré mais erreur : <strong>{error}</strong> —{' '}
          <a class="underline" href="/app/settings?tab=llm">
            corrige dans Paramètres → Agents / LLM
          </a>
          .
        </>
      ) : (
        <>
          Aucun LLM prêt. Configure le tien dans{' '}
          <a class="underline" href="/app/settings?tab=llm">
            Paramètres → Agents / LLM
          </a>
          . Les agents répondront dès qu'un modèle est actif.
        </>
      )}
    </Alert>
  );
}
