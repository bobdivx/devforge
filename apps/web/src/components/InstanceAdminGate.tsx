import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { AppShell } from './AppShell';
import { Alert, Skeleton } from './ui';

type Props = {
  active: string;
  title: string;
  children: ComponentChildren;
};

/** Bloque une page d’infra tant que le rôle n’est pas `instance_admin`. */
export function InstanceAdminGate({ active, title, children }: Props) {
  const [state, setState] = useState<'loading' | 'ok' | 'deny'>('loading');

  useEffect(() => {
    let cancelled = false;
    api
      .bootstrap()
      .then((b) => {
        if (cancelled) return;
        setState(b.user?.role === 'instance_admin' ? 'ok' : 'deny');
      })
      .catch(() => {
        if (!cancelled) setState('deny');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'loading') {
    return (
      <AppShell active={active} title={title}>
        <Skeleton class="h-32 rounded-2xl" />
      </AppShell>
    );
  }

  if (state === 'deny') {
    return (
      <AppShell active={active} title={title}>
        <Alert tone="warn">Réservé à l’admin instance.</Alert>
      </AppShell>
    );
  }

  return <>{children}</>;
}
