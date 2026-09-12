import { useState } from 'preact/hooks';
import { api } from '../lib/api';
import { Alert, Button, FadeIn, Input, useToast } from './ui';

/**
 * Builder wizard — création d'app depuis un prompt naturel.
 * Slice 1 : crée un projet vide + seed un agent avec le prompt utilisateur.
 */
export function NewBuilderWizard({
  bare = false,
  onClose,
}: {
  bare?: boolean;
  onClose?: () => void;
} = {}) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: Event) {
    e.preventDefault();
    const cleanTitle = title.trim();
    const cleanPrompt = prompt.trim();

    if (!cleanTitle) {
      setError('Le titre est requis.');
      return;
    }
    if (!cleanPrompt) {
      setError('Décris ce que tu veux construire.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const res = await api.scaffoldProject({
        title: cleanTitle,
        prompt: cleanPrompt,
      });

      toast.push({
        title: 'Projet créé',
        detail: `${cleanTitle} — l'agent va démarrer`,
        tone: 'ok',
      });

      // Redirect to workspace tab where the agent is ready
      window.location.href = `/app/projects/view?uuid=${encodeURIComponent(res.data.project.uuid)}&tab=workspace`;
    } catch (err: unknown) {
      const msg = String((err as Error).message || err);
      setError(msg);
      setBusy(false);
    }
  }

  const body = (
    <form class="space-y-4" onSubmit={submit}>
      {error && (
        <Alert tone="danger" class="mb-3">
          {error}
        </Alert>
      )}

      <Input
        label="Nom de l'application"
        placeholder="ex. Mon blog Next.js"
        value={title}
        onInput={(ev) => setTitle((ev.target as HTMLInputElement).value)}
        disabled={busy}
        hint="Court et descriptif"
        required
      />

      <label class="flex flex-col gap-1.5 text-sm">
        <span class="font-medium">Qu'est-ce que tu veux construire ?</span>
        <textarea
          class="min-h-[160px] w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-sm"
          placeholder="Décris ton app en français : stack, features, contraintes…"
          value={prompt}
          onInput={(ev) => setPrompt((ev.target as HTMLTextAreaElement).value)}
          disabled={busy}
          required
        />
        <span class="text-xs text-[var(--color-ink-faint)]">
          L'agent DevForge va scaffolder le projet et configurer le build.
        </span>
      </label>

      <div class="flex flex-wrap justify-between gap-2">
        {onClose && (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Annuler
          </Button>
        )}
        <Button type="submit" variant="secondary" size="sm" disabled={busy} class="ml-auto">
          {busy ? 'Création en cours…' : 'Créer avec un agent'}
        </Button>
      </div>
    </form>
  );

  return (
    <FadeIn>
      {bare ? (
        body
      ) : (
        <div class="rounded-2xl bg-[var(--color-card)] p-6 shadow-2xl">
          <h2 class="mb-1 text-xl font-semibold">Nouvelle app avec l'agent</h2>
          <p class="mb-4 text-sm text-[var(--color-ink-muted)]">
            Décris ce que tu veux, DevForge scaffold le projet.
          </p>
          {body}
        </div>
      )}
    </FadeIn>
  );
}
