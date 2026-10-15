import { useState } from 'preact/hooks';
import { api, type GithubMigrationReport } from '../lib/api';

export type MigrationClient = Pick<typeof api, 'githubAppMigrate'>;

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
}: {
  client?: MigrationClient;
  patRemovable?: boolean;
  confirmFn?: (m: string) => boolean;
}) {
  const [report, setReport] = useState<GithubMigrationReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const covered = report?.projects.filter((p) => p.status === 'covered').length ?? 0;
  return (
    <div class="space-y-2 text-sm" data-testid="migration">
      <p class="font-medium">Migration des projets</p>
      {patRemovable && (
        <p role="status" class="rounded border border-emerald-400 p-2">
          Tous les projets sont migrés : tu peux supprimer le jeton GitHub personnel des réglages.
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
