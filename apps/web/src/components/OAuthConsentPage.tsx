import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { getToken, setReturnTo } from '../lib/auth';
import { Alert, Button, Card, FadeIn, Spinner } from './ui';

type ConsentRequest = Awaited<ReturnType<typeof api.oauthRequest>>;

/** Consentement OAuth : une application (ex. Grok) demande l'accès au MCP DevForge. */
export function OAuthConsentPage() {
  const [req, setReq] = useState<ConsentRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestId =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('request') || ''
      : '';

  useEffect(() => {
    if (!requestId) {
      setError('Demande d’autorisation manquante — relance la connexion depuis l’application.');
      return;
    }
    if (!getToken()) {
      setReturnTo(window.location.pathname + window.location.search);
      window.location.replace('/login');
      return;
    }
    api
      .oauthRequest(requestId)
      .then(setReq)
      .catch((e) => {
        const msg = String((e as Error).message || e);
        if (/non authentifi|unauthor/i.test(msg)) {
          setReturnTo(window.location.pathname + window.location.search);
          window.location.replace('/login');
          return;
        }
        setError(msg);
      });
  }, [requestId]);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = approve ? await api.oauthApprove(requestId) : await api.oauthDeny(requestId);
      window.location.href = r.redirect_to;
    } catch (e) {
      setError(String((e as Error).message || e));
      setBusy(false);
    }
  }

  const appName = req?.client_name || 'Cette application';

  return (
    <div class="flex min-h-screen items-center justify-center px-4 py-12">
      <FadeIn class="w-full max-w-md">
        <Card class="shadow-[0_24px_80px_rgb(0_0_0/0.35)]">
          {error ? (
            <Alert tone="danger">{error}</Alert>
          ) : !req ? (
            <div class="flex items-center justify-center gap-3 py-6 text-sm text-[var(--color-ink-muted)]">
              <Spinner />
              Chargement…
            </div>
          ) : (
            <div class="space-y-5">
              <div class="text-center">
                <h1 class="text-xl font-semibold tracking-tight">
                  Autoriser {appName} à accéder à DevForge ?
                </h1>
                <p class="mt-2 text-sm text-[var(--color-ink-muted)]">
                  Connecté en tant que <strong>{req.user.name || req.user.email}</strong>
                  {req.user.name ? ` (${req.user.email})` : ''}.
                </p>
              </div>
              <ul class="space-y-2 text-sm text-[var(--color-ink-muted)]">
                <li>• Lister et inspecter tes projets, déploiements et logs.</li>
                <li>• Utiliser les outils DevForge (fichiers, déploiements, santé des apps).</li>
                <li>• Accès révocable à tout moment dans Compte → Tokens.</li>
              </ul>
              {req.redirect_host && (
                <p class="text-xs text-[var(--color-ink-faint)]">
                  Retour vers <span class="font-mono">{req.redirect_host}</span>
                </p>
              )}
              <div class="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  class="flex-1"
                  disabled={busy}
                  onClick={() => void decide(false)}
                >
                  Refuser
                </Button>
                <Button
                  type="button"
                  class="flex-1"
                  disabled={busy}
                  onClick={() => void decide(true)}
                >
                  {busy ? '…' : 'Autoriser'}
                </Button>
              </div>
            </div>
          )}
        </Card>
      </FadeIn>
    </div>
  );
}
