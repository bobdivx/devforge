import { useEffect } from 'preact/hooks';
import { AppShell } from './AppShell';
import { Skeleton } from './ui';

/** Ancienne page. Les sauvegardes de l’instance sont dans Admin. */
export function StoragePage() {
  useEffect(() => {
    window.location.replace('/app/admin?tab=backup');
  }, []);

  return (
    <AppShell active="admin" title="Sauvegardes">
      <Skeleton class="h-32" />
    </AppShell>
  );
}
