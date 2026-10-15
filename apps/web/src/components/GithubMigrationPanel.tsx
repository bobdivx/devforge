import { useState } from 'preact/hooks';
import { api, type GithubMigrationReport } from '../lib/api';

export type MigrationClient = Pick<typeof api, 'githubAppMigrate' | 'githubAppRetireLegacy'>;

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
  const [legacyRetired, setLegacyRetired] = useState(false);

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

  async function retireLegacy() {
    if (
      !confirmFn(
        'Retirer le jeton personnel et couper l’ancien webhook par dépôt ? L’app GitHub suffit. Annulable via un rollback de projet.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await client.githubAppRetireLegacy();
      setLegacyRetired(true);
      onPatCleared?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const covered = report?.projects.filter((p) => p.status === 'covered').length ?? 0;
  const showPatBanner = patRemovable && !legacyRetired;
  return (
    <div class="space-y-2 text-sm" data-testid="migration">
      <p class="font-medium">Migration des projets</p>
      {showPatBanner && (
        <div role="status" class="space-y-2 rounded border border-emerald-400 p-2">
          <p>
            Tous les projets sont migrés : tu peux retirer le jeton personnel et couper l’ancien
            webhook (réglage admin, pas de variable d’environnement).
          </p>
          <button type="button" disabled={busy} onClick={() => void retireLegacy()}>
            Retirer le legacy
          </button>
        </div>
      )}
      {legacyRetired && (
        <p role="status" class="rounded border border-emerald-400 p-2">
          Legacy retiré : jeton effacé, ancien webhook coupé (410).
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
