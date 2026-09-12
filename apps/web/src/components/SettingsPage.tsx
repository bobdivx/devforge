import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { SETTINGS_NAV } from '../lib/nav';
import { AppShell } from './AppShell';
import { BackupSettingsPanel } from './BackupSettingsPanel';
import { LlmProvidersPanel } from './LlmProvidersPanel';
import { SsoSettingsPanel } from './SsoSettingsPanel';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  FadeIn,
  Input,
  LiveStatus,
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
  };
};

type GhUser = {
  login: string;
  name?: string | null;
  html_url?: string;
  avatar_url?: string | null;
};

type SettingsSection = 'general' | 'domaine' | 'github' | 'serveur' | 'llm' | 'sso' | 'backup' | 'update';

const SECTION_KEYS: SettingsSection[] = [
  'general',
  'domaine',
  'github',
  'serveur',
  'llm',
  'sso',
  'backup',
  'update',
];

type SettingCardMeta = {
  key: SettingsSection;
  title: string;
  description: string;
  icon: string;
};

const SETTINGS_CARDS: SettingCardMeta[] = [
  {
    key: 'general',
    title: 'Général',
    description: 'État du serveur, connexions, base de données',
    icon: 'settings',
  },
  {
    key: 'domaine',
    title: 'Domaine',
    description: 'Wildcard domain pour les sous-domaines apps',
    icon: 'globe',
  },
  {
    key: 'github',
    title: 'GitHub',
    description: 'Connexion API GitHub (token PAT)',
    icon: 'github',
  },
  {
    key: 'serveur',
    title: 'Serveur',
    description: 'Docker local ou SSH distant, clés SSH',
    icon: 'server',
  },
  {
    key: 'llm',
    title: 'Agents / LLM',
    description: 'Providers IA (OpenAI, Anthropic, local)',
    icon: 'brain',
  },
  {
    key: 'sso',
    title: 'SSO / OIDC',
    description: 'Authentification unique (OIDC)',
    icon: 'shield',
  },
  {
    key: 'backup',
    title: 'Sauvegardes',
    description: 'Stratégie de backup automatique',
    icon: 'archive',
  },
  {
    key: 'update',
    title: 'Mise à jour',
    description: 'Mise à jour de DevForge vers la dernière version',
    icon: 'refresh',
  },
];

function readSection(): SettingsSection | null {
  if (typeof window === 'undefined') return null;
  const t = new URLSearchParams(window.location.search).get('tab');
  if (t && SECTION_KEYS.includes(t as SettingsSection)) return t as SettingsSection;
  return null;
}

const SECTION_TITLES: Record<SettingsSection, string> = {
  general: 'Général',
  domaine: 'Domaine',
  github: 'GitHub',
  serveur: 'Serveur',
  llm: 'Agents / LLM',
  sso: 'SSO / OIDC',
  backup: 'Sauvegardes',
  update: 'Mise à jour',
};

function SettingsIcon({ icon, class: className }: { icon: string; class?: string }) {
  const icons: Record<string, JSX.Element> = {
    settings: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v6m0 6v6M5.6 5.6l4.2 4.2m4.2 4.2l4.2 4.2M1 12h6m6 0h6M5.6 18.4l4.2-4.2m4.2-4.2l4.2-4.2" />
      </svg>
    ),
    globe: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
    github: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
      </svg>
    ),
    server: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="2" width="20" height="8" rx="2" />
        <rect x="2" y="14" width="20" height="8" rx="2" />
        <path d="M6 6h.01M6 18h.01" />
      </svg>
    ),
    brain: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9.5 2A2.5 2.5 0 0112 4.5v15a2.5 2.5 0 01-4.96.44 2.5 2.5 0 01-2.96-3.08 3 3 0 01-.34-5.58 2.5 2.5 0 011.32-4.24 2.5 2.5 0 011.98-3A2.5 2.5 0 019.5 2zM14.5 2A2.5 2.5 0 0112 4.5v15a2.5 2.5 0 004.96.44 2.5 2.5 0 002.96-3.08 3 3 0 00.34-5.58 2.5 2.5 0 00-1.32-4.24 2.5 2.5 0 00-1.98-3A2.5 2.5 0 0014.5 2z" />
      </svg>
    ),
    shield: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    archive: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />
      </svg>
    ),
    refresh: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0118.8-4.3M22 12.5a10 10 0 01-18.8 4.2" />
      </svg>
    ),
  };
  return <span class={className}>{icons[icon] || icons.settings}</span>;
}

function SettingCard({ card, index }: { card: SettingCardMeta; index: number }) {
  return (
    <FadeIn delay={Math.min(index * 40, 200)}>
      <a
        href={`/app/settings?tab=${card.key}`}
        class="group flex aspect-square flex-col items-center justify-center gap-3 rounded-2xl bg-[#1c1c1e] px-3 py-4 text-center transition duration-200 hover:-translate-y-0.5 hover:bg-[#252528] hover:ring-1 hover:ring-white/10"
      >
        <div class="flex h-16 w-16 items-center justify-center rounded-[1.15rem] bg-[var(--color-accent-soft)] text-[var(--color-accent)] transition group-hover:scale-[1.03] sm:h-[4.5rem] sm:w-[4.5rem]">
          <SettingsIcon icon={card.icon} />
        </div>
        <div class="w-full">
          <div class="truncate text-sm font-medium text-white">{card.title}</div>
          <div class="mt-1 line-clamp-2 text-[11px] leading-snug text-[var(--color-ink-muted)]">
            {card.description}
          </div>
        </div>
      </a>
    </FadeIn>
  );
}

export function SettingsPage() {
  const section = readSection();
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [ghConnected, setGhConnected] = useState(false);
  const [ghMode, setGhMode] = useState('off');
  const [ghUser, setGhUser] = useState<GhUser | null>(null);
  const [ghHint, setGhHint] = useState('');
  const [token, setToken] = useState('');
  const [ghBusy, setGhBusy] = useState(false);
  const [ghError, setGhError] = useState<string | null>(null);
  const [wildcard, setWildcard] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [domainBusy, setDomainBusy] = useState(false);
  const [sshHost, setSshHost] = useState('');
  const [sshUser, setSshUser] = useState('root');
  const [sshLocal, setSshLocal] = useState(true);
  const [sshKeyExists, setSshKeyExists] = useState(false);
  const [sshPublicKey, setSshPublicKey] = useState('');
  const [sshBusy, setSshBusy] = useState(false);
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

  async function loadSsh() {
    try {
      const s = await api.sshStatus();
      setSshHost(s.ssh_host || '');
      setSshUser(s.ssh_user || 'root');
      setSshLocal(s.local_docker);
      setSshKeyExists(s.key_exists);
      setSshPublicKey(s.public_key || '');
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    Promise.all([
      api
        .health()
        .then((h) => setHealth(h as Health))
        .catch(() => setHealth({ ok: false })),
      api.bootstrap().then((b) => {
        setIsAdmin(b.user?.role === 'instance_admin');
        setWildcard(b.settings?.wildcard_domain || '');
        setInstanceName(b.settings?.instance_name || '');
      }),
      loadGh(),
      loadSsh(),
    ]).finally(() => setLoading(false));
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

  const backends = [
    { key: 'database', label: 'Base', value: health?.backends?.database ?? '—' },
    { key: 'executor', label: 'Executor', value: health?.backends?.executor ?? '—' },
    { key: 'github', label: 'GitHub', value: health?.backends?.github ?? ghMode },
    { key: 'storage', label: 'Storage', value: health?.backends?.storage ?? '—' },
    { key: 'llm', label: 'LLM', value: health?.backends?.llm ?? '—' },
  ];

  // Grid vue si pas de section sélectionnée
  if (!section) {
    return (
      <AppShell active="settings" title="Paramètres">
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4">
          {SETTINGS_CARDS.map((card, i) => (
            <SettingCard key={card.key} card={card} index={i} />
          ))}
        </div>
      </AppShell>
    );
  }

  // Section détail avec bouton retour
  return (
    <AppShell
      active="settings"
      title={
        <div class="flex items-center gap-3">
          <a
            href="/app/settings"
            class="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-[var(--color-ink-muted)] transition hover:border-white/30 hover:bg-white/5 hover:text-white"
            aria-label="Retour à Paramètres"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M19 12H5M12 19l-7-7 7-7" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </a>
          <span>{SECTION_TITLES[section]}</span>
        </div>
      }
    >
      {section === 'general' && (
        <FadeIn>
          <div class="space-y-4">
            <div class="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader title="Serveur" />
                {loading ? (
                  <Skeleton class="h-16" />
                ) : (
                  <LiveStatus
                    busy={!health?.ok}
                    label={health?.ok ? 'En ligne' : 'Hors ligne'}
                    detail={health?.ok ? undefined : 'Vérifie que le serveur tourne'}
                  />
                )}
              </Card>
              <Card>
                <CardHeader title="Base de données" />
                <div class="mt-1">
                  <Badge tone="accent">{health?.backends?.database ?? 'sqlite-local'}</Badge>
                </div>
              </Card>
            </div>
            <Card>
              <CardHeader title="Connexions" />
              <ul class="space-y-2">
                {backends.map((b) => (
                  <li
                    key={b.key}
                    class="flex items-center justify-between rounded-xl border border-[var(--color-line)] px-3 py-2"
                  >
                    <span class="flex items-center gap-2 text-sm">
                      <PulseDot
                        tone={
                          b.value === 'stub' || b.value === 'off' || b.value === '—'
                            ? 'muted'
                            : 'ok'
                        }
                      />
                      {b.label}
                    </span>
                    <Badge>{b.value}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
            <div class="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await api.logout();
                  window.location.href = '/login';
                }}
              >
                Déconnexion
              </Button>
            </div>
          </div>
        </FadeIn>
      )}

      {section === 'domaine' && (
        <FadeIn>
          <Card>
            <CardHeader
              title="Domaine principal"
              action={
                wildcard ? (
                  <Badge tone="ok">{wildcard}</Badge>
                ) : (
                  <Badge tone="warn">non configuré</Badge>
                )
              }
            />
            <p class="mb-3 text-sm text-[var(--color-ink-muted)]">
              Chaque app reçoit un sous-domaine <code>nom-app.{wildcard || 'ton-domaine'}</code> au
              déploiement.
            </p>
            {isAdmin ? (
              <form
                class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const d = wildcard.trim().replace(/^\.+/, '').toLowerCase();
                  if (!d.includes('.')) {
                    toast.push({
                      title: 'Domaine invalide',
                      detail: 'Ex. jeser.app',
                      tone: 'warn',
                    });
                    return;
                  }
                  setDomainBusy(true);
                  try {
                    await api.saveOnboarding({
                      wildcard_domain: d,
                      instance_name: instanceName || undefined,
                    });
                    setWildcard(d);
                    toast.push({
                      title: 'Domaine enregistré',
                      detail: `Apps → *.${d}`,
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
                    label="Wildcard / domaine racine"
                    placeholder="jeser.app"
                    value={wildcard}
                    onInput={(e) => setWildcard((e.target as HTMLInputElement).value)}
                  />
                </div>
                <Button type="submit" size="sm" disabled={domainBusy}>
                  Enregistrer
                </Button>
              </form>
            ) : (
              <Alert tone="warn">Réservé à l’admin instance.</Alert>
            )}
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
            {!isAdmin && !ghConnected && (
              <Alert tone="warn" class="mb-3">
                Seul l’admin instance peut connecter GitHub. Recharge la page si ton rôle vient
                d’être mis à jour.
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
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={ghBusy}
                      onClick={disconnectGithub}
                    >
                      Déconnecter
                    </Button>
                  )}
                </div>
                <p class="text-xs text-[var(--color-ink-faint)]">
                  Mode API : {ghMode}. Les projets peuvent importer tes repos.
                </p>
              </div>
            ) : isAdmin ? (
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
                <div class="flex flex-wrap gap-2">
                  <Button type="submit" size="sm" disabled={ghBusy || !token.trim()}>
                    {ghBusy ? 'Vérification…' : 'Connecter'}
                  </Button>
                  <Button
                    href="https://github.com/settings/tokens?type=beta"
                    size="sm"
                    variant="outline"
                    target="_blank"
                  >
                    Créer un token
                  </Button>
                </div>
              </form>
            ) : null}
          </Card>
        </FadeIn>
      )}

      {section === 'serveur' && (
        <FadeIn>
          <Card>
            <CardHeader
              title="Déploiements"
              action={
                sshLocal ? (
                  <Badge tone="ok">Docker local</Badge>
                ) : (
                  <Badge tone="accent">SSH distant</Badge>
                )
              }
            />
            <p class="mb-3 text-sm text-[var(--color-ink-muted)]">
              Sur ce NAS, les apps se déploient via le socket Docker — aucun SSH requis. Configure
              un host seulement pour un serveur distant.
            </p>
            {!isAdmin ? (
              <Alert tone="warn">Réservé à l’admin instance.</Alert>
            ) : (
              <div class="space-y-4">
                <form
                  class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setSshBusy(true);
                    try {
                      await api.saveSsh({
                        ssh_host: sshHost.trim(),
                        ssh_user: sshUser.trim() || 'root',
                      });
                      toast.push({ title: 'Serveur enregistré', tone: 'ok' });
                      await loadSsh();
                    } catch (err) {
                      toast.push({
                        title: 'Échec',
                        detail: String((err as Error).message || err),
                        tone: 'danger',
                      });
                    } finally {
                      setSshBusy(false);
                    }
                  }}
                >
                  <div class="min-w-0 w-full flex-1">
                    <Input
                      label="Host (optionnel)"
                      placeholder="vide = Docker local"
                      value={sshHost}
                      onInput={(e) => setSshHost((e.target as HTMLInputElement).value)}
                    />
                  </div>
                  <div class="w-full sm:w-36 sm:shrink-0">
                    <Input
                      label="User"
                      value={sshUser}
                      onInput={(e) => setSshUser((e.target as HTMLInputElement).value)}
                    />
                  </div>
                  <Button type="submit" size="sm" disabled={sshBusy}>
                    Enregistrer
                  </Button>
                </form>

                <div class="rounded-xl border border-[var(--color-line)] p-3">
                  <div class="mb-2 flex items-center justify-between gap-2">
                    <p class="text-sm font-medium">Clé SSH</p>
                    <Badge tone={sshKeyExists ? 'ok' : 'muted'}>
                      {sshKeyExists ? 'présente' : 'absente'}
                    </Badge>
                  </div>
                  <p class="mb-3 text-xs text-[var(--color-ink-faint)]">
                    Générée dans <code>/data/ssh/</code> — pas dans Variables ZimaOS. Ne colle jamais
                    la clé privée dans un champ env.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={sshBusy}
                    onClick={async () => {
                      setSshBusy(true);
                      try {
                        const r = await api.generateSshKey();
                        setSshKeyExists(true);
                        setSshPublicKey(r.public_key || '');
                        toast.push({
                          title: r.created ? 'Clé créée' : 'Clé déjà là',
                          detail: r.hint,
                          tone: 'ok',
                        });
                      } catch (err) {
                        toast.push({
                          title: 'Génération KO',
                          detail: String((err as Error).message || err),
                          tone: 'danger',
                        });
                      } finally {
                        setSshBusy(false);
                      }
                    }}
                  >
                    {sshKeyExists ? 'Afficher la clé' : 'Générer une clé'}
                  </Button>
                  {sshPublicKey && (
                    <div class="mt-3 space-y-2">
                      <p class="text-xs text-[var(--color-ink-muted)]">
                        À coller dans <code>~/.ssh/authorized_keys</code> sur le host distant :
                      </p>
                      <textarea
                        readonly
                        class="h-24 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-bg)] p-2 font-mono text-xs"
                        value={sshPublicKey}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(sshPublicKey);
                            toast.push({ title: 'Clé publique copiée', tone: 'ok' });
                          } catch {
                            toast.push({ title: 'Copie impossible', tone: 'warn' });
                          }
                        }}
                      >
                        Copier
                      </Button>
                    </div>
                  )}
                </div>
              </div>
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

      {section === 'sso' && <SsoSettingsPanel isAdmin={isAdmin} />}
      {section === 'backup' && <BackupSettingsPanel isAdmin={isAdmin} />}

      {section === 'update' && (
        <FadeIn>
          <Card>
            <CardHeader title="Mise à jour DevForge" />
            <p class="mb-3 text-sm text-[var(--color-ink-muted)]">
              Vérifier et installer la dernière version de DevForge. La mise à jour se fait via le
              système de gestion du NAS ou manuellement.
            </p>
            {!isAdmin ? (
              <Alert tone="warn">Réservé à l'admin instance.</Alert>
            ) : (
              <div class="space-y-3">
                <div class="rounded-xl border border-[var(--color-line)] p-3">
                  <div class="flex items-center justify-between gap-2">
                    <p class="text-sm font-medium">Version actuelle</p>
                    <Badge tone="accent">{health?.version || 'inconnue'}</Badge>
                  </div>
                </div>
                <Alert tone="info" class="text-xs">
                  Les mises à jour DevForge se font généralement via Docker Compose ou l'UI du NAS.
                  Consulte la documentation pour les instructions détaillées.
                </Alert>
                <div class="flex flex-wrap gap-2">
                  <Button
                    href="https://github.com/bobdivx/devforge/releases"
                    size="sm"
                    variant="outline"
                    target="_blank"
                  >
                    Voir releases GitHub
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </FadeIn>
      )}
    </AppShell>
  );
}
