import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { AppShell } from './AppShell';
import { LlmProvidersPanel } from './LlmProvidersPanel';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  FadeIn,
  HubGrid,
  HubIcon,
  HubTile,
  Input,
  PulseDot,
  Skeleton,
  useToast,
} from './ui';

type Health = {
  ok: boolean;
  version?: string;
  backends?: {
    executor?: string;
    github?: string;
    storage?: string;
    database?: string;
    llm?: string;
    update?: string;
    docker?: { ok?: boolean; version?: string | null; hint?: string };
  };
};

type GhUser = {
  login: string;
  name?: string | null;
  html_url?: string;
  avatar_url?: string | null;
};

type SettingsSection = 'domaine' | 'github' | 'llm';

const SECTION_KEYS: SettingsSection[] = ['domaine', 'github', 'llm'];

const ADMIN_TAB_REDIRECT: Record<string, string> = {
  general: '/app/admin?tab=sante',
  serveur: '/app/admin?tab=serveur',
  sso: '/app/admin?tab=sso',
  backup: '/app/admin?tab=backup',
  update: '/app/admin?tab=update',
  postgres: '/app/admin?tab=postgres',
};

type SettingCardMeta = {
  key: SettingsSection;
  title: string;
  description: string;
  icon: string;
};

const SETTINGS_CARDS: SettingCardMeta[] = [
  {
    key: 'domaine',
    title: 'Domaine',
    description: 'Sous-domaine utilisé par tes apps',
    icon: 'globe',
  },
  {
    key: 'github',
    title: 'GitHub',
    description: 'Connexion API GitHub (token PAT)',
    icon: 'github',
  },
  {
    key: 'llm',
    title: 'Agents / LLM',
    description: 'Providers IA (OpenAI, Anthropic, local)',
    icon: 'brain',
  },
];

function readSection(): SettingsSection | null {
  if (typeof window === 'undefined') return null;
  const t = new URLSearchParams(window.location.search).get('tab');
  if (t && SECTION_KEYS.includes(t as SettingsSection)) return t as SettingsSection;
  return null;
}

const SECTION_TITLES: Record<SettingsSection, string> = {
  domaine: 'Domaine',
  github: 'GitHub',
  llm: 'Agents / LLM',
};

function adminRedirectTarget(): string | null {
  if (typeof window === 'undefined') return null;
  const tab = new URLSearchParams(window.location.search).get('tab');
  if (!tab) return null;
  return ADMIN_TAB_REDIRECT[tab] ?? null;
}

function SettingCard({ card, index }: { card: SettingCardMeta; index: number }) {
  return (
    <HubTile
      index={index}
      href={`/app/settings?tab=${card.key}`}
      title={card.title}
      description={card.description}
      icon={<HubIcon name={card.icon} />}
    />
  );
}

export function SettingsPage() {
  return <SettingsPageInner />;
}

function SettingsPageInner() {
  const section = readSection();
  const [health, setHealth] = useState<Health | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [ghConnected, setGhConnected] = useState(false);
  const [ghMode, setGhMode] = useState('off');
  const [ghUser, setGhUser] = useState<GhUser | null>(null);
  const [ghHint, setGhHint] = useState('');
  const [token, setToken] = useState('');
  const [ghBusy, setGhBusy] = useState(false);
  const [ghError, setGhError] = useState<string | null>(null);
  const [wildcardOwn, setWildcardOwn] = useState('');
  const [wildcardFallback, setWildcardFallback] = useState('');
  const [domainBusy, setDomainBusy] = useState(false);
  const toast = useToast();

  async function loadGh() {
    try {
      const s = await api.githubStatus();
      setGhConnected(s.connected);
      setGhMode(s.mode);
      setGhUser(s.user);
      setGhHint(s.hint || '');
    } catch {
      setGhConnected(false);
      setGhMode('off');
      setGhUser(null);
    }
  }

  useEffect(() => {
    const target = adminRedirectTarget();
    if (target) window.location.replace(target);
  }, []);

  useEffect(() => {
    Promise.all([
      api
        .health()
        .then((h) => setHealth(h as Health))
        .catch(() => setHealth({ ok: false })),
      api.bootstrap().then((b) => {
        setIsAdmin(b.user?.role === 'instance_admin');
        setWildcardOwn(b.settings?.wildcard_own || '');
        setWildcardFallback(b.settings?.wildcard_fallback || b.settings?.wildcard_domain || '');
      }),
      loadGh(),
    ]);
  }, []);

  async function connectGithub(e: Event) {
    e.preventDefault();
    if (!token.trim()) return;
    setGhBusy(true);
    setGhError(null);
    try {
      const r = await api.githubConnect(token.trim());
      setToken('');
      setGhConnected(r.connected);
      setGhMode(r.mode);
      setGhUser(r.user);
      toast.push({
        title: 'GitHub connecté',
        detail: `@${r.user.login}`,
        tone: 'ok',
      });
      const h = await api.health();
      setHealth(h as Health);
    } catch (err) {
      setGhError(String((err as Error).message || err));
      toast.push({ title: 'Connexion GitHub KO', detail: String(err), tone: 'danger' });
    } finally {
      setGhBusy(false);
    }
  }

  async function disconnectGithub() {
    setGhBusy(true);
    setGhError(null);
    try {
      await api.githubDisconnect();
      setGhConnected(false);
      setGhMode('off');
      setGhUser(null);
      toast.push({ title: 'GitHub déconnecté', tone: 'info' });
      const h = await api.health();
      setHealth(h as Health);
    } catch (err) {
      setGhError(String((err as Error).message || err));
    } finally {
      setGhBusy(false);
    }
  }

  const redirecting = adminRedirectTarget();
  if (redirecting) {
    return (
      <AppShell active="settings" title="Paramètres">
        <Skeleton class="h-32" />
      </AppShell>
    );
  }

  // Grid vue si pas de section sélectionnée
  if (!section) {
    return (
      <AppShell active="settings" title="Paramètres">
        <HubGrid>
          {SETTINGS_CARDS.map((card, i) => (
            <SettingCard key={card.key} card={card} index={i} />
          ))}
        </HubGrid>
      </AppShell>
    );
  }

  // Section détail avec bouton retour
  return (
    <AppShell
      active="settings"
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
          <span class="min-w-0 truncate">{SECTION_TITLES[section]}</span>
        </div>
      }
    >
      {section === 'domaine' && (
        <FadeIn>
          <Card>
            <CardHeader
              title="Ton domaine"
              action={
                wildcardOwn ? (
                  <Badge tone="ok">{wildcardOwn}</Badge>
                ) : wildcardFallback ? (
                  <Badge tone="accent">repli {wildcardFallback}</Badge>
                ) : (
                  <Badge tone="warn">non configuré</Badge>
                )
              }
            />
            <p class="mb-3 break-words text-sm text-[var(--color-ink-muted)]">
              Tes apps reçoivent un sous-domaine{' '}
              <code class="break-all">
                nom-app.{wildcardOwn || wildcardFallback || 'ton-domaine'}
              </code>
              . Laisse vide pour utiliser le domaine de l’admin
              {wildcardFallback ? ` (${wildcardFallback})` : ''}.
            </p>
            <form
              class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end"
              onSubmit={async (e) => {
                e.preventDefault();
                const d = wildcardOwn.trim().replace(/^\.+/, '').toLowerCase();
                if (d && !d.includes('.')) {
                  toast.push({
                    title: 'Domaine invalide',
                    detail: 'Ex. jeser.app',
                    tone: 'warn',
                  });
                  return;
                }
                setDomainBusy(true);
                try {
                  const r = await api.saveMyDomain(d);
                  setWildcardOwn(r.wildcard_own);
                  setWildcardFallback(r.wildcard_fallback);
                  toast.push({
                    title: d ? 'Domaine enregistré' : 'Domaine personnel retiré',
                    detail: `Apps → *.${r.wildcard_domain || '—'}`,
                    tone: 'ok',
                  });
                } catch (err) {
                  toast.push({
                    title: 'Échec',
                    detail: String((err as Error).message || err),
                    tone: 'danger',
                  });
                } finally {
                  setDomainBusy(false);
                }
              }}
            >
              <div class="min-w-0 w-full flex-1">
                <Input
                  label="Wildcard personnel"
                  placeholder={wildcardFallback || 'jeser.app'}
                  value={wildcardOwn}
                  onInput={(e) => setWildcardOwn((e.target as HTMLInputElement).value)}
                />
              </div>
              <Button type="submit" size="sm" class="w-full sm:w-auto" disabled={domainBusy}>
                Enregistrer
              </Button>
            </form>
          </Card>
        </FadeIn>
      )}

      {section === 'github' && (
        <FadeIn>
          <Card>
            <CardHeader
              title="GitHub"
              action={
                ghConnected ? (
                  <Badge tone="ok">connecté</Badge>
                ) : (
                  <Badge tone="warn">non connecté</Badge>
                )
              }
            />
            {ghError && (
              <Alert tone="danger" class="mb-3">
                {ghError}
              </Alert>
            )}
            {ghConnected && ghUser ? (
              <div class="space-y-3">
                <div class="flex items-center gap-3">
                  {ghUser.avatar_url ? (
                    <img
                      src={ghUser.avatar_url}
                      alt=""
                      class="h-10 w-10 rounded-full border border-[var(--color-line)]"
                    />
                  ) : (
                    <PulseDot tone="ok" />
                  )}
                  <div>
                    <p class="text-sm font-medium">@{ghUser.login}</p>
                    {ghUser.name && (
                      <p class="text-xs text-[var(--color-ink-muted)]">{ghUser.name}</p>
                    )}
                  </div>
                </div>
                <div class="flex flex-wrap gap-2">
                  {ghUser.html_url && (
                    <Button href={ghUser.html_url} size="sm" variant="outline" target="_blank">
                      Profil
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={ghBusy}
                    onClick={disconnectGithub}
                  >
                    Déconnecter
                  </Button>
                </div>
                <p class="text-xs text-[var(--color-ink-faint)]">
                  Mode API : {ghMode}. Les projets peuvent importer tes repos.
                </p>
              </div>
            ) : (
              <form class="space-y-3" onSubmit={connectGithub}>
                <p class="text-sm text-[var(--color-ink-muted)]">
                  {ghHint ||
                    'Colle un Personal Access Token GitHub (scopes repo + read:org).'}
                </p>
                <Input
                  type="password"
                  placeholder="ghp_… ou github_pat_…"
                  value={token}
                  autocomplete="off"
                  onInput={(e) => setToken((e.target as HTMLInputElement).value)}
                />
                <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  <Button type="submit" size="sm" class="w-full sm:w-auto" disabled={ghBusy || !token.trim()}>
                    {ghBusy ? 'Vérification…' : 'Connecter'}
                  </Button>
                  <Button
                    href="https://github.com/settings/tokens?type=beta"
                    size="sm"
                    variant="outline"
                    class="w-full sm:w-auto"
                    target="_blank"
                  >
                    Créer un token
                  </Button>
                </div>
              </form>
            )}
          </Card>
        </FadeIn>
      )}

      {section === 'llm' && (
        <FadeIn>
          <LlmProvidersPanel
            isAdmin={isAdmin}
            activeMode={health?.backends?.llm}
            onModeChange={async () => {
              try {
                const h = await api.health();
                setHealth(h as Health);
              } catch {
                /* ignore */
              }
            }}
          />
        </FadeIn>
      )}

    </AppShell>
  );
}
