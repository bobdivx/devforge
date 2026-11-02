import { useEffect, useState } from 'preact/hooks';
import { api, type AutonomousPublish } from '../lib/api';
import { Alert, Badge, Card, CardHeader, useToast } from './ui';

/** Date lisible (heure de Paris) d'un horodatage RFC 3339. */
export function formatEnabledAt(at?: string | null): string {
  if (!at) return '';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

/**
 * Réglage « publication autonome » d'un projet : un seul interrupteur, désactivé par défaut,
 * modifiable par un admin de l'instance. Activé, l'agent met la branche configurée en ligne
 * sans accord de 15 min ; chaque mise en ligne est inscrite dans les reçus.
 */
export function AutonomousPublishPanel({ projectUuid }: { projectUuid: string }) {
  const toast = useToast();
  const [state, setState] = useState<AutonomousPublish | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api
      .autonomousPublish(projectUuid)
      .then((r) => setState(r.data))
      .catch((err) => setError(String(err)));
  }, [projectUuid]);

  async function toggle() {
    if (!state?.can_edit) return;
    setBusy(true);
    try {
      const r = await api.setAutonomousPublish(projectUuid, !state.enabled);
      setState(r.data);
      toast.push({
        title: r.data.enabled ? 'Publication autonome activée' : 'Publication autonome désactivée',
        detail: r.message,
        tone: 'ok',
      });
    } catch (err) {
      toast.push({ title: 'Réglage non modifié', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  const enabled = !!state?.enabled;
  const who = state?.enabled_by_label?.trim();
  const when = formatEnabledAt(state?.enabled_at);

  return (
    <Card class="mt-4">
      <CardHeader
        title="Publication autonome"
        description="Laisse l’agent mettre ce projet en ligne sans te demander l’accord de 15 minutes. Seule la mise en ligne de la branche configurée est concernée : pousser sur GitHub, créer un dépôt ou modifier les variables de production restent soumis à ton accord."
        action={<Badge tone={enabled ? 'warn' : 'neutral'}>{enabled ? 'Activée' : 'Désactivée'}</Badge>}
      />
      {error && (
        <Alert tone="danger" class="mb-3">
          {error}
        </Alert>
      )}
      {state && (
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-0 space-y-1 text-xs text-[var(--color-ink-muted)]">
            <p>
              {enabled
                ? `Activée${who ? ` par ${who}` : ''}${when ? ` le ${when}` : ''}. Chaque mise en ligne de l’agent est inscrite dans les reçus (qui, quand, résultat).`
                : 'Désactivée : chaque mise en ligne de l’agent attend ton accord.'}
            </p>
            {!state.can_edit && (
              <p>Seul un admin de l’instance peut changer ce réglage, depuis l’interface.</p>
            )}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Publication autonome"
            disabled={busy || !state.can_edit}
            onClick={() => void toggle()}
            class={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-2 focus:ring-offset-[var(--color-bg)] disabled:cursor-not-allowed disabled:opacity-50 ${
              enabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-line)]'
            }`}
          >
            <span
              aria-hidden="true"
              class={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      )}
    </Card>
  );
}
