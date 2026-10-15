import { useState } from 'preact/hooks';
import { api, type GithubMigrationReport } from '../lib/api';

export type MigrationClient = Pick<typeof api, 'githubAppMigrate' | 'githubDisconnect'>;

const LABEL: Record<string, string> = {
  covered: 'couvert',
  not_covered: 'non couvert : installe l’app sur ce dépôt',
  linked: 'déjà relié',
  not_github: 'hors GitHub',
};

/** Assistant de migration PAT + webhook par dépôt → app GitHub (dry-run d'abord). */
export function GithubMigrationPanel({
  client = api,
  patRemovable = false,
  confirmFn = (m: string) => window.confirm(m),
  onPatCleared,
}: {
  client?: MigrationClient;
  patRemovable?: boolean;
  confirmFn?: (m: string) => boolean;
  onPatCleared?: () => void;
}) {
  const [report, setReport] = useState<GithubMigrationReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [patGone, setPatGone] = useState(false);

  async function run(dryRun: boolean) {
    if (!dryRun && !confirmFn('Relier les projets couverts à l’app et supprimer leurs webhooks par dépôt ?')) return;
    setBusy(true);
    setError(null);
    try {
      setReport(await client.githubAppMigrate({ dry_run: dryRun }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function clearPat() {
    if (
      !confirmFn(
        'Supprimer le jeton GitHub personnel ? L’app GitHub suffit pour les déploiements. Tu pourras coller un jeton plus tard si besoin.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await client.githubDisconnect();
      setPatGone(true);
      onPatCleared?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const covered = report?.projects.filter((p) => p.status === 'covered').length ?? 0;
  const showPatBanner = patRemovable && !patGone;
  return (
    <div class="space-y-2 text-sm" data-testid="migration">
      <p class="font-medium">Migration des projets</p>
      {showPatBanner && (
        <div role="status" class="space-y-2 rounded border border-emerald-400 p-2">
          <p>Tous les projets sont migrés : le jeton GitHub personnel n’est plus nécessaire.</p>
          <button type="button" disabled={busy} onClick={() => void clearPat()}>
            Supprimer le jeton
          </button>
        </div>
      )}
      {patGone && (
        <p role="status" class="rounded border border-emerald-400 p-2">
          Jeton personnel supprimé. Prochaine version : `DEVFORGE_LEGACY_WEBHOOK=0` pour couper l’ancien endpoint.
        </p>
      )}
      <div class="flex gap-2">
        <button type="button" disabled={busy} onClick={() => run(true)}>
          Analyser (sans rien modifier)
        </button>
        {report?.dry_run && covered > 0 && (
          <button type="button" disabled={busy} onClick={() => run(false)}>
            Migrer {covered} projet(s)
          </button>
        )}
      </div>
      {error && <p class="text-red-600">{error}</p>}
      {report && (
        <ul class="space-y-1">
          {report.projects.map((p) => (
            <li key={p.project_uuid}>
              {p.name} — {p.migrated ? 'migré' : LABEL[p.status] ?? p.status}
              {p.repo ? ` (${p.repo})` : ''}
              {p.hook_error ? ` · webhook : ${p.hook_error}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
