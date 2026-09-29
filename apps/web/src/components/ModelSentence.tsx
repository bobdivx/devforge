import { cn } from '../lib/cn';

/** Une phrase, sur l’écran qui exécute le modèle. */
export function ModelSentence({ class: className }: { class?: string }) {
  return (
    <p
      class={cn('text-sm leading-relaxed text-[var(--color-ink-muted)]', className)}
      data-df-model
    >
      Le dépôt alimente le build, le build tourne sur un nœud, le domaine pointe vers le conteneur.
    </p>
  );
}
