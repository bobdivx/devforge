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

  const isAdmin = role === 'instance_admin';

  return (
    <AppShell
      active="team"
      title={
        <div class="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <a
            href="/app/settings"
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--color-line)] text-[var(--color-ink-muted)] transition hover:border-white/30 hover:bg-white/5 hover:text-white"
            aria-label="Retour à Paramètres"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M19 12H5M12 19l-7-7 7-7" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </a>
          <span class="min-w-0 truncate">Compte</span>
        </div>
      }
    >
      <FadeIn>
        <Card>
          <CardHeader title="Profil" description="Identité du compte connecté" />
          {loading ? (
            <Skeleton class="h-20" />
          ) : (
            <dl class="space-y-3 text-sm">
              <div class="flex justify-between gap-4">
                <dt class="shrink-0 text-[var(--color-ink-muted)]">Nom</dt>
                <dd class="min-w-0 break-words text-right">{name || '—'}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="shrink-0 text-[var(--color-ink-muted)]">Email</dt>
                <dd class="min-w-0 break-all text-right">{email || '—'}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="shrink-0 text-[var(--color-ink-muted)]">Rôle</dt>
                <dd class="min-w-0 text-right">
                  <Badge tone={isAdmin ? 'accent' : 'neutral'}>
                    {isAdmin ? 'Admin instance' : 'Utilisateur'}
                  </Badge>
                </dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="shrink-0 text-[var(--color-ink-muted)]">Workspace</dt>
                <dd class="min-w-0 break-words text-right">{workspace || '—'}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="shrink-0 text-[var(--color-ink-muted)]">Forfait</dt>
                <dd class="min-w-0 text-right">
                  <Badge tone={plan === 'pro' ? 'accent' : 'neutral'}>{plan || 'free'}</Badge>
                </dd>
              </div>
            </dl>
          )}
        </Card>
      </FadeIn>
    </AppShell>
  );
}
