import { useEffect, useState } from 'preact/hooks';
import { api, type ProxyStatus } from '../lib/api';
import { AppShell } from './AppShell';
import { InstanceAdminGate } from './InstanceAdminGate';
import { InstanceDomainPanel, ServerSettingsPanel } from './AdminInfraPanels';
import { ClusterPanel } from './ClusterPage';
import { BackupSettingsPanel } from './BackupSettingsPanel';
import { PostgresAdminPanel } from './PostgresAdminPanel';
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
  Skeleton,
  Table,
  Td,
  Portal,
  Tr,
  useToast,
} from './ui';

type WorkspaceRow = {
  uuid: string;
  name: string;
  slug: string;
  plan: string;
  created_at: string;
  project_count: number;
  owner: { uuid: string; email: string; name: string; role: string };
};

type Stats = {
  workspaces: number;
  users: number;
  plan_free: number;
  plan_pro: number;
  projects: number;
};

type Health = {
  ok: boolean;
  version?: string;
  backends?: {
    executor?: string;
    github?: string;
    storage?: string;
    database?: string;
    llm?: string;
    docker?: { ok?: boolean; version?: string | null };
  };
};

type AdminSection =
  | 'hub'
  | 'workspaces'
  | 'proxy'
  | 'sante'
  | 'beta'
  | 'postgres'
  | 'serveur'
  | 'sso'
  | 'backup'
  | 'update'
  | 'domaine'
  | 'cluster';

const SECTION_TITLES: Record<Exclude<AdminSection, 'hub'>, string> = {
  workspaces: 'Workspaces',
  proxy: 'Proxy / Traefik',
  sante: 'Santé plateforme',
  beta: 'Fonctionnalités bêta',
  postgres: 'Postgres',
  serveur: 'Serveur',
  sso: 'SSO / OIDC',
  backup: 'Sauvegardes',
  update: 'Mise à jour',
  domaine: 'Domaine instance',
  cluster: 'Cluster',
};

const ADMIN_TABS: AdminSection[] = [
  'workspaces',
  'proxy',
  'sante',
  'beta',
  'postgres',
  'serveur',
  'sso',
  'backup',
  'update',
  'domaine',
  'cluster',
];

type BetaFeatures = {
  workspace: boolean;
  agent_builder: boolean;
};

function readSection(): AdminSection {
  if (typeof window === 'undefined') return 'hub';
  const tab = new URLSearchParams(window.location.search).get('tab');
  if (tab && ADMIN_TABS.includes(tab as AdminSection)) return tab as AdminSection;
  return 'hub';
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ========== HUB ==========

function AdminHub() {
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadOverview() {
    try {
      const [proxyRes, healthRes, adminRes] = await Promise.allSettled([
        api.proxyStatus(),
        api.health(),
        api.adminOverview(),
      ]);

      if (proxyRes.status === 'fulfilled' && proxyRes.value) {
        setProxyStatus(proxyRes.value);
      }
      if (healthRes.status === 'fulfilled') {
        setHealth(healthRes.value as Health);
      }
      if (adminRes.status === 'fulfilled') {
        setStats(adminRes.value.stats);
      }
    } catch (err) {
      console.error('Admin hub load error:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOverview();
    const interval = setInterval(() => void loadOverview(), 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div class="space-y-4">
        <Skeleton class="h-32" />
        <Skeleton class="h-32" />
      </div>
    );
  }

  const proxyTone =
    proxyStatus?.running ? 'ok' : proxyStatus?.status === 'missing' ? 'danger' : 'warn';
  const healthTone = health?.ok ? 'ok' : 'danger';

  return (
    <HubGrid>
      <HubTile
        index={0}
        href="/app/admin?tab=proxy"
        title="Proxy / Traefik"
        description="Reverse-proxy système, routes apps"
        icon={<HubIcon name="network" />}
        badge={
          <Badge tone={proxyTone}>
            {proxyStatus?.running
              ? 'En ligne'
              : proxyStatus?.status === 'missing'
                ? 'Absent'
                : 'Arrêté'}
          </Badge>
        }
      />
      <HubTile
        index={1}
        href="/app/admin?tab=sante"
        title="Santé plateforme"
        description="Backends, connexions, version"
        icon={<HubIcon name="heart" />}
        badge={<Badge tone={healthTone}>{health?.ok ? 'OK' : 'Erreur'}</Badge>}
      />
      <HubTile
        index={2}
        href="/app/admin?tab=workspaces"
        title="Workspaces"
        description={`${stats?.workspaces ?? 0} clients, ${stats?.users ?? 0} utilisateurs`}
        icon={<HubIcon name="users" />}
        badge={stats?.plan_pro ? <Badge tone="accent">{stats.plan_pro} Pro</Badge> : undefined}
      />
      <HubTile
        index={3}
        href="/app/admin?tab=cluster"
        title="Cluster"
        description="Leader, workers, invitations et placement des apps"
        icon={<HubIcon name="network" />}
      />
      <HubTile
        index={4}
        href="/app/admin?tab=postgres"
        title="Postgres"
        description="Base du control plane, port et répliques"
        icon={<HubIcon name="server" />}
      />
      <HubTile
        index={5}
        href="/app/admin?tab=serveur"
        title="Serveur"
        description="Docker local ou SSH distant, clés SSH"
        icon={<HubIcon name="server" />}
      />
      <HubTile
        index={6}
        href="/app/runners"
        title="Runners"
        description="Runners GitHub self-hosted, jobs et logs"
        icon={<HubIcon name="server" />}
      />
      <HubTile
        index={6}
        href="/app/admin?tab=domaine"
        title="Domaine instance"
        description="Wildcard de repli et DNS automatique"
        icon={<HubIcon name="globe" />}
      />
      <HubTile
        index={7}
        href="/app/admin?tab=sso"
        title="SSO / OIDC"
        description="Authentification unique de l’instance"
        icon={<HubIcon name="shield" />}
      />
      <HubTile
        index={8}
        href="/app/admin?tab=backup"
        title="Sauvegardes"
        description="Sauvegardes de l’instance, locales et S3"
        icon={<HubIcon name="archive" />}
      />
      <HubTile
        index={9}
        href="/app/admin?tab=update"
        title="Mise à jour"
        description="Version de DevForge"
        icon={<HubIcon name="refresh" />}
      />
      <HubTile
        index={10}
        href="/app/admin?tab=beta"
        title="Fonctionnalités bêta"
        description="Workspace et création d’app par agent"
        icon={<HubIcon name="brain" />}
        badge={<Badge tone="warn">Bêta</Badge>}
      />
    </HubGrid>
  );
}

// ========== WORKSPACES ==========

function AdminWorkspaces() {
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [busyUuid, setBusyUuid] = useState<string | null>(null);
  const toast = useToast();

  async function load() {
    try {
      const r = await api.adminOverview();
      setStats(r.stats);
      setWorkspaces(r.workspaces);
      setForbidden(false);
    } catch (err) {
      const msg = String((err as Error).message || err);
      if (msg.toLowerCase().includes('admin') || msg.toLowerCase().includes('réservé')) {
        setForbidden(true);
      } else {
        toast.push({ title: 'Erreur', detail: msg, tone: 'danger' });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function setPlan(uuid: string, plan: 'free' | 'pro') {
    setBusyUuid(uuid);
    try {
      await api.adminUpdateWorkspace(uuid, { plan });
      setWorkspaces((list) => list.map((w) => (w.uuid === uuid ? { ...w, plan } : w)));
      setStats((s) => {
        if (!s) return s;
        const prev = workspaces.find((w) => w.uuid === uuid)?.plan;
        if (!prev || prev === plan) return s;
        return {
          ...s,
          plan_free: s.plan_free + (plan === 'free' ? 1 : -1),
          plan_pro: s.plan_pro + (plan === 'pro' ? 1 : -1),
        };
      });
      toast.push({
        title: 'Forfait mis à jour',
        detail: plan === 'pro' ? 'Accès Pro' : 'Passage Free',
        tone: 'ok',
      });
    } catch (err) {
      toast.push({
        title: 'Échec',
        detail: String((err as Error).message || err),
        tone: 'danger',
      });
    } finally {
      setBusyUuid(null);
    }
  }

  if (forbidden) {
    return <Alert tone="warn">Réservé à l'administrateur d'instance.</Alert>;
  }

  if (loading) {
    return (
      <div class="space-y-4">
        <Skeleton class="h-24" />
        <Skeleton class="h-48" />
      </div>
    );
  }

  return (
    <div class="space-y-6">
      {stats && (
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Workspaces', value: stats.workspaces },
            { label: 'Utilisateurs', value: stats.users },
            { label: 'Free', value: stats.plan_free },
            { label: 'Pro', value: stats.plan_pro },
          ].map((s) => (
            <Card key={s.label} class="!p-4">
              <p class="text-[11px] uppercase tracking-wider text-[var(--color-ink-faint)]">
                {s.label}
              </p>
              <p class="mt-1 text-2xl font-semibold tabular-nums">{s.value}</p>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader
          title="Workspaces clients"
          action={
            <Button href="/register" size="sm" variant="outline">
              Lien inscription
            </Button>
          }
        />
        <p class="mb-4 text-sm text-[var(--color-ink-muted)]">
          Chaque inscription crée un workspace isolé en forfait free. Passe un client en Pro pour
          débloquer les quotas (billing Stripe à brancher ensuite).
        </p>
        {workspaces.length === 0 ? (
          <Alert tone="info">Aucun workspace pour l'instant.</Alert>
        ) : (
          <Table headers={['Owner', 'Workspace', 'Projets', 'Forfait', 'Depuis', '']}>
            {workspaces.map((w) => (
              <Tr key={w.uuid}>
                <Td>
                  <div>
                    <p class="font-medium text-[var(--color-ink)]">{w.owner.name}</p>
                    <p class="text-xs text-[var(--color-ink-faint)]">{w.owner.email}</p>
                  </div>
                </Td>
                <Td>
                  <div>
                    <p class="text-[var(--color-ink)]">{w.name}</p>
                    <p class="text-xs text-[var(--color-ink-faint)]">{w.slug}</p>
                    {w.owner.role === 'instance_admin' && (
                      <Badge tone="accent" class="mt-1">
                        Admin instance
                      </Badge>
                    )}
                  </div>
                </Td>
                <Td>
                  <span class="tabular-nums text-[var(--color-ink)]">{w.project_count}</span>
                </Td>
                <Td>
                  <Badge tone={w.plan === 'pro' ? 'accent' : 'neutral'}>{w.plan}</Badge>
                </Td>
                <Td>
                  <span class="text-xs">{formatDate(w.created_at)}</span>
                </Td>
                <Td>
                  <div class="flex flex-wrap justify-end gap-1.5">
                    {w.plan !== 'pro' ? (
                      <Button
                        size="sm"
                        disabled={busyUuid === w.uuid}
                        onClick={() => setPlan(w.uuid, 'pro')}
                      >
                        → Pro
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyUuid === w.uuid}
                        onClick={() => setPlan(w.uuid, 'free')}
                      >
                        → Free
                      </Button>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

// ========== PROXY ==========

function AdminProxy() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<ProxyStatus | null>(null);
  const [details, setDetails] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const toast = useToast();

  async function loadStatus() {
    try {
      const data = await api.proxyStatus();
      setStatus(data);
      // Les détails sont directement dans data (image, started_at, network)
      if (data.running) {
        setDetails({
          image: data.image || 'traefik:v3.6',
          network: data.network || 'devforge',
          started_at: data.started_at || '',
        });
      }
    } catch (err) {
      console.error('Proxy status error:', err);
      setStatus({ status: 'unknown', running: false, message: String(err) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStatus();
    const interval = setInterval(() => void loadStatus(), 8000);
    return () => clearInterval(interval);
  }, []);

  async function handleAction(action: string) {
    setBusy(true);
    try {
      const data =
        action === 'ensure' ? await api.proxyEnsure() : await api.proxyRestart();

      toast.push({
        title: action === 'ensure' ? 'Proxy réparé' : 'Proxy redémarré',
        detail: data.message || 'Opération réussie',
        tone: 'ok',
      });
      await loadStatus();
    } catch (err) {
      toast.push({
        title: 'Échec',
        detail: String((err as Error).message || err),
        tone: 'danger',
      });
    } finally {
      setBusy(false);
      setConfirmAction(null);
    }
  }

  if (loading) {
    return <Skeleton class="h-64" />;
  }

  const heroState =
    status?.running ? 'online' : status?.status === 'missing' ? 'missing' : 'stopped';
  const hero = {
    online: {
      color: 'bg-[var(--color-ok)]',
      icon: '✓',
      label: 'En ligne',
      message: 'Toutes les apps sont routées correctement',
    },
    stopped: {
      color: 'bg-[var(--color-warn)]',
      icon: '⏸',
      label: 'Arrêté',
      message: 'Proxy down — sites en 502',
    },
    missing: {
      color: 'bg-[var(--color-danger)]',
      icon: '✕',
      label: 'Absent',
      message: 'Conteneur introuvable — sites inaccessibles',
    },
  }[heroState];

  const needsRepair = heroState !== 'online';

  return (
    <div class="space-y-4">
      <Card class="overflow-hidden !p-0">
        <div class={`flex items-center gap-4 p-6 ${hero.color} bg-opacity-10`}>
          <div
            class={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl ${hero.color} text-3xl text-zinc-950`}
          >
            {hero.icon}
          </div>
          <div class="min-w-0 flex-1">
            <h2 class="text-xl font-semibold text-[var(--color-ink)]">{hero.label}</h2>
            <p class="mt-1 text-sm text-[var(--color-ink-muted)]">{hero.message}</p>
          </div>
        </div>
      </Card>

      <div class="space-y-2">
        <Button
          size="lg"
          variant="ghost"
          class="!h-12 w-full !justify-start"
          disabled={busy}
          onClick={() => void loadStatus()}
        >
          ↻ Actualiser
        </Button>

        {needsRepair && (
          <Button
            size="lg"
            class="!h-12 w-full !justify-start"
            disabled={busy}
            onClick={() => setConfirmAction('ensure')}
          >
            🔧 Réparer / Recréer
          </Button>
        )}

        {heroState === 'online' && (
          <Button
            size="lg"
            variant="danger"
            class="!h-12 w-full !justify-start"
            disabled={busy}
            onClick={() => setConfirmAction('restart')}
          >
            ↻ Redémarrer
          </Button>
        )}
      </div>

      {heroState === 'online' && details && (
        <Card>
          <CardHeader title="Détails" />
          <dl class="space-y-2 text-sm">
            {Object.entries(details).map(([key, val]) => (
              <div
                key={key}
                class="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-line)] px-3 py-2"
              >
                <dt class="capitalize text-[var(--color-ink-muted)]">{key}</dt>
                <dd class="truncate font-mono text-xs text-[var(--color-ink)]">{val}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      <Card>
        <button
          onClick={() => setHelpOpen(!helpOpen)}
          class="flex w-full items-center justify-between text-left"
        >
          <CardHeader title="Aide" />
          <span class="text-xl text-[var(--color-ink-muted)]">{helpOpen ? '−' : '+'}</span>
        </button>
        {helpOpen && (
          <div class="mt-3 space-y-2 text-sm text-[var(--color-ink-muted)]">
            <p>
              <strong>Traefik</strong> est le reverse-proxy qui route les requêtes HTTP vers vos
              apps. Si le conteneur est arrêté ou manquant, les sites retournent 502.
            </p>
            <p>
              <strong>Réparer / Recréer</strong> : recrée le conteneur s'il manque ou le démarre
              s'il est stoppé.
            </p>
            <p class="text-xs">Statut actualisé automatiquement toutes les 8 secondes.</p>
          </div>
        )}
      </Card>

      {confirmAction && (
        <Portal>
        <div class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4">
          <Card class="w-full max-w-md">
            <CardHeader
              title={confirmAction === 'ensure' ? 'Réparer / Recréer ?' : 'Redémarrer ?'}
            />
            <p class="mb-4 text-sm text-[var(--color-ink-muted)]">
              {confirmAction === 'ensure'
                ? 'Le conteneur Traefik sera recréé ou démarré. Cette opération prend quelques secondes.'
                : 'Le proxy Traefik sera redémarré. Les apps seront brièvement inaccessibles (~2-5s).'}
            </p>
            <div class="flex gap-2">
              <Button variant="ghost" onClick={() => setConfirmAction(null)} disabled={busy}>
                Annuler
              </Button>
              <Button
                variant={confirmAction === 'ensure' ? 'primary' : 'danger'}
                onClick={() => handleAction(confirmAction)}
                disabled={busy}
              >
                Confirmer
              </Button>
            </div>
          </Card>
        </div>
        </Portal>
      )}
    </div>
  );
}

// ========== SANTÉ ==========

function AdminSante() {
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    api
      .health()
      .then((h) => setHealth(h as Health))
      .catch(() => setHealth({ ok: false }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <Skeleton class="h-48" />;
  }

  const backends = [
    { key: 'database', label: 'Base', value: health?.backends?.database ?? '—' },
    { key: 'executor', label: 'Executor', value: health?.backends?.executor ?? '—' },
    { key: 'github', label: 'GitHub', value: health?.backends?.github ?? '—' },
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

  return (
    <div class="space-y-4">
      <Card>
        <CardHeader title="Version" />
        <div class="flex items-center gap-2">
          <Badge tone="accent">{health?.version || 'inconnue'}</Badge>
          <span class="text-sm text-[var(--color-ink-muted)]">DevForge</span>
        </div>
      </Card>

      <Card>
        <CardHeader title="Connexions" />
        <ul class="space-y-2">
          {backends.map((b) => {
            const active = b.value !== '—' && b.value !== 'off' && b.value !== 'stub';
            return (
              <li
                key={b.key}
                class="flex items-center justify-between rounded-lg border border-[var(--color-line)] px-3 py-2"
              >
                <span class="flex items-center gap-2 text-sm">
                  <span class={`h-2 w-2 rounded-full ${active ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-ink-faint)]'}`} />
                  {b.label}
                </span>
                <Badge>{b.value}</Badge>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function FeatureSwitch({
  checked,
  disabled,
  label,
  onToggle,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      class={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:ring-offset-2 focus:ring-offset-[var(--color-bg)] disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-line)]'
      }`}
    >
      <span
        aria-hidden="true"
        class={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function AdminBeta() {
  const toast = useToast();
  const [features, setFeatures] = useState<BetaFeatures | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api
      .bootstrap()
      .then((b) => {
        setFeatures({
          workspace: b.features?.workspace !== false,
          agent_builder: b.features?.agent_builder !== false,
        });
      })
      .catch((err) => {
        toast.push({ title: 'Erreur', detail: String(err), tone: 'danger' });
      });
  }, []);

  async function toggle(key: keyof BetaFeatures) {
    if (!features) return;
    const next = { ...features, [key]: !features[key] };
    setBusy(key);
    try {
      const r = await api.adminUpdateFeatures(next);
      setFeatures(r.features);
      toast.push({
        title: next[key] ? 'Fonctionnalité affichée' : 'Fonctionnalité masquée',
        tone: 'ok',
      });
    } catch (err) {
      toast.push({ title: 'Échec', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div class="space-y-4">
      <Alert tone="info">
        Les fonctionnalités activées restent visibles pour tous les comptes, avec un badge Bêta.
        Désactivées, elles disparaissent des menus et l’API refuse la création par agent.
      </Alert>
      <Card>
        <div class="flex items-center justify-between gap-4 border-b border-[var(--color-line)] py-4 first:pt-0">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h3 class="text-sm font-medium">Workspace</h3>
              <Badge tone="warn">Bêta</Badge>
            </div>
            <p class="mt-1 text-xs text-[var(--color-ink-muted)]">
              Onglet atelier dans chaque application (chat agent, aperçu, fichiers).
            </p>
          </div>
          <FeatureSwitch
            checked={!!features?.workspace}
            disabled={!features || busy === 'workspace'}
            label="Workspace bêta"
            onToggle={() => void toggle('workspace')}
          />
        </div>
        <div class="flex items-center justify-between gap-4 py-4">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h3 class="text-sm font-medium">Créer avec un agent</h3>
              <Badge tone="warn">Bêta</Badge>
            </div>
            <p class="mt-1 text-xs text-[var(--color-ink-muted)]">
              Option « Créer avec un agent » dans Nouvelle application.
            </p>
          </div>
          <FeatureSwitch
            checked={!!features?.agent_builder}
            disabled={!features || busy === 'agent_builder'}
            label="Création par agent"
            onToggle={() => void toggle('agent_builder')}
          />
        </div>
      </Card>
    </div>
  );
}

// ========== MAIN ==========

export function AdminPage() {
  return (
    <InstanceAdminGate active="admin" title="Admin">
      <AdminPageInner />
    </InstanceAdminGate>
  );
}

function AdminPageInner() {
  const section = readSection();

  return (
    <AppShell
      active="admin"
      title={
        section !== 'hub' ? (
          <div class="flex items-center gap-3">
            <a
              href="/app/admin"
              class="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-[var(--color-ink-muted)] transition hover:border-white/30 hover:bg-white/5 hover:text-white"
              aria-label="Retour à Admin"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
              >
                <path d="M19 12H5M12 19l-7-7 7-7" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </a>
            <span>{SECTION_TITLES[section]}</span>
          </div>
        ) : (
          'Admin'
        )
      }
      description={
        section === 'hub' ? 'Administration plateforme et workspaces clients' : undefined
      }
    >
      <FadeIn>
        {section === 'hub' && <AdminHub />}
        {section === 'workspaces' && <AdminWorkspaces />}
        {section === 'proxy' && <AdminProxy />}
        {section === 'sante' && <AdminSante />}
        {section === 'beta' && <AdminBeta />}
        {section === 'postgres' && <PostgresAdminPanel />}
        {section === 'serveur' && <ServerSettingsPanel />}
        {section === 'domaine' && <InstanceDomainPanel />}
        {section === 'sso' && <SsoSettingsPanel isAdmin />}
        {section === 'backup' && <BackupSettingsPanel isAdmin />}
        {section === 'update' && <UpdateSettingsPanel isAdmin />}
        {section === 'cluster' && <ClusterPanel />}
      </FadeIn>
    </AppShell>
  );
}
