import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { AppShell } from './AppShell';
import {
  Badge,
  Card,
  CardHeader,
  FadeIn,
  HubGrid,
  HubIcon,
  HubTile,
  Skeleton,
} from './ui';

type Tab = 'hub' | 'profil';

function readTab(): Tab {
  if (typeof window === 'undefined') return 'hub';
  const t = new URLSearchParams(window.location.search).get('tab');
  return t === 'profil' ? 'profil' : 'hub';
}

export function TeamPage() {
  const [tab, setTab] = useState<Tab>('hub');
  const [name, setName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setTab(readTab());
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

  if (tab === 'profil') {
    return (
      <AppShell
        active="team"
        title={
          <div class="flex items-center gap-3">
            <a
              href="/app/team"
              class="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-[var(--color-ink-muted)] transition hover:border-white/30 hover:bg-white/5 hover:text-white"
              aria-label="Retour au Compte"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M19 12H5M12 19l-7-7 7-7" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </a>
            <span>Profil</span>
          </div>
        }
      >
        <FadeIn>
          <Card>
            <CardHeader title="Ton workspace" />
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

  return (
    <AppShell active="team" title="Compte">
      {loading ? (
        <HubGrid>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} class="aspect-square rounded-2xl" />
          ))}
        </HubGrid>
      ) : (
        <HubGrid>
          <HubTile
            index={0}
            href="/app/team?tab=profil"
            title="Profil"
            description="Identité, workspace et forfait"
            icon={<HubIcon name="user" />}
          />
          <HubTile
            index={1}
            href="/app/tokens"
            title="Tokens"
            description="Clés API et accès MCP"
            icon={<HubIcon name="key" />}
          />
          {isAdmin && (
            <HubTile
              index={2}
              href="/app/admin"
              title="Admin"
              description="Clients, forfaits et config d’instance"
              icon={<HubIcon name="users" />}
            />
          )}
          <HubTile
            index={isAdmin ? 3 : 2}
            href="/app/settings"
            title="Paramètres"
            description="Domaine, GitHub, LLM, sauvegardes…"
            icon={<HubIcon name="settings" />}
          />
        </HubGrid>
      )}
    </AppShell>
  );
}
