import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { Alert, Badge, Button, Card, CardHeader, useToast } from './ui';

type OidcStatus = {
  provider: string;
  has_dedicated_client: boolean;
  client_id?: string | null;
  ready_to_provision?: boolean;
  message?: string;
};

export function ProjectOidcPanel({ projectUuid }: { projectUuid: string }) {
  const toast = useToast();
  const [status, setStatus] = useState<OidcStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    api
      .projectOidc(projectUuid)
      .then((r) => setStatus(r))
      .catch((err) => setError(String(err)));
  }

  useEffect(() => {
    load();
  }, [projectUuid]);

  async function provision() {
    setBusy(true);
    try {
      const r = await api.provisionProjectOidc(projectUuid);
      toast.push({ title: 'Pocket ID prêt', detail: r.client_id, tone: 'ok' });
      load();
    } catch (err) {
      toast.push({ title: 'Provision OIDC KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  const pocket = status?.provider === 'pocket_id';
  const ready = !!status?.has_dedicated_client;

  return (
    <Card class="mt-4">
      <CardHeader
        title="Connexion Pocket ID"
        description="Les personnes qui ont un compte Pocket ID se connectent à cette app avec ce compte. Chaque projet a son propre client OIDC."
        action={
          <Badge tone={ready ? 'ok' : 'neutral'}>{ready ? 'Client actif' : 'Pas encore créé'}</Badge>
        }
      />
      {error && (
        <Alert tone="danger" class="mb-3">
          {error}
        </Alert>
      )}
      {!pocket && status && (
        <p class="text-sm text-[var(--color-ink-muted)]">
          {status.message || 'Active Pocket ID dans les réglages SSO pour ouvrir la connexion aux apps.'}
        </p>
      )}
      {pocket && (
        <div class="flex flex-col gap-3">
          {ready && status?.client_id && (
            <p class="text-sm">
              Client <code>{status.client_id}</code>. Dans l’app, le bouton « Se connecter avec Pocket ID »
              ouvre une session pour ce compte.
            </p>
          )}
          {!ready && (
            <p class="text-sm text-[var(--color-ink-muted)]">
              {status?.ready_to_provision
                ? 'Le client sera aussi créé au prochain déploiement. Tu peux le créer maintenant.'
                : 'Il faut une URL de production ou un domaine wildcard, et une clé API Pocket ID dans SSO.'}
            </p>
          )}
          <p class="text-sm text-[var(--color-ink-muted)]">
            Coche « App avec son propre login » : la barrière Traefik laisse alors arriver jusqu’au bouton Pocket ID dans l’app.
          </p>
          <div>
            <Button size="sm" disabled={busy || !status?.ready_to_provision} onClick={provision}>
              {busy ? 'Création…' : ready ? 'Mettre à jour le client' : 'Autoriser la connexion Pocket ID'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
