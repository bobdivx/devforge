import { useEffect, useState } from 'preact/hooks';
import { SETTINGS_NAV } from '../lib/nav';
import { AppShell } from './AppShell';
import { InstanceAdminGate } from './InstanceAdminGate';
import { BackupSettingsPanel } from './BackupSettingsPanel';
import { api } from '../lib/api';

/** Redirect legacy /app/storage → Settings Sauvegardes. */
export function StoragePage() {
  return (
    <InstanceAdminGate active="settings" title="Sauvegardes">
      <StoragePageInner />
    </InstanceAdminGate>
  );
}

function StoragePageInner() {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && !window.location.search.includes('tab=')) {
      window.history.replaceState({}, '', '/app/settings?tab=backup');
    }
    api
      .bootstrap()
      .then((b) => setIsAdmin(b.user?.role === 'instance_admin'))
      .catch(() => setIsAdmin(false));
  }, []);

  return (
    <AppShell
      active="settings"
      title="Sauvegardes"
      sideNav={SETTINGS_NAV}
      sideNavLabel="Settings"
    >
      <BackupSettingsPanel isAdmin={isAdmin} />
    </AppShell>
  );
}
