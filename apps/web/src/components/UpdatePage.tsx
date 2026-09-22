import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { SETTINGS_NAV } from '../lib/nav';
import { AppShell } from './AppShell';
import { InstanceAdminGate } from './InstanceAdminGate';
import { UpdateSettingsPanel } from './UpdateSettingsPanel';

export function UpdatePage() {
  return (
    <InstanceAdminGate active="settings" title="Mise à jour">
      <UpdatePageInner />
    </InstanceAdminGate>
  );
}

function UpdatePageInner() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api
      .bootstrap()
      .then((b) => setIsAdmin(b.user?.role === 'instance_admin'))
      .catch(() => setIsAdmin(false))
      .finally(() => setReady(true));
  }, []);

  return (
    <AppShell
      active="settings"
      title="Mise à jour"
      description="Suivi des versions DevForge et mise à jour de l’instance."
      sideNav={SETTINGS_NAV}
      sideNavLabel="Settings"
    >
      {ready ? <UpdateSettingsPanel isAdmin={isAdmin} /> : null}
    </AppShell>
  );
}
