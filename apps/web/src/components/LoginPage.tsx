import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { Alert, Button, Card, FadeIn, Input, Spinner } from './ui';

type Mode = 'setup' | 'login' | 'register';

export function LoginPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    api
      .bootstrap()
      .then((b) => {
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
        // API down / CORS : ne pas forcer le mode setup (faux « créer un compte »)
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

  if (checking) {
    return (
      <div class="flex min-h-screen items-center justify-center gap-3 text-sm text-[var(--color-ink-muted)]">
        <Spinner />
      </div>
    );
  }

  const title =
    mode === 'setup'
      ? 'Bienvenue sur DevForge'
      : mode === 'register'
        ? 'Créer un compte'
        : 'Connexion';
  const subtitle =
    mode === 'setup'
      ? 'Compte admin — tu configures l’instance.'
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
                    label="Nom de l’instance"
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

          {mode !== 'setup' && (
            <div class="mt-4 text-center text-sm text-[var(--color-ink-muted)]">
              {mode === 'login' ? (
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
