import { useEffect, useState } from 'preact/hooks';
import { api, type AppRepo, type AppReposResponse } from '../lib/api';

export type RepoPickerClient = {
  githubAppRepositories: (p: { q?: string; refresh?: boolean }) => Promise<AppReposResponse>;
};

/** Dépôts accessibles à l'app GitHub DevForge (sans PAT). */
export function GithubRepoPicker({
  onSelect,
  selected,
  client = api as RepoPickerClient,
}: {
  onSelect: (r: AppRepo) => void;
  selected?: { installation_id: number; repo_id: number } | null;
  client?: RepoPickerClient;
}) {
  const [data, setData] = useState<AppReposResponse | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async (refresh = false) => {
    setBusy(true);
    try {
      const d = await client.githubAppRepositories({ refresh });
      setData(d);
      setErr(d.refresh_error ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load(false);
  }, []);

  if (!data) return <p class="text-sm text-gray-500">{err ?? 'Chargement des dépôts…'}</p>;

  const needle = q.trim().toLowerCase();
  const repos = data.repositories.filter((r) => !needle || r.full_name.toLowerCase().includes(needle));

  if (data.installations.length === 0) {
    return (
      <div class="space-y-2 text-sm">
        <p>L’app GitHub DevForge n’est installée sur aucun compte.</p>
        <a class="underline" href="/app/settings?tab=github">
          Installer l’app GitHub
        </a>
      </div>
    );
  }

  return (
    <div class="space-y-2">
      <div class="flex gap-2">
        <input
          class="flex-1 rounded border px-2 py-1 text-sm"
          placeholder="Rechercher un dépôt…"
          value={q}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        />
        <button type="button" disabled={busy} onClick={() => load(true)}>
          Actualiser
        </button>
      </div>
      {err && <p class="text-xs text-amber-700">{err}</p>}
      {repos.length === 0 ? (
        <p class="text-sm text-gray-500">Aucun dépôt{needle ? ' ne correspond' : ' accessible'}.</p>
      ) : (
        <ul class="max-h-64 overflow-auto rounded border">
          {repos.slice(0, 100).map((r) => (
            <li key={`${r.installation_id}-${r.repo_id}`}>
              <button
                type="button"
                aria-pressed={selected?.repo_id === r.repo_id && selected?.installation_id === r.installation_id}
                class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                onClick={() => onSelect(r)}
              >
                <span class="font-medium">{r.full_name}</span>
                {r.private && <span class="rounded bg-gray-200 px-1 text-xs">privé</span>}
                {r.default_branch && <span class="ml-auto text-xs text-gray-500">{r.default_branch}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p class="text-xs">
        {data.installations.map((i) => (
          <a key={i.installation_id} class="mr-3 underline" href={i.configure_url} target="_blank" rel="noreferrer">
            Configurer l’accès aux dépôts ({i.account_login})
          </a>
        ))}
      </p>
    </div>
  );
}
