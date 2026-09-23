import { useEffect } from 'preact/hooks';
import { AppShell } from './AppShell';
import { Skeleton } from './ui';

/** Ancienne page. La mise à jour de l’instance est dans Admin. */
export function UpdatePage() {
  useEffect(() => {
    window.location.replace('/app/admin?tab=update');
  }, []);

  return (
    <AppShell active="admin" title="Mise à jour">
      <Skeleton class="h-32" />
    </AppShell>
  );
}
