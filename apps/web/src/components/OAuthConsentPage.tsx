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
  /** Retour vers une app native : lien de secours si le navigateur ne suit pas le schéma. */
  const [appLink, setAppLink] = useState<string | null>(null);
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
      if (!/^https?:/i.test(r.redirect_to)) setAppLink(r.redirect_to);
      window.location.href = r.redirect_to;
    } catch (e) {
      setError(String((e as Error).message || e));
      setBusy(false);
    }
  }

  const appName = req?.client_name || 'Cette application';
  const wantsApi = (req?.scope || '').split(/\s+/).includes('api');

  return (
    <div class="flex min-h-screen items-center justify-center px-4 py-12">
      <FadeIn class="w-full max-w-md">
        <Card class="shadow-[0_24px_80px_rgb(0_0_0/0.35)]">
          {error ? (
            <Alert tone="danger">{error}</Alert>
          ) : appLink ? (
            <div class="space-y-4 py-2 text-center">
              <p class="text-sm text-[var(--color-ink-muted)]">
                C’est autorisé. Retourne dans l’application pour continuer.
              </p>
              <a
                href={appLink}
                class="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--color-accent)] px-5 text-sm font-semibold text-zinc-950"
              >
                Ouvrir l’application
              </a>
            </div>
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
                {wantsApi && (
                  <li>
                    • Piloter DevForge depuis cette application comme sur le web : tes apps, la
                    discussion avec Braise, les mises en ligne et les alertes.
                  </li>
                )}
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
