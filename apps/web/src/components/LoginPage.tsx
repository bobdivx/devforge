import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { setToken, type Bootstrap } from '../lib/auth';
import { JoinClusterForm } from './JoinClusterForm';
import { Alert, Button, Card, FadeIn, Input, Spinner } from './ui';

type Mode = 'setup' | 'login' | 'register' | 'join';

export function LoginPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);

  useEffect(() => {
    // Gestion du token SSO dans l'URL après redirection
    const params = new URLSearchParams(window.location.search);
    const ssoToken = params.get('sso_token');
    if (ssoToken) {
      setToken(ssoToken);
      // Nettoyage de l'URL
      window.history.replaceState({}, '', window.location.pathname);
      window.location.href = '/app';
      return;
    }

    api
      .bootstrap()
      .then((b) => {
        setBootstrap(b);
        if (b.cluster?.role === 'worker') {
          window.location.replace('/app/node');
          return;
        }
        if (b.authenticated && b.onboarding.required) {
          window.location.replace('/app/onboarding');
          return;
        }
        if (b.authenticated) {
          window.location.replace('/app');
          return;
        }
        if (b.needs_setup) {
          setMode('setup');
        } else if (typeof window !== 'undefined' && window.location.pathname.includes('register')) {
          setMode('register');
        } else {
          setMode('login');
        }
      })
      .catch(() => {
        setMode('login');
        setError('Serveur injoignable — vérifie que le backend tourne, puis reconnecte-toi.');
      })
      .finally(() => setChecking(false));
  }, []);

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'setup' || mode === 'register') {
        const r = await api.register({
          name,
          email,
          password,
          team_name: workspace || undefined,
        });
        window.location.href = r.onboarding?.required ? '/app/onboarding' : '/app';
      } else {
        const r = await api.login({ email, password });
        window.location.href = r.onboarding?.required ? '/app/onboarding' : '/app';
      }
    } catch (err) {
      setError(String((err as Error).message || err));
      setBusy(false);
    }
  }

  function handleSsoLogin() {
    window.location.href = '/api/v1/auth/sso/authorize';
  }

  if (checking) {
    return (
      <div class="flex min-h-screen items-center justify-center gap-3 text-sm text-[var(--color-ink-muted)]">
        <Spinner />
      </div>
    );
  }

  const ssoEnabled = bootstrap?.sso?.enabled && bootstrap?.sso?.oidc_configured;
  const hideLocalLogin = bootstrap?.sso?.hide_local_login && ssoEnabled;
  const providerLabel = bootstrap?.sso?.provider === 'pocket_id' ? 'Pocket ID' : 'SSO';

  const title =
    mode === 'setup'
      ? 'Bienvenue sur DevForge'
      : mode === 'join'
        ? 'Rejoindre un cluster'
        : mode === 'register'
        ? 'Créer un compte'
        : 'Connexion';
  const subtitle =
    mode === 'setup'
      ? "Compte admin — tu configures l'instance."
      : mode === 'join'
        ? 'Jeton d’invitation, puis l’URL du leader joignable depuis cette machine.'
        : mode === 'register'
        ? 'Ton workspace isolé, forfait free.'
        : 'Heureux de te revoir.';

  return (
    <div class="flex min-h-screen items-center justify-center px-4 py-12">
      <FadeIn class="w-full max-w-md">
        <div class="mb-8 text-center">
          <div class="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M13 2 4 14h7l-1 8 10-14h-7l1-6z" />
            </svg>
          </div>
          <h1 class="text-2xl font-semibold tracking-tight">{title}</h1>
          <p class="mt-2 text-sm text-[var(--color-ink-muted)]">{subtitle}</p>
        </div>

        <Card>
          {error && (
            <Alert tone="danger" class="mb-4">
              {error}
            </Alert>
          )}

          {ssoEnabled && mode === 'login' && (
            <div class="mb-4">
              <Button
                type="button"
                class="w-full"
                onClick={handleSsoLogin}
              >
                Continuer avec {providerLabel}
              </Button>
              {!hideLocalLogin && (
                <div class="my-4 flex items-center gap-3">
                  <div class="h-px flex-1 bg-[var(--border)]"></div>
                  <span class="text-xs text-[var(--color-ink-muted)]">ou</span>
                  <div class="h-px flex-1 bg-[var(--border)]"></div>
                </div>
              )}
            </div>
          )}

          {mode === 'setup' && (
            <div class="mb-4 grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" class="w-full" disabled>
                Créer une instance
              </Button>
              <Button
                type="button"
                variant="outline"
                class="w-full"
                onClick={() => {
                  setMode('join');
                  setError(null);
                }}
              >
                Rejoindre
              </Button>
            </div>
          )}

          {mode === 'join' ? (
            <JoinClusterForm
              busy={busy}
              submitLabel="Rejoindre le cluster"
              cancelLabel="Créer une instance à la place"
              onCancel={() => {
                setMode('setup');
                setError(null);
              }}
              onSubmit={async (body) => {
                setBusy(true);
                setError(null);
                try {
                  await api.clusterJoinLocal({
                    ...body,
                    advertise_url: window.location.origin,
                  });
                  window.location.href = '/app/node';
                } catch (err) {
                  setError(String((err as Error).message || err));
                  setBusy(false);
                }
              }}
            />
          ) : (
            !hideLocalLogin && (
            <form class="space-y-3" onSubmit={submit}>
              {(mode === 'setup' || mode === 'register') && (
                <>
                  <Input
                    label="Ton nom"
                    value={name}
                    onInput={(e) => setName((e.target as HTMLInputElement).value)}
                    required
                  />
                  {mode === 'setup' && (
                    <Input
                      label="Nom de l'instance"
                      value={workspace}
                      onInput={(e) => setWorkspace((e.target as HTMLInputElement).value)}
                      placeholder="DevForge"
                    />
                  )}
                </>
              )}
              <Input
                label="Email"
                type="email"
                value={email}
                onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
                required
              />
              <Input
                label="Mot de passe"
                type="password"
                value={password}
                onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                required
                hint={mode !== 'login' ? '8 caractères minimum' : undefined}
              />
              <Button type="submit" class="w-full" disabled={busy}>
                {busy ? <Spinner /> : null}
                {mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
              </Button>
            </form>
            )
          )}

          {mode !== 'setup' && mode !== 'join' && !hideLocalLogin && (
            <div class="mt-4 text-center text-sm text-[var(--color-ink-muted)]">
              {mode === 'login' ? (
                bootstrap?.allow_register && (
                  <button
                    type="button"
                    class="text-[var(--color-accent)] hover:underline"
                    onClick={() => {
                      setMode('register');
                      setError(null);
                    }}
                  >
                    Créer un compte
                  </button>
                )
              ) : (
                <button
                  type="button"
                  class="text-[var(--color-accent)] hover:underline"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                  }}
                >
                  Déjà un compte ? Connexion
                </button>
              )}
            </div>
          )}
        </Card>
      </FadeIn>
    </div>
  );
}
