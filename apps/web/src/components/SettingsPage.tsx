import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { SETTINGS_NAV } from '../lib/nav';
import { AppShell } from './AppShell';
import { BackupSettingsPanel } from './BackupSettingsPanel';
import { LlmProvidersPanel } from './LlmProvidersPanel';
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

type SettingsSection = 'general' | 'domaine' | 'github' | 'llm' | 'backup';

const SECTION_KEYS: SettingsSection[] = ['general', 'domaine', 'github', 'llm', 'backup'];

function readSection(): SettingsSection {
  if (typeof window === 'undefined') return 'general';
  const t = new URLSearchParams(window.location.search).get('tab');
  if (t && SECTION_KEYS.includes(t as SettingsSection)) return t as SettingsSection;
  return 'general';
}

const SECTION_TITLES: Record<SettingsSection, string> = {
  general: 'Général',
  domaine: 'Domaine',
  github: 'GitHub',
  llm: 'Agents / LLM',
  backup: 'Sauvegardes',
};

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

  return (
    <AppShell
      active="settings"
      title={SECTION_TITLES[section]}
      sideNav={SETTINGS_NAV}
      sideNavLabel="Settings"
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
                class="flex flex-wrap items-end gap-2"
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
                <div class="min-w-[200px] flex-1">
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

      {section === 'backup' && <BackupSettingsPanel isAdmin={isAdmin} />}
    </AppShell>
  );
}
