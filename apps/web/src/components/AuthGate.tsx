import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { api } from '../lib/api';
import type { Bootstrap } from '../lib/auth';
import { Spinner } from './ui';

type Props = {
  children: ComponentChildren;
  /** Skip redirect to onboarding (for the wizard page itself). */
  allowOnboarding?: boolean;
};

export function AuthGate({ children, allowOnboarding = false }: Props) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const b: Bootstrap = await api.bootstrap();
        if (cancelled) return;
        if (b.needs_setup) {
          window.location.replace('/login');
          return;
        }
        if (!b.authenticated) {
          window.location.replace('/login');
          return;
        }
        if (b.onboarding.required && !allowOnboarding) {
          window.location.replace('/app/onboarding');
          return;
        }
        setReady(true);
      } catch {
        if (!cancelled) window.location.replace('/login');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowOnboarding]);

  if (!ready) {
    return (
      <div class="flex min-h-screen items-center justify-center gap-3 text-sm text-[var(--color-ink-muted)]">
        <Spinner />
        Chargement…
      </div>
    );
  }

  return <>{children}</>;
}
