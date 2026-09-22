import { useEffect, useState } from 'preact/hooks';
import { api, type DnsRuntimeStatus, type DnsSettingsPublic } from '../lib/api';
import { AppShell } from './AppShell';
import { InstanceAdminGate } from './InstanceAdminGate';
import { BackupSettingsPanel } from './BackupSettingsPanel';
import { DnsEntrypointPanel } from './DnsEntrypointPanel';
import { DockerEngineAlert } from './DockerEngineAlert';
import { LlmProvidersPanel } from './LlmProvidersPanel';
import { SsoSettingsPanel } from './SsoSettingsPanel';
import { UpdateSettingsPanel } from './UpdateSettingsPanel';
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
    docker?: { ok?: boolean; version?: string | null; hint?: string };
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
    description: 'Wildcard apps et DNS auto (Cloudflare ou Porkbun)',
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
  return (
    <InstanceAdminGate active="settings" title="Paramètres">
      <SettingsPageInner />
    </InstanceAdminGate>
  );
}

function SettingsPageInner() {
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
  const [dnsProvider, setDnsProvider] = useState('');
  /** Provider réellement enregistré côté serveur (pas le brouillon du formulaire). */
  const [activeDnsProvider, setActiveDnsProvider] = useState('');
  const [dnsZone, setDnsZone] = useState('');
  const [dnsToken, setDnsToken] = useState('');
  const [porkbunApiKey, setPorkbunApiKey] = useState('');
  const [porkbunSecret, setPorkbunSecret] = useState('');
  const [cfTokenSet, setCfTokenSet] = useState(false);
  const [porkbunKeySet, setPorkbunKeySet] = useState(false);
  const [porkbunSecretSet, setPorkbunSecretSet] = useState(false);
  const [inactiveCreds, setInactiveCreds] = useState<string[]>([]);
  const [dnsStatus, setDnsStatus] = useState<DnsRuntimeStatus | null>(null);
  const [dnsStatusLoading, setDnsStatusLoading] = useState(false);
  const [switchTarget, setSwitchTarget] = useState<string | null>(null);
  const [clearOnSwitch, setClearOnSwitch] = useState(true);
  const [clearInactiveOnSave, setClearInactiveOnSave] = useState(false);
  const [sshHost, setSshHost] = useState('');
  const [sshUser, setSshUser] = useState('root');
  const [sshLocal, setSshLocal] = useState(true);
  const [sshKeyExists, setSshKeyExists] = useState(false);
  const [sshPublicKey, setSshPublicKey] = useState('');
  const [sshBusy, setSshBusy] = useState(false);
  const toast = useToast();

  function applyDnsFlags(dns: DnsSettingsPublic) {
    setCfTokenSet(!!(dns.cloudflare_token_set || (dns.provider === 'cloudflare' && dns.token_set)));
    setPorkbunKeySet(!!(dns.porkbun_token_set || (dns.api_key_set && dns.secret_set)));
    setPorkbunSecretSet(!!(dns.porkbun_token_set || (dns.api_key_set && dns.secret_set)));
    setInactiveCreds(dns.inactive_credentials ?? []);
    setActiveDnsProvider(dns.provider || '');
  }

  function requestProviderSwitch(next: string) {
    if (next === dnsProvider) return;
    // Confirmer seulement si on quitte le provider réellement enregistré.
    if (activeDnsProvider && activeDnsProvider !== next) {
      setClearOnSwitch(true);
      setSwitchTarget(next);
      return;
    }
    setDnsProvider(next);
    setClearInactiveOnSave(false);
  }

  function confirmProviderSwitch() {
    if (switchTarget === null) return;
    setDnsProvider(switchTarget);
    setClearInactiveOnSave(clearOnSwitch);
    setSwitchTarget(null);
  }

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

  async function loadDnsStatus() {
    setDnsStatusLoading(true);
    try {
      const r = await api.dnsRuntimeStatus();
      setDnsProvider(r.dns.provider || '');
      setDnsZone(r.dns.zone || '');
      applyDnsFlags(r.dns);
      setDnsStatus(r.status);
    } catch {
      setDnsStatus(null);
    } finally {
      setDnsStatusLoading(false);
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
      api
        .dnsSettings()
        .then((r) => {
          setDnsProvider(r.dns.provider || '');
          setDnsZone(r.dns.zone || '');
          applyDnsFlags(r.dns);
        })
        .catch(() => null),
    ]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (section !== 'domaine' || !isAdmin) return;
    void loadDnsStatus();
  }, [section, isAdmin]);

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
    {
      key: 'docker',
      label: 'Docker',
      value: health?.backends?.docker?.ok
        ? health.backends.docker.version || 'ok'
        : 'absent',
    },
  ];

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
                    class="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-[var(--color-line)] px-3 py-2"
                  >
                    <span class="flex min-w-0 items-center gap-2 text-sm">
                      <PulseDot
                        tone={
                          b.value === 'stub' || b.value === 'off' || b.value === '—'
                            ? 'muted'
                            : 'ok'
                        }
                      />
                      <span class="truncate">{b.label}</span>
                    </span>
                    <Badge class="max-w-[55%] min-w-0 overflow-hidden truncate">{b.value}</Badge>
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
            <p class="mb-3 break-words text-sm text-[var(--color-ink-muted)]">
              Chaque app reçoit un sous-domaine{' '}
              <code class="break-all">nom-app.{wildcard || 'ton-domaine'}</code> au déploiement.
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
                <Button type="submit" size="sm" class="w-full sm:w-auto" disabled={domainBusy}>
                  Enregistrer
                </Button>
              </form>
            ) : (
              <Alert tone="warn">Réservé à l’admin instance.</Alert>
            )}
          </Card>
          <DnsEntrypointPanel
            isAdmin={isAdmin}
            serverVersion={health?.version}
            dnsProvider={dnsProvider}
            setDnsProvider={setDnsProvider}
            activeDnsProvider={activeDnsProvider}
            dnsZone={dnsZone}
            setDnsZone={setDnsZone}
            dnsToken={dnsToken}
            setDnsToken={setDnsToken}
            porkbunApiKey={porkbunApiKey}
            setPorkbunApiKey={setPorkbunApiKey}
            porkbunSecret={porkbunSecret}
            setPorkbunSecret={setPorkbunSecret}
            cfTokenSet={cfTokenSet}
            porkbunKeySet={porkbunKeySet}
            porkbunSecretSet={porkbunSecretSet}
            inactiveCreds={inactiveCreds}
            dnsStatus={dnsStatus}
            setDnsStatus={setDnsStatus}
            dnsStatusLoading={dnsStatusLoading}
            applyDnsFlags={applyDnsFlags}
            clearInactiveOnSave={clearInactiveOnSave}
            setClearInactiveOnSave={setClearInactiveOnSave}
            requestProviderSwitch={requestProviderSwitch}
            switchTarget={switchTarget}
            setSwitchTarget={setSwitchTarget}
            clearOnSwitch={clearOnSwitch}
            setClearOnSwitch={setClearOnSwitch}
            confirmProviderSwitch={confirmProviderSwitch}
          />
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
              Les apps se déploient via Docker sur cette machine, ou via SSH vers un hôte distant
              qui a Docker. L’exécutable DevForge ne l’embarque pas.
            </p>
            <div class="mb-4">
              <DockerEngineAlert docker={health?.backends?.docker} />
            </div>
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
                  <Button type="submit" size="sm" class="w-full sm:w-auto" disabled={sshBusy}>
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
      {section === 'update' && <UpdateSettingsPanel isAdmin={isAdmin} />}
    </AppShell>
  );
}
