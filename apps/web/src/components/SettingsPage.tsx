import { useEffect, useState } from 'preact/hooks';
import { api, type InstanceDomain } from '../lib/api';
import { AcmeEmailTile } from './AcmeEmailTile';
import { AppShell } from './AppShell';
import { LlmProvidersPanel } from './LlmProvidersPanel';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  FadeIn,
  HubAddTile,
  HubGrid,
  HubIcon,
  HubTile,
  Input,
  Modal,
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
    description: 'Autres zones. Le principal reste visible',
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
  const [domains, setDomains] = useState<InstanceDomain[]>([]);
  const [extraApex, setExtraApex] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [ownOpen, setOwnOpen] = useState(false);
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
      api
        .instanceDomains()
        .then((r) => setDomains(r.data ?? []))
        .catch(() => setDomains([])),
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

  const principal =
    domains.find((row) => row.primary)?.apex ||
    wildcardFallback.trim().replace(/^\.+/, '').toLowerCase();
  const extras = domains.filter((row) => row.apex !== principal);

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
          <HubTile
            index={0}
            href="/app/team"
            title="Compte"
            description="Profil, rôle et workspace"
            icon={<HubIcon name="user" />}
          />
          {SETTINGS_CARDS.map((card, i) => (
            <SettingCard
              key={card.key}
              card={
                card.key === 'domaine' && principal
                  ? { ...card, description: `Principal · ${principal}` }
                  : card
              }
              index={i + 1}
            />
          ))}
          {isAdmin && <AcmeEmailTile index={SETTINGS_CARDS.length + 1} />}
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
          <div class="space-y-3">
            <p class="text-sm text-[var(--color-ink-muted)]">
              Le domaine principal se règle dans Admin. Ici, tu vois ce principal et tu ajoutes les autres zones, par exemple popcornn.app.
            </p>
            <HubGrid>
              <HubTile
                index={0}
                title={principal || 'Aucun'}
                icon={<HubIcon name="globe" />}
                class="!ring-[var(--color-accent)]"
                href={isAdmin ? '/app/admin?tab=domaine' : undefined}
                subtitle={
                  <div class="mt-1 text-[11px] font-medium text-[var(--color-ok)]">Principal</div>
                }
              />
              {extras.map((row, index) => (
                <HubTile
                  key={row.apex}
                  index={index + 1}
                  title={row.apex}
                  icon={<HubIcon name="globe" />}
                  subtitle={
                    <div class="mt-1 text-[11px] text-[var(--color-ink-muted)]">Autre zone</div>
                  }
                  onClick={() => isAdmin && setPicked(row.apex)}
                />
              ))}
              {isAdmin && (
                <HubAddTile index={extras.length + 1} label="Ajouter" onClick={() => setAddOpen(true)} />
              )}
              <HubTile
                index={extras.length + 2}
                title={wildcardOwn || 'Personnel'}
                icon={<HubIcon name="user" />}
                subtitle={
                  <div class="mt-1 text-[11px] text-[var(--color-ink-muted)]">
                    {wildcardOwn ? 'Repli de ton compte' : 'Inactif'}
                  </div>
                }
                onClick={() => setOwnOpen(true)}
              />
            </HubGrid>
          </div>
          <Modal
            open={addOpen}
            onClose={() => setAddOpen(false)}
            title="Ajouter une zone"
            description="Nom de domaine seul, par exemple popcornn.app. Le principal ne change pas."
            size="sm"
          >
            <form
              class="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                const d = extraApex.trim().replace(/^\*\./, '').replace(/^\.+/, '').toLowerCase();
                if (!d.includes('.') || d === principal) {
                  toast.push({
                    title: 'Domaine invalide',
                    detail: d === principal ? 'C’est déjà le principal.' : 'Ex. popcornn.app',
                    tone: 'warn',
                  });
                  return;
                }
                setDomainBusy(true);
                try {
                  const r = await api.addInstanceDomain(d);
                  setDomains(r.data ?? []);
                  setExtraApex('');
                  setAddOpen(false);
                  toast.push({ title: 'Zone ajoutée', detail: d, tone: 'ok' });
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
              <Input
                label="Zone"
                placeholder="popcornn.app"
                value={extraApex}
                onInput={(e) => setExtraApex((e.target as HTMLInputElement).value)}
              />
              <div class="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
                  Annuler
                </Button>
                <Button type="submit" disabled={domainBusy || !extraApex.trim()}>
                  Ajouter
                </Button>
              </div>
            </form>
          </Modal>
          <Modal
            open={picked != null}
            onClose={() => setPicked(null)}
            title={picked || 'Zone'}
            description="Cette zone peut être choisie sur une app ou un groupe."
            size="sm"
            footer={
              <div class="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setPicked(null)}>
                  Fermer
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={domainBusy || !picked}
                  onClick={async () => {
                    if (!picked) return;
                    setDomainBusy(true);
                    try {
                      const r = await api.deleteInstanceDomain(picked);
                      setDomains(r.data ?? []);
                      setPicked(null);
                      toast.push({ title: 'Zone retirée', tone: 'ok' });
                    } catch (err) {
                      toast.push({
                        title: 'Retrait impossible',
                        detail: String((err as Error).message || err),
                        tone: 'danger',
                      });
                    } finally {
                      setDomainBusy(false);
                    }
                  }}
                >
                  Retirer
                </Button>
              </div>
            }
          >
            <p class="text-sm text-[var(--color-ink-muted)]">
              Retirer {picked} ne change pas le domaine principal.
            </p>
          </Modal>
          <Modal
            open={ownOpen}
            onClose={() => setOwnOpen(false)}
            title="Repli de ton compte"
            description="Laisse vide pour que tes apps sans zone choisie utilisent le domaine principal."
            size="sm"
          >
            <form
              class="space-y-4"
              onSubmit={async (e) => {
                e.preventDefault();
                const d = wildcardOwn.trim().replace(/^\.+/, '').toLowerCase();
                if (d && !d.includes('.')) {
                  toast.push({ title: 'Domaine invalide', detail: 'Ex. jeser.app', tone: 'warn' });
                  return;
                }
                setDomainBusy(true);
                try {
                  const r = await api.saveMyDomain(d);
                  setWildcardOwn(r.wildcard_own);
                  setWildcardFallback(r.wildcard_fallback);
                  setOwnOpen(false);
                  toast.push({
                    title: d ? 'Repli personnel enregistré' : 'Repli personnel retiré',
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
              <Input
                label="Zone personnelle"
                placeholder={principal || 'jeser.app'}
                value={wildcardOwn}
                onInput={(e) => setWildcardOwn((e.target as HTMLInputElement).value)}
              />
              <div class="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOwnOpen(false)}>
                  Annuler
                </Button>
                <Button type="submit" disabled={domainBusy}>
                  Enregistrer
                </Button>
              </div>
            </form>
          </Modal>
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
