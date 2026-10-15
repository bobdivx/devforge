import { GithubMigrationPanel } from './GithubMigrationPanel';
import { useEffect, useState } from 'preact/hooks';
import { api, type GithubAppManifest, type GithubAppStatus } from '../lib/api';
import { Alert, Badge, Button, Card, CardHeader, Input } from './ui';

export type GithubAppClient = Pick<typeof api, 'githubAppStatus' | 'githubAppManifest' | 'githubAppForget'>;

const ERRORS: Record<string, string> = {
  conversion: 'GitHub a refusé la création de l’app (lien expiré ?). Relance la création.',
  stockage: 'L’app a été créée sur GitHub mais n’a pas pu être enregistrée. Relance la création.',
  app: 'Aucune app GitHub DevForge n’est configurée sur cette instance.',
  installation: 'Installation non vérifiée auprès de GitHub. Réessaie depuis « Installer ».',
};

/** Soumet le manifest à GitHub via un formulaire POST caché (méthode exigée par GitHub). */
export function submitManifestForm(m: GithubAppManifest, doc: Document = document): HTMLFormElement {
  const form = doc.createElement('form');
  form.method = 'post';
  form.action = m.post_url;
  form.style.display = 'none';
  const input = doc.createElement('input');
  input.type = 'hidden';
  input.name = 'manifest';
  input.value = JSON.stringify(m.manifest);
  form.appendChild(input);
  doc.body.appendChild(form);
  form.submit();
  return form;
}

export function GithubAppSettingsPanel({
  client = api,
  submit = submitManifestForm,
}: {
  client?: GithubAppClient;
  submit?: (m: GithubAppManifest) => void;
}) {
  const [status, setStatus] = useState<GithubAppStatus | null>(null);
  const [org, setOrg] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    try {
      setStatus(await client.githubAppStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const err = q.get('error');
    if (err) setError(ERRORS[err] ?? 'Erreur GitHub App.');
    if (q.get('installed') === '1') setNotice('Installation GitHub enregistrée.');
    void load();
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const m = await client.githubAppManifest(org.trim() ? { org: org.trim() } : {});
      submit(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function forget() {
    if (!window.confirm('Oublier l’app GitHub sur DevForge ? Elle restera à supprimer côté GitHub.')) return;
    setBusy(true);
    try {
      const r = await client.githubAppForget();
      setNotice(
        r.manage_url ? `App oubliée localement. Supprime-la aussi sur GitHub : ${r.manage_url}` : 'App oubliée.',
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const missing = (status?.installations ?? []).flatMap((i) => i.missing_permissions);

  return (
    <Card>
      <CardHeader
        title="GitHub App DevForge"
        description="Connexion GitHub sans token personnel : création de l’app en 1 clic, puis installation sur tes dépôts."
        action={
          status?.configured ? <Badge tone="ok">app créée</Badge> : <Badge tone="neutral">non configurée</Badge>
        }
      />
      {error && (
        <Alert tone="danger" class="mb-3">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert tone="ok" class="mb-3">
          {notice}
        </Alert>
      )}
      {status && !status.configured && (
        <div class="space-y-3">
          <Input
            label="Organisation (optionnel)"
            hint="Vide = ton compte personnel."
            placeholder="mon-organisation"
            value={org}
            onInput={(e) => setOrg((e.target as HTMLInputElement).value)}
          />
          <Button size="sm" disabled={busy} onClick={create}>
            {busy ? 'Redirection vers GitHub…' : 'Créer l’app GitHub DevForge'}
          </Button>
        </div>
      )}
      {status?.configured && (
        <div class="space-y-3">
          <p class="text-sm">
            <a class="underline" href={status.html_url} target="_blank" rel="noreferrer">
              {status.slug}
            </a>{' '}
            <span class="text-[var(--color-ink-muted)]">· @{status.owner_login}</span>
          </p>
          {status.settings_url && (
            <div class="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-line)] p-3 text-sm" data-testid="logo-step">
              <img src="/brand/icon-512.png" alt="" width={32} height={32} class="rounded" />
              <span class="flex-1">
                <span class="font-medium">Ajouter le logo</span>
                <span class="block text-xs text-[var(--color-ink-muted)]">GitHub ne permet pas de le définir automatiquement.</span>
              </span>
              <a
                href="/brand/icon-512.png"
                download="devforge-logo.png"
                class="rounded-lg border border-[var(--color-line)] px-2.5 py-1 text-xs font-medium hover:bg-white/5"
              >
                Télécharger le logo
              </a>
              <Button size="sm" variant="ghost" href={status.settings_url} target="_blank">
                Ouvrir les réglages GitHub
              </Button>
            </div>
          )}
          {missing.length > 0 && (
            <Alert tone="warn">Permissions manquantes à accepter sur GitHub : {[...new Set(missing)].join(', ')}</Alert>
          )}
          {status.installations.length === 0 ? (
            <p class="text-sm text-[var(--color-ink-muted)]">Aucune installation pour l’instant.</p>
          ) : (
            <ul class="space-y-1 text-sm" data-testid="installations">
              {status.installations.map((i) => (
                <li key={i.installation_id}>
                  @{i.account_login} — {i.repository_selection === 'all' ? 'tous les dépôts' : `${i.repositories} dépôt(s)`}
                  {i.suspended && <Badge tone="warn" class="ml-2">suspendue</Badge>}
                </li>
              ))}
            </ul>
          )}
          <div class="flex flex-wrap gap-2">
            {status.install_url && (
              <Button size="sm" href={status.install_url}>
                {status.installations.length ? 'Installer sur un autre compte' : 'Installer'}
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={busy} onClick={forget}>
              Oublier l’app
            </Button>
          </div>
          {status.installations.length > 0 && (
            <GithubMigrationPanel
              patRemovable={status.pat_removable}
              onPatCleared={() => void load()}
            />
          )}
        </div>
      )}
    </Card>
  );
}
