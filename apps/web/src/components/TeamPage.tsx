import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { AppShell } from './AppShell';
import { Badge, Card, CardHeader, FadeIn, Skeleton } from './ui';

export function TeamPage() {
  const [name, setName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .bootstrap()
      .then((b) => {
        setName(b.user?.name ?? null);
        setEmail(b.user?.email ?? null);
        setRole(b.user?.role ?? null);
        setWorkspace(b.team?.name ?? b.workspace?.name ?? null);
        setPlan(b.team?.plan ?? b.workspace?.plan ?? 'free');
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell active="team" title="Compte">
      <FadeIn>
        <Card>
          <CardHeader title="Ton workspace" />
          {loading ? (
            <Skeleton class="h-20" />
          ) : (
            <dl class="space-y-3 text-sm">
              <div class="flex justify-between gap-4">
                <dt class="text-[var(--color-ink-muted)]">Nom</dt>
                <dd>{name || '—'}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-[var(--color-ink-muted)]">Email</dt>
                <dd>{email || '—'}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-[var(--color-ink-muted)]">Rôle</dt>
                <dd>
                  <Badge tone={role === 'instance_admin' ? 'accent' : 'neutral'}>
                    {role === 'instance_admin' ? 'Admin instance' : 'Utilisateur'}
                  </Badge>
                </dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-[var(--color-ink-muted)]">Workspace</dt>
                <dd>{workspace || '—'}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-[var(--color-ink-muted)]">Forfait</dt>
                <dd>
                  <Badge tone={plan === 'pro' ? 'accent' : 'neutral'}>{plan || 'free'}</Badge>
                </dd>
              </div>
              {role === 'instance_admin' && (
                <div class="pt-2">
                  <a
                    href="/app/admin"
                    class="text-sm font-medium text-[var(--color-accent)] hover:underline"
                  >
                    Ouvrir le panneau Admin →
                  </a>
                </div>
              )}
            </dl>
          )}
        </Card>
      </FadeIn>
    </AppShell>
  );
}
