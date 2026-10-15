import { useEffect, useState } from 'preact/hooks';
import { api, type PreviewsResponse } from '../lib/api';

export type PreviewsClient = {
  projectPreviews: (uuid: string) => Promise<PreviewsResponse>;
  setProjectPreviews: (uuid: string, enabled: boolean) => Promise<{ ok: boolean; enabled: boolean }>;
  redeployPreview: (uuid: string, pr: number) => Promise<{ ok: boolean }>;
  deletePreview: (uuid: string, pr: number) => Promise<{ ok: boolean }>;
};

const LABELS: Record<string, string> = {
  queued: 'En file',
  building: 'Build en cours',
  ready: 'Prête',
  failed: 'Échec',
  cancelled: 'Annulée',
  deleted: 'Supprimée',
};

export function previewStatusLabel(s: string): string {
  return LABELS[s] ?? s;
}

/** Onglet « Previews » : une instance par pull request (GitHub App). */
export function ProjectPreviewsPanel({ uuid, client = api as PreviewsClient }: { uuid: string; client?: PreviewsClient }) {
  const [data, setData] = useState<PreviewsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setData(await client.projectPreviews(uuid));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    void load();
  }, [uuid]);

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await f();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (err && !data) return <p class="text-sm text-red-600">{err}</p>;
  if (!data) return <p class="text-sm text-gray-500">Chargement…</p>;

  return (
    <div class="space-y-4">
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={data.enabled}
          disabled={busy}
          onChange={(e) => run(() => client.setProjectPreviews(uuid, (e.target as HTMLInputElement).checked))}
        />
        Créer une preview pour chaque pull request
      </label>
      {!data.linked && (
        <p class="text-sm text-amber-700">
          Ce projet n’est pas encore relié à l’app GitHub DevForge : les previews démarreront après la migration (Réglages
          &gt; GitHub).
        </p>
      )}
      <p class="text-xs text-gray-500">
        Les PR de forks ne sont jamais déployées. Seules les variables marquées « preview » sont injectées.
      </p>
      {err && <p class="text-sm text-red-600">{err}</p>}
      {data.previews.length === 0 ? (
        <p class="text-sm text-gray-500">Aucune preview pour l’instant.</p>
      ) : (
        <ul class="divide-y rounded border">
          {data.previews.map((p) => (
            <li key={p.pr_number} class="flex flex-wrap items-center gap-3 p-3 text-sm">
              <span class="font-medium">PR #{p.pr_number}</span>
              <span>{previewStatusLabel(p.status)}</span>
              <code class="text-xs">{p.head_sha.slice(0, 7)}</code>
              {p.url && p.status !== 'deleted' && (
                <a href={p.url} target="_blank" rel="noreferrer" class="text-blue-600 underline">
                  {p.url}
                </a>
              )}
              <span class="ml-auto flex gap-2">
                <button type="button" disabled={busy} onClick={() => run(() => client.redeployPreview(uuid, p.pr_number))}>
                  Redéployer
                </button>
                {p.status !== 'deleted' && (
                  <button type="button" disabled={busy} onClick={() => run(() => client.deletePreview(uuid, p.pr_number))}>
                    Supprimer
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
