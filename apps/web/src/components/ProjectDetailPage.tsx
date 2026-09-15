import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { api, type Deployment, type Project } from '../lib/api';
import { cn } from '../lib/cn';
import { projectNav } from '../lib/nav';
import { projectStatusMeta, projectSyncMeta } from '../lib/status';
import { AppIcon, statusDotClass } from './AppIcon';
import { AppShell } from './AppShell';
import { ProjectAgentsPanel } from './ProjectAgentsPanel';
import { ProjectActionsPanel } from './ProjectActionsPanel';
import { ProjectGitPanel } from './ProjectGitPanel';
import { ProjectWorkspace } from './ProjectWorkspace';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  FadeIn,
  HubGrid,
  HubTile,
  Input,
  LiveStatus,
  Modal,
  Spinner,
  Table,
  Td,
  Tr,
  useToast,
} from './ui';

type Tab =
  | 'overview'
  | 'workspace'
  | 'deployments'
  | 'git'
  | 'actions'
  | 'agents'
  | 'domains'
  | 'database'
  | 'env'
  | 'backups'
  | 'crons'
  | 'settings';

type Props = { uuid?: string; tab?: Tab };

function readQuery(): { uuid: string; tab: Tab; builder?: boolean; agent?: string } {
  if (typeof window === 'undefined') {
    return { uuid: '', tab: 'overview' };
  }
  const q = new URLSearchParams(window.location.search);
  const tab = (q.get('tab') as Tab) || 'overview';
  const allowed: Tab[] = [
    'overview',
    'workspace',
    'deployments',
    'git',
    'actions',
    'agents',
    'domains',
    'database',
    'env',
    'backups',
    'crons',
    'settings',
  ];
  return {
    uuid: q.get('uuid') || '',
    tab: allowed.includes(tab) ? tab : 'overview',
    builder: q.get('builder') === '1',
    agent: q.get('agent') || undefined,
  };
}

function deployTone(status: string): 'ok' | 'warn' | 'danger' | 'neutral' {
  return projectStatusMeta(status).tone;
}

function formatWhen(iso?: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function ProjectDetailPage(props: Props) {
  const initial = readQuery();
  const uuid = props.uuid ?? initial.uuid;
  const tab = props.tab ?? initial.tab;
  const builderMode = initial.builder;
  const builderAgentUuid = initial.agent;
  const [project, setProject] = useState<Project | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.project(uuid), api.deployments(uuid)])
      .then(([p, d]) => {
        setProject(p.data);
        setDeployments(d.data ?? []);
        setError(null);
      })
      .catch((e) => setError(String(e.message || e)))
      .finally(() => setLoading(false));
  }, [uuid]);

  const titles: Record<string, string> = {
    overview: project?.name ?? 'Projet',
    workspace: 'Espace de travail',
    deployments: 'Deployments',
    git: 'Git',
    actions: 'Actions',
    agents: 'Agents',
    domains: 'Domains',
    env: 'Env',
    backups: 'Backups',
    crons: 'Crons',
    settings: 'Settings',
  };

  return (
    <AppShell
      active="projects"
      projectNav={projectNav(uuid)}
      title={tab === 'workspace' ? undefined : titles[tab]}
      actions={
        tab === 'overview' && project ? (
          <div class="flex flex-wrap items-center gap-2">
            {project.production_url && (
              <Button size="sm" variant="outline" href={project.production_url} target="_blank">
                Ouvrir l’app
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              href={`/app/projects/view?uuid=${encodeURIComponent(uuid)}&tab=deployments`}
            >
              Déploiements
            </Button>
          </div>
        ) : undefined
      }
    >
      {error && (
        <Alert tone="warn" class="mb-4">
          {error}
        </Alert>
      )}
      {tab === 'overview' && loading && !project && (
        <p class="text-sm text-[var(--color-ink-muted)]">Chargement du projet…</p>
      )}
      {tab === 'overview' && project && (
        <ProjectOverview
          uuid={uuid}
          project={project}
          deployments={deployments}
          onDeployments={(d) => setDeployments(d)}
        />
      )}
      {tab === 'workspace' && (
        <ProjectWorkspace
          projectUuid={uuid}
          project={project}
          builderMode={builderMode}
          builderAgentUuid={builderAgentUuid}
        />
      )}
      {tab === 'deployments' && (
        <DeploymentsPanel
          projectUuid={uuid}
          initial={deployments}
          onRefresh={(d) => setDeployments(d)}
        />
      )}
      {tab === 'git' && (
        <ProjectGitPanel
          projectUuid={uuid}
          project={project}
          onDeployed={() => {
            void api.deployments(uuid).then((r) => setDeployments(r.data ?? []));
          }}
        />
      )}
      {tab === 'actions' && (
        <ProjectActionsPanel
          projectUuid={uuid}
          gitRepository={project?.git_repository}
        />
      )}
      {tab === 'agents' && <ProjectAgentsPanel projectUuid={uuid} mode="threads" />}
      {tab === 'database' && <DatabasePanel uuid={uuid} />}
      {tab === 'env' && <EnvPanel uuid={uuid} />}
      {tab === 'backups' && <BackupsPanel projectUuid={uuid} />}
      {tab === 'crons' && <CronsPanel projectUuid={uuid} />}
      {tab === 'domains' && (
        <DomainsPanel
          uuid={uuid}
          project={project}
          onProjectUpdate={(p) => setProject(p)}
        />
      )}
      {tab === 'settings' && project && (
        <ProjectSettingsPanel project={project} onSaved={(p) => setProject(p)} />
      )}
      {tab === 'settings' && !project && !error && (
        <Card>
          <p class="text-sm text-[var(--color-ink-muted)]">Chargement…</p>
        </Card>
      )}
    </AppShell>
  );
}

type HealthItem = {
  key: string;
  label: string;
  detail: string;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
  href?: string;
};

function ProjectOverview({
  uuid,
  project,
  deployments,
  onDeployments,
}: {
  uuid: string;
  project: Project;
  deployments: Deployment[];
  onDeployments: (d: Deployment[]) => void;
}) {
  const toast = useToast();
  const [envCount, setEnvCount] = useState<number | null>(null);
  const [envKeys, setEnvKeys] = useState<string[]>([]);
  const [dbLinks, setDbLinks] = useState<
    Array<{ id: string; provider: string; resource_name: string }>
  >([]);
  const [domainCount, setDomainCount] = useState<number | null>(null);
  const [gitSync, setGitSync] = useState<Project['sync'] | null>(project.sync ?? null);
  const [lifeBusy, setLifeBusy] = useState<string | null>(null);
  const [lifeDetail, setLifeDetail] = useState<string | null>(null);
  const [deployBusy, setDeployBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const latest = deployments[0] ?? null;
  // Ne remonter une erreur que si le *dernier* déploiement a échoué (pas un vieux fail).
  const latestFailed =
    latest && (latest.status === 'failed' || latest.status === 'error') ? latest : null;

  useEffect(() => {
    setGitSync(project.sync ?? null);
  }, [project.sync]);

  useEffect(() => {
    Promise.allSettled([
      api.envList(uuid),
      api.projectResources(uuid),
      api.domains(uuid),
      api.projectGit(uuid),
    ]).then(([envR, resR, domR, gitR]) => {
      if (envR.status === 'fulfilled') {
        const rows = envR.value.data ?? [];
        setEnvCount(rows.length);
        setEnvKeys(rows.map((r) => r.key));
      } else {
        setEnvCount(0);
      }
      if (resR.status === 'fulfilled') {
        setDbLinks(resR.value.data ?? []);
      }
      if (domR.status === 'fulfilled') {
        setDomainCount((domR.value.domains ?? domR.value.data ?? []).length);
      } else {
        setDomainCount(0);
      }
      if (gitR.status === 'fulfilled' && gitR.value.sync) {
        setGitSync(gitR.value.sync);
      }
    });
  }, [uuid]);

  const hasDbEnv =
    envKeys.some((k) =>
      ['DATABASE_URL', 'TURSO_DATABASE_URL', 'LIBSQL_URL', 'TURSO_AUTH_TOKEN'].includes(k),
    ) || dbLinks.length > 0;

  const statusMeta = projectStatusMeta(project.status);

  const health: Array<HealthItem & { icon: 'deploy' | 'pulse' | 'db' | 'env' | 'git' | 'globe' | 'actions' }> = [
    {
      key: 'deploy',
      icon: 'deploy',
      label: 'Déploiement',
      detail: latest
        ? `${latest.status}${latest.git_sha ? ` · ${latest.git_sha.slice(0, 7)}` : ''} · ${formatWhen(latest.created_at)}`
        : 'Aucun déploiement',
      tone: latest ? deployTone(latest.status) : 'warn',
      href: `/app/projects/view?uuid=${encodeURIComponent(uuid)}&tab=deployments`,
    },
    {
      key: 'actions',
      icon: 'actions',
      label: 'GitHub Actions',
      detail: project.git_repository
        ? 'Workflows & runners'
        : 'Repo GitHub requis',
      tone: project.git_repository ? 'ok' : 'neutral',
      href: `/app/projects/view?uuid=${encodeURIComponent(uuid)}&tab=actions`,
    },
    {
      key: 'errors',
      icon: 'pulse',
      label: latestFailed ? 'Échec actif' : project.status === 'unhealthy' ? 'Site inaccessible' : 'Santé',
      detail: latestFailed
        ? `${latestFailed.git_message || latestFailed.status} · ${formatWhen(latestFailed.created_at)}`
        : project.status === 'unhealthy'
          ? `URL inaccessible${latest ? ` · Deploy ${latest.status}` : ''}`
          : latest
            ? 'Dernier déploiement OK'
            : 'En attente du premier deploy',
      tone: latestFailed || project.status === 'unhealthy' ? 'danger' : latest ? 'ok' : 'neutral',
      href: latestFailed
        ? `/app/projects/view?uuid=${encodeURIComponent(uuid)}&tab=deployments`
        : undefined,
    },
    {
      key: 'db',
      icon: 'db',
      label: 'Base de données',
      detail:
        dbLinks.length > 0
          ? dbLinks.map((l) => `${l.provider}: ${l.resource_name}`).join(', ')
          : hasDbEnv
            ? 'Configurée via variables d’env'
            : 'Aucune DB reliée',
      tone: dbLinks.length > 0 || hasDbEnv ? 'ok' : 'neutral',
      href: `/app/projects/view?uuid=${encodeURIComponent(uuid)}&tab=database`,
    },
    {
      key: 'env',
      icon: 'env',
      label: 'Environnement',
      detail:
        envCount === null
          ? '…'
          : envCount === 0
            ? 'Aucune variable'
            : `${envCount} variable${envCount > 1 ? 's' : ''}`,
      tone: envCount === null ? 'neutral' : envCount === 0 ? 'warn' : 'ok',
      href: `/app/projects/view?uuid=${encodeURIComponent(uuid)}&tab=env`,
    },
    (() => {
      const sync = projectSyncMeta(gitSync);
      const repo = project.git_repository
        ? `${project.git_repository.replace(/^https?:\/\/(www\.)?github\.com\//, '')}${
            project.git_branch ? ` @ ${project.git_branch}` : ''
          }`
        : null;
      return {
        key: 'git',
        icon: 'git' as const,
        label: 'Git',
        detail: !repo
          ? 'Pas de dépôt'
          : gitSync?.state
            ? `${sync.label} · ${repo}`
            : repo,
        tone: !repo
          ? ('warn' as const)
          : sync.tone === 'warn' || sync.tone === 'danger'
            ? sync.tone
            : sync.tone === 'ok'
              ? ('ok' as const)
              : ('neutral' as const),
        href: `/app/projects/view?uuid=${encodeURIComponent(uuid)}&tab=git`,
      };
    })(),
    {
      key: 'domain',
      icon: 'globe',
      label: 'URL',
      detail: project.production_url
        ? project.production_url.replace(/^https?:\/\//, '')
        : domainCount
          ? `${domainCount} domaine(s)`
          : 'Pas d’URL',
      tone: project.production_url || (domainCount ?? 0) > 0 ? 'ok' : 'neutral',
      href: `/app/projects/view?uuid=${encodeURIComponent(uuid)}&tab=domains`,
    },
  ];

  async function runLifecycle(action: string) {
    setLifeBusy(action);
    setLifeDetail(`${action}…`);
    try {
      const r = await api.lifecycle(uuid, action);
      setLifeDetail(r.output?.slice(0, 200) || r.phase || (r.ok === false ? 'Échec' : 'OK'));
      toast.push({
        title: r.ok === false ? `${labelAction(action)} échoué` : `${labelAction(action)} OK`,
        detail: r.error || r.phase || undefined,
        tone: r.ok === false ? 'danger' : 'ok',
      });
    } catch (e) {
      setLifeDetail(String(e));
      toast.push({ title: `${labelAction(action)} KO`, detail: String(e), tone: 'danger' });
    } finally {
      setLifeBusy(null);
    }
  }

  async function deployNow() {
    setDeployBusy(true);
    toast.push({ title: 'Déploiement…', detail: 'Clone + build', tone: 'info' });
    try {
      const r = await api.createDeployment(uuid, { git_message: 'Deploy depuis overview' });
      const ok = !(r.ok === false || r.data.status === 'failed');
      toast.push({
        title: ok ? 'Déployé' : 'Échec déploiement',
        detail: r.data.git_sha || r.data.status,
        tone: ok ? 'ok' : 'danger',
      });
      const list = await api.deployments(uuid);
      onDeployments(list.data ?? []);
      try {
        const git = await api.projectGit(uuid);
        if (git.sync) setGitSync(git.sync);
      } catch {
        /* ignore */
      }
    } catch (e) {
      toast.push({ title: 'Deploy KO', detail: String(e), tone: 'danger' });
    } finally {
      setDeployBusy(false);
    }
  }

  return (
    <FadeIn>
      <div class="space-y-6">
        {/* En-tête compact avec statut et actions rapides */}
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <StatusGlyph
              project={project}
              tone={statusMeta.tone}
              busy={deployBusy || !!lifeBusy}
              label={statusMeta.label}
            />
            <div>
              <h2 class="text-lg font-medium">{statusMeta.label}</h2>
              {project.production_url && (
                <a
                  href={project.production_url}
                  target="_blank"
                  rel="noreferrer"
                  class="mt-0.5 block text-sm text-[var(--color-accent)] hover:underline"
                >
                  {project.production_url.replace(/^https?:\/\//, '')}
                </a>
              )}
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={deployBusy || !!lifeBusy || !project.git_repository}
              onClick={deployNow}
            >
              {deployBusy ? <Spinner /> : null}
              Déployer
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!!lifeBusy || deployBusy}
              onClick={() => runLifecycle('restart')}
            >
              {lifeBusy === 'restart' ? <Spinner /> : null}
              Redémarrer
            </Button>
          </div>
        </div>

        {(lifeBusy || lifeDetail) && (
          <LiveStatus
            busy={!!lifeBusy}
            label={lifeBusy ? labelAction(lifeBusy) : 'Dernière action'}
            detail={lifeDetail ?? undefined}
          />
        )}

        {/* Grid de cartes HubTile (style MCP/Home) */}
        <HubGrid cols={4}>
          {health.map((h, i) => (
            <HubTile
              key={h.key}
              index={i}
              title={h.label}
              description={h.detail}
              href={h.href}
              icon={<HealthIcon kind={h.icon} tone={h.tone} />}
              iconClass="!bg-transparent"
              badge={
                h.tone !== 'neutral' && (
                  <span
                    class={cn(
                      'absolute -right-1 -top-1 h-3 w-3 rounded-full ring-2 ring-[#1c1c1e]',
                      h.tone === 'ok' && 'bg-[var(--color-ok)]',
                      h.tone === 'warn' && 'bg-[var(--color-warn)]',
                      h.tone === 'danger' && 'bg-[var(--color-danger)]',
                    )}
                  />
                )
              }
            />
          ))}
          <HubTile
            index={health.length}
            title="Historique"
            description={`${deployments.length} déploiement${deployments.length > 1 ? 's' : ''}`}
            icon={<HealthIcon kind="deploy" tone="neutral" />}
            iconClass="!bg-transparent"
            onClick={() => setHistoryOpen(true)}
          />
        </HubGrid>
      </div>

      <Modal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="Historique des déploiements"
        description={`${deployments.length} entrée${deployments.length > 1 ? 's' : ''}`}
        size="lg"
        padded={false}
      >
        {deployments.length === 0 ? (
          <p class="px-4 py-8 text-sm text-[var(--color-ink-muted)] sm:px-5">Aucun déploiement.</p>
        ) : (
          <ul class="divide-y divide-[var(--color-line)]">
            {deployments.map((d) => (
              <li key={d.uuid} class="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <Badge tone={deployTone(d.status)}>{d.status}</Badge>
                    <span class="font-mono text-xs text-[var(--color-ink-muted)]">
                      {d.git_sha ? d.git_sha.slice(0, 7) : '—'}
                    </span>
                    <span class="text-xs text-[var(--color-ink-faint)]">
                      {formatWhen(d.created_at)}
                    </span>
                  </div>
                  <p class="mt-1 truncate text-sm text-[var(--color-ink-muted)]">
                    {d.git_message || 'Sans message'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  href={`/app/projects/view?uuid=${encodeURIComponent(uuid)}&tab=deployments`}
                >
                  Logs
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </FadeIn>
  );
}

function labelAction(a: string) {
  const map: Record<string, string> = {
    build: 'Build',
    start: 'Démarrage',
    stop: 'Arrêt',
    restart: 'Redémarrage',
  };
  return map[a] || a;
}

function StatusGlyph({
  project,
  tone,
  busy,
  label,
}: {
  project: Project;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
  busy?: boolean;
  label: string;
}) {
  const deploying = busy || tone === 'warn';
  const ringColor =
    tone === 'ok'
      ? 'border-[var(--color-ok)]/55'
      : tone === 'danger'
        ? 'border-[var(--color-danger)]/55'
        : tone === 'warn'
          ? 'border-[var(--color-warn)]/55'
          : 'border-white/20';

  return (
    <div
      class={cn(
        'relative shrink-0',
        deploying && 'df-breathe',
        tone === 'danger' && !busy && 'df-status-fail',
      )}
      title={label}
    >
      <AppIcon
        project={project}
        statusTone={tone}
        size="md"
        ringOffset="ring-offset-[var(--color-card)]"
      />

      {tone === 'ok' && !deploying && (
        <span
          class={cn(
            'pointer-events-none absolute -inset-1 rounded-[1.15rem] border df-status-live',
            ringColor,
          )}
          aria-hidden
        />
      )}
      {deploying && (
        <span
          class={cn(
            'pointer-events-none absolute -inset-1 rounded-[1.15rem] border border-dashed df-status-spin',
            ringColor,
          )}
          aria-hidden
        />
      )}
      {tone === 'danger' && !busy && (
        <span
          class={cn(
            'pointer-events-none absolute -inset-1 rounded-[1.15rem] border opacity-70',
            ringColor,
          )}
          aria-hidden
        />
      )}

      <span
        class={cn(
          'absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full ring-2 ring-[var(--color-card)]',
          statusDotClass(tone),
          (tone === 'ok' || deploying) && 'animate-pulse',
        )}
        aria-hidden
      />
    </div>
  );
}

function HealthIcon({
  kind,
  tone,
}: {
  kind: 'deploy' | 'pulse' | 'db' | 'env' | 'git' | 'globe' | 'actions';
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
}) {
  const color =
    tone === 'ok'
      ? 'text-[var(--color-ok)] bg-[var(--color-ok)]/10'
      : tone === 'danger'
        ? 'text-[var(--color-danger)] bg-[var(--color-danger)]/10'
        : tone === 'warn'
          ? 'text-[var(--color-warn)] bg-[var(--color-warn)]/10'
          : 'text-[var(--color-ink-muted)] bg-white/5';
  const paths: Record<string, ComponentChildren> = {
    deploy: <path d="M12 2v14M7 11l5 5 5-5M5 20h14" />,
    pulse:
      tone === 'danger' ? (
        <path d="M12 8v4M12 16h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      ) : (
        <path d="M22 12h-4l-3 7-6-14-3 7H2" />
      ),
    db: (
      <>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
      </>
    ),
    env: (
      <>
        <path d="M4 6h16M4 12h10M4 18h14" />
      </>
    ),
    git: (
      <>
        <circle cx="6" cy="6" r="2" />
        <circle cx="18" cy="18" r="2" />
        <circle cx="6" cy="18" r="2" />
        <path d="M6 8v8M6 12c4 0 8 2 10 4" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </>
    ),
    actions: (
      <>
        <path d="M13 2 4 14h7l-1 8 10-14h-7l1-6z" />
      </>
    ),
  };
  return (
    <span
      class={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${color} transition-colors`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        {paths[kind]}
      </svg>
    </span>
  );
}

function DeploymentsPanel({
  projectUuid,
  initial,
  onRefresh,
}: {
  projectUuid: string;
  initial: Deployment[];
  onRefresh: (d: Deployment[]) => void;
}) {
  const toast = useToast();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [openLogs, setOpenLogs] = useState<string | null>(null);
  const [logs, setLogs] = useState('');

  useEffect(() => {
    setItems(initial);
  }, [initial]);

  async function reload() {
    const r = await api.deployments(projectUuid);
    setItems(r.data);
    onRefresh(r.data);
  }

  async function deploy() {
    setBusy(true);
    toast.push({ title: 'Deploy…', detail: 'Clone + build en cours', tone: 'info' });
    try {
      const r = await api.createDeployment(projectUuid, { git_message: 'Manual deploy' });
      toast.push({
        title: r.ok === false || r.data.status === 'failed' ? 'Deploy échoué' : 'Deploy terminé',
        detail: r.data.git_sha || r.data.status,
        tone: r.data.status === 'failed' ? 'danger' : 'ok',
      });
      setOpenLogs(r.data.uuid);
      setLogs(r.data.logs || '');
      await reload();
    } catch (e) {
      toast.push({ title: 'Deploy KO', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function showLogs(depUuid: string) {
    setOpenLogs(depUuid);
    const row = items.find((d) => d.uuid === depUuid);
    if (row?.logs) {
      setLogs(row.logs);
      return;
    }
    try {
      const r = await api.deployment(depUuid);
      setLogs(r.data.logs || '');
    } catch {
      setLogs('(logs indisponibles)');
    }
  }

  return (
    <FadeIn>
      <Card>
        <CardHeader
          title="Deployments"
          action={
            <Button size="sm" variant="secondary" disabled={busy} onClick={deploy}>
              {busy ? <Spinner /> : null}
              Déployer
            </Button>
          }
        />
        {items.length === 0 ? (
          <p class="text-sm text-[var(--color-ink-muted)]">
            Aucun déploiement — lance un Deploy pour cloner et builder.
          </p>
        ) : (
          <Table headers={['SHA', 'Message', 'Status', '']}>
            {items.map((d) => (
              <Tr key={d.uuid}>
                <Td class="font-mono text-xs">{d.git_sha}</Td>
                <Td>{d.git_message}</Td>
                <Td>
                  <Badge tone={deployTone(d.status)}>{d.status}</Badge>
                </Td>
                <Td>
                  <Button size="sm" variant="ghost" onClick={() => showLogs(d.uuid)}>
                    Logs
                  </Button>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
        {openLogs && (
          <pre class="mt-4 max-h-80 overflow-auto rounded-xl border border-[var(--color-line)] bg-black/40 p-3 font-mono text-xs whitespace-pre-wrap">
            {logs || '…'}
          </pre>
        )}
      </Card>
    </FadeIn>
  );
}

function BackupsPanel({ projectUuid }: { projectUuid: string }) {
  const toast = useToast();
  const [items, setItems] = useState<
    Array<{
      id: string;
      kind: string;
      status: string;
      size_bytes: number;
      message: string;
      storage_key?: string | null;
    }>
  >([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await api.backups(projectUuid);
    setItems(r.backups ?? []);
  }

  useEffect(() => {
    load().catch((e) => toast.push({ title: 'Backups KO', detail: String(e), tone: 'warn' }));
  }, [projectUuid]);

  async function create() {
    setBusy(true);
    toast.push({ title: 'Backup…', detail: 'Snapshot en cours', tone: 'info' });
    try {
      const r = await api.createBackup(projectUuid, 'full');
      toast.push({
        title: r.ok ? 'Backup OK' : 'Backup échoué',
        detail: r.backup?.message,
        tone: r.ok ? 'ok' : 'danger',
      });
      await load();
    } catch (e) {
      toast.push({ title: 'Backup KO', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function preview(id: string) {
    const r = await api.restorePreview(projectUuid, id);
    toast.push({
      title: 'Restore preview',
      detail: (r.steps ?? []).join(' → '),
      tone: 'info',
    });
  }

  return (
    <FadeIn>
      <Card>
        <CardHeader
          title="Backups"
          action={
            <Button size="sm" variant="secondary" disabled={busy} onClick={create}>
              {busy ? <Spinner /> : null}
              Nouveau backup
            </Button>
          }
        />
        {items.length === 0 ? (
          <p class="text-sm text-[var(--color-ink-muted)]">Aucun backup.</p>
        ) : (
          <ul class="divide-y divide-[var(--color-line)]">
            {items.map((b) => (
              <li key={b.id} class="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <div class="font-mono text-xs">{b.id}</div>
                  <div class="text-xs text-[var(--color-ink-muted)]">{b.message}</div>
                </div>
                <div class="flex items-center gap-2">
                  <Badge tone={b.status === 'completed' ? 'ok' : 'warn'}>{b.status}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => preview(b.id)}>
                    Preview
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </FadeIn>
  );
}

function DatabasePanel({ uuid }: { uuid: string }) {
  return (
    <FadeIn>
      <DatabaseManager uuid={uuid} />
    </FadeIn>
  );
}

function DatabaseManager({ uuid }: { uuid: string }) {
  const toast = useToast();
  const [servers, setServers] = useState<
    Array<{ id: string; name: string; catalog_id?: string | null }>
  >([]);
  const [serverId, setServerId] = useState('');
  const [dbs, setDbs] = useState<
    Array<{ name: string; db_id?: string | null; hostname: string }>
  >([]);
  const [links, setLinks] = useState<
    Array<{ id: string; provider: string; resource_name: string }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  async function refreshMeta() {
    try {
      const [s, l] = await Promise.all([api.mcpServers(), api.projectResources(uuid)]);
      const turso = (s.data ?? []).filter((x) => x.catalog_id === 'turso');
      setServers(turso);
      setLinks((l.data ?? []).filter((x) => x.provider === 'turso'));
      if (turso[0] && !serverId) setServerId(turso[0].id);
      else if (turso[0] && !turso.some((t) => t.id === serverId)) setServerId(turso[0].id);
    } catch {
      setServers([]);
    } finally {
      setReady(true);
    }
  }

  useEffect(() => {
    refreshMeta();
  }, [uuid]);

  useEffect(() => {
    if (!open || !serverId) {
      setDbs([]);
      return;
    }
    setBusy(true);
    setListError(null);
    api
      .mcpResources(serverId)
      .then((r) => setDbs(r.data ?? []))
      .catch((e) => {
        setDbs([]);
        setListError(String((e as Error).message || e));
      })
      .finally(() => setBusy(false));
  }, [open, serverId]);

  async function linkDb(db: { name: string; db_id?: string | null; hostname: string }) {
    if (!serverId) return;
    setBusy(true);
    try {
      const r = await api.linkProjectResource(uuid, {
        server_id: serverId,
        resource_id: db.db_id || db.name,
        resource_name: db.name,
        hostname: db.hostname,
      });
      toast.push({
        title: `DB ${r.database} liée`,
        detail: r.env_keys.join(', '),
        tone: 'ok',
      });
      setOpen(false);
      await refreshMeta();
    } catch (err) {
      toast.push({ title: 'Lien KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function unlink(id: string) {
    setBusy(true);
    try {
      await api.unlinkProjectResource(uuid, id);
      toast.push({ title: 'Lien retiré', tone: 'info' });
      await refreshMeta();
    } catch (err) {
      toast.push({ title: 'Unlink KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <p class="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
        <Spinner /> Chargement…
      </p>
    );
  }

  return (
    <>
      {links.length > 0 ? (
        <ul class="mb-4 divide-y divide-[var(--color-line)] rounded-xl border border-[var(--color-line)]">
          {links.map((l) => (
            <li key={l.id} class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <Badge tone="ok">turso</Badge>
                  <span class="font-medium">{l.resource_name}</span>
                </div>
                <p class="mt-1 text-xs text-[var(--color-ink-muted)]">Liée à ce projet</p>
              </div>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => unlink(l.id)}>
                Délier
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p class="mb-4 rounded-xl border border-dashed border-[var(--color-line)] px-4 py-6 text-sm text-[var(--color-ink-muted)]">
          Aucune base liée. Connecte Turso via MCP puis lie une database ici.
        </p>
      )}

      {servers.length > 0 && servers.some(s => s.oauth_connected) && links.length === 0 && (
        <Alert tone="ok" class="mb-4 text-xs">
          <p class="font-medium">✓ Turso OAuth connecté</p>
          <p class="mt-1 text-[var(--color-ink-muted)]">
            Tu peux maintenant lier tes bases de données Turso à ce projet via OAuth, sans Platform API token.
          </p>
        </Alert>
      )}

      <div class="flex flex-wrap gap-2">
        {servers.length > 0 ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Lier une base Turso
          </Button>
        ) : (
          <Button size="sm" variant="outline" href="/app/mcp">
            Configurer Turso (MCP)
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          href={`/app/projects/view?uuid=${encodeURIComponent(uuid)}&tab=env`}
        >
          Voir les variables d’env
        </Button>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Lier une base Turso"
        description="Injecte TURSO_DATABASE_URL, TURSO_AUTH_TOKEN et DATABASE_URL."
        size="lg"
      >
        {servers.length > 1 && (
          <label class="mb-3 flex flex-col gap-1.5 text-sm">
            <span class="font-medium">Compte Turso</span>
            <select
              class="h-10 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3"
              value={serverId}
              onChange={(e) => setServerId((e.target as HTMLSelectElement).value)}
            >
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div>
          {listError && (
            <Alert tone="warn" class="mb-3">
              {listError}
            </Alert>
          )}
          {busy && dbs.length === 0 && !listError ? (
            <p class="text-sm text-[var(--color-ink-muted)]">Chargement des bases…</p>
          ) : (
            <ul class="divide-y divide-[var(--color-line)] text-sm">
              {dbs.map((db) => (
                <li key={db.name} class="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <div class="min-w-0">
                    <div class="break-all font-medium">{db.name}</div>
                    <div class="truncate font-mono text-xs text-[var(--color-ink-muted)]">
                      {db.hostname}
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => linkDb(db)}>
                    Lier
                  </Button>
                </li>
              ))}
              {!busy && dbs.length === 0 && !listError && (
                <li class="py-2 text-[var(--color-ink-muted)]">Aucune base trouvée.</li>
              )}
            </ul>
          )}
        </div>
      </Modal>
    </>
  );
}

function EnvPanel({ uuid }: { uuid: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<Array<{ key: string; value: string; secret: boolean }>>([]);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [dotenv, setDotenv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editSecret, setEditSecret] = useState(true);
  const [reveal, setReveal] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await api.envList(uuid);
      setRows(r.data ?? []);
      setError(null);
    } catch (e: unknown) {
      setError(String((e as Error).message || e));
    }
  }

  useEffect(() => {
    load();
  }, [uuid]);

  async function add(e: Event) {
    e.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    try {
      await api.envUpsert(uuid, { key: key.trim(), value, secret: true });
      setKey('');
      setValue('');
      toast.push({ title: 'Variable ajoutée', detail: key.trim(), tone: 'ok' });
      await load();
    } catch (err) {
      setError(String((err as Error).message || err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(k: string) {
    setBusy(true);
    try {
      await api.envDelete(uuid, k);
      toast.push({ title: 'Supprimée', detail: k, tone: 'info' });
      if (editKey === k) closeEdit();
      await load();
    } catch (err) {
      toast.push({ title: 'Delete KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function openEdit(k: string) {
    setEditKey(k);
    setEditValue('');
    setReveal(false);
    setEditLoading(true);
    try {
      const r = await api.envGet(uuid, k);
      setEditValue(r.data.value);
      setEditSecret(r.data.secret);
    } catch (err) {
      toast.push({ title: 'Lecture KO', detail: String(err), tone: 'danger' });
      setEditKey(null);
    } finally {
      setEditLoading(false);
    }
  }

  function closeEdit() {
    setEditKey(null);
    setEditValue('');
    setReveal(false);
  }

  async function saveEdit(e: Event) {
    e.preventDefault();
    if (!editKey) return;
    setBusy(true);
    try {
      await api.envUpsert(uuid, {
        key: editKey,
        value: editValue,
        secret: editSecret,
      });
      toast.push({ title: 'Variable mise à jour', detail: editKey, tone: 'ok' });
      closeEdit();
      await load();
    } catch (err) {
      toast.push({ title: 'Save KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function runImport(e?: Event) {
    e?.preventDefault();
    if (!dotenv.trim()) return;
    setBusy(true);
    try {
      const r = await api.envImport(uuid, dotenv, true);
      toast.push({
        title: 'Import .env',
        detail: `${r.imported} importées, ${r.skipped} ignorées`,
        tone: 'ok',
      });
      setDotenv('');
      setFileName(null);
      setImportOpen(false);
      await load();
    } catch (err) {
      toast.push({ title: 'Import KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = await file.text();
    setDotenv(text);
    setFileName(file.name);
  }

  function closeImport() {
    setImportOpen(false);
    setDotenv('');
    setFileName(null);
  }

  return (
    <div class="space-y-4">
      {error && (
        <Alert tone="warn" class="mb-3">
          {error}
        </Alert>
      )}
      <FadeIn>
        <Card>
          <CardHeader
            title="Variables"
            description="Clique une variable pour la voir ou la modifier."
            action={
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                Importer .env
              </Button>
            }
          />
          <form class="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end" onSubmit={add}>
            <div class="w-full sm:w-40 sm:shrink-0">
              <Input
                placeholder="KEY"
                value={key}
                onInput={(ev) => setKey((ev.target as HTMLInputElement).value)}
              />
            </div>
            <div class="min-w-0 w-full flex-1">
              <Input
                placeholder="value"
                value={value}
                onInput={(ev) => setValue((ev.target as HTMLInputElement).value)}
              />
            </div>
            <Button type="submit" variant="secondary" disabled={busy} class="w-full sm:w-auto">
              Ajouter
            </Button>
          </form>
          <ul class="divide-y divide-[var(--color-line)] text-sm">
            {rows.map((r) => (
              <li key={r.key} class="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <button
                  type="button"
                  class="min-w-0 flex-1 text-left hover:opacity-90"
                  onClick={() => openEdit(r.key)}
                >
                  <span class="break-all font-mono">{r.key}</span>
                  <span class="ml-3 break-all text-[var(--color-ink-muted)]">
                    {r.secret ? '••••••••' : r.value}
                  </span>
                </button>
                <div class="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => openEdit(r.key)}>
                    Modifier
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove(r.key)}>
                    Supprimer
                  </Button>
                </div>
              </li>
            ))}
            {rows.length === 0 && (
              <li class="py-2 text-[var(--color-ink-muted)]">Aucune variable.</li>
            )}
          </ul>
        </Card>
      </FadeIn>

      <Modal
        open={!!editKey}
        onClose={closeEdit}
        title={editKey ? `Variable · ${editKey}` : 'Variable'}
        description="Valeur réelle chargée depuis le serveur."
        size="md"
        footer={
          !editLoading ? (
            <div class="flex w-full flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={() => editKey && remove(editKey)}
              >
                Supprimer
              </Button>
              <div class="flex gap-2">
                <Button type="button" variant="ghost" onClick={closeEdit}>
                  Annuler
                </Button>
                <Button type="submit" form="env-edit-form" variant="secondary" disabled={busy}>
                  {busy ? 'Enregistrement…' : 'Enregistrer'}
                </Button>
              </div>
            </div>
          ) : null
        }
      >
        {editLoading ? (
          <p class="text-sm text-[var(--color-ink-muted)]">Chargement…</p>
        ) : (
          <form id="env-edit-form" class="space-y-4" onSubmit={saveEdit}>
            <div class="relative">
              <div class="mb-1.5 flex items-center justify-between gap-2">
                <span class="text-sm font-medium">Valeur</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setReveal((v) => !v)}
                >
                  {reveal ? 'Masquer' : 'Afficher'}
                </Button>
              </div>
              {reveal ? (
                <textarea
                  class="min-h-[120px] max-h-[40dvh] w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 font-mono text-xs"
                  value={editValue}
                  onInput={(ev) => setEditValue((ev.target as HTMLTextAreaElement).value)}
                />
              ) : (
                <Input
                  type="password"
                  value={editValue}
                  onInput={(ev) => setEditValue((ev.target as HTMLInputElement).value)}
                  autocomplete="off"
                />
              )}
            </div>
            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editSecret}
                onChange={(e) => setEditSecret((e.target as HTMLInputElement).checked)}
              />
              Secret (masqué dans la liste)
            </label>
          </form>
        )}
      </Modal>

      <Modal
        open={importOpen}
        onClose={closeImport}
        title="Importer un fichier .env"
        description="Choisis un fichier ou colle le contenu — les clés existantes seront écrasées."
        size="lg"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={closeImport}>
              Annuler
            </Button>
            <Button
              type="submit"
              form="env-import-form"
              variant="secondary"
              disabled={busy || !dotenv.trim()}
            >
              {busy ? 'Import…' : 'Importer'}
            </Button>
          </>
        }
      >
        <form id="env-import-form" class="space-y-4" onSubmit={runImport}>
          <label class="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--color-line)] px-3 py-2 text-sm hover:bg-white/5">
            <input
              type="file"
              accept=".env,text/plain,.env.*"
              class="hidden"
              onChange={onFile}
            />
            Choisir un fichier
          </label>
          {fileName && (
            <p class="text-xs text-[var(--color-ink-muted)]">Fichier : {fileName}</p>
          )}
          <textarea
            class="min-h-[120px] max-h-[45dvh] w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 font-mono text-xs"
            placeholder={'FOO=bar\nSECRET=…'}
            value={dotenv}
            onInput={(ev) => {
              setDotenv((ev.target as HTMLTextAreaElement).value);
              setFileName(null);
            }}
          />
        </form>
      </Modal>
    </div>
  );
}

function DomainsPanel({
  uuid,
  project,
  onProjectUpdate,
}: {
  uuid: string;
  project: Project | null;
  onProjectUpdate: (p: Project) => void;
}) {
  const toast = useToast();
  const [items, setItems] = useState<
    Array<{ id: string; fqdn: string; tls: boolean; status: string; is_primary?: boolean }>
  >([]);
  const [primaryFqdn, setPrimaryFqdn] = useState('');
  const [fqdn, setFqdn] = useState('');
  const [asPrimary, setAsPrimary] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await api.domains(uuid);
    const list = r.domains ?? r.data ?? [];
    setItems(list);
    const fromApi =
      r.primary_fqdn ||
      list.find((d) => d.is_primary)?.fqdn ||
      (project?.production_url || '')
        .replace(/^https?:\/\//, '')
        .split('/')[0] ||
      '';
    setPrimaryFqdn(fromApi);
  }

  useEffect(() => {
    load().catch((e) => toast.push({ title: 'Domains KO', detail: String(e), tone: 'warn' }));
  }, [uuid]);

  async function savePrimary(e: Event) {
    e.preventDefault();
    const host = primaryFqdn.trim().replace(/^https?:\/\//, '').split('/')[0];
    if (!host || !host.includes('.')) {
      toast.push({ title: 'FQDN invalide', detail: 'ex. app.example.com', tone: 'warn' });
      return;
    }
    setBusy(true);
    try {
      const r = await api.setPrimaryDomainFqdn(uuid, host);
      toast.push({ title: 'Domaine principal', detail: r.primary_fqdn, tone: 'ok' });
      const p = await api.project(uuid);
      onProjectUpdate(p.data);
      await load();
    } catch (err) {
      toast.push({ title: 'Principal KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function attach(e: Event) {
    e.preventDefault();
    if (!fqdn.trim()) return;
    setBusy(true);
    try {
      await api.attachDomain(uuid, {
        fqdn: fqdn.trim(),
        tls: true,
        primary: asPrimary,
      });
      setFqdn('');
      toast.push({
        title: asPrimary ? 'Domaine principal défini' : 'Domaine ajouté',
        tone: 'ok',
      });
      if (asPrimary) {
        const p = await api.project(uuid);
        onProjectUpdate(p.data);
      }
      await load();
    } catch (err) {
      toast.push({ title: 'Attach KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function makePrimary(id: string) {
    setBusy(true);
    try {
      const r = await api.setPrimaryDomain(uuid, id);
      toast.push({ title: 'Domaine principal', detail: r.primary_fqdn, tone: 'ok' });
      const p = await api.project(uuid);
      onProjectUpdate(p.data);
      await load();
    } catch (err) {
      toast.push({ title: 'Principal KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function detach(id: string) {
    setBusy(true);
    try {
      await api.detachDomain(uuid, id);
      const p = await api.project(uuid);
      onProjectUpdate(p.data);
      await load();
    } catch (err) {
      toast.push({ title: 'Detach KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <FadeIn>
      <div class="space-y-4">
        <Card>
          <CardHeader
            title="Domaine principal"
            description="URL publique de l’app (production). Un FQDN saisi manuellement devient principal par défaut."
          />
          <form class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end" onSubmit={savePrimary}>
            <div class="min-w-0 w-full flex-1">
              <Input
                label="FQDN principal"
                placeholder="app.example.com"
                value={primaryFqdn}
                onInput={(e) => setPrimaryFqdn((e.target as HTMLInputElement).value)}
                hint={
                  primaryFqdn.trim()
                    ? `https://${primaryFqdn.trim().replace(/^https?:\/\//, '').split('/')[0]}`
                    : undefined
                }
              />
            </div>
            <Button type="submit" size="sm" variant="secondary" disabled={busy} class="w-full sm:w-auto">
              Enregistrer
            </Button>
          </form>
        </Card>

        <Card>
          <CardHeader
            title="Domains"
            description="Aliases + sous-domaine auto. L’ajout manuel est principal par défaut."
          />
          <form class="mb-4 space-y-3" onSubmit={attach}>
            <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
              <div class="min-w-0 w-full flex-1">
                <Input
                  placeholder="autre.example.com"
                  value={fqdn}
                  onInput={(e) => setFqdn((e.target as HTMLInputElement).value)}
                />
              </div>
              <Button type="submit" size="sm" variant="secondary" disabled={busy} class="w-full sm:w-auto">
                Attacher
              </Button>
            </div>
            <label class="flex items-center gap-2 text-sm text-[var(--color-ink-muted)]">
              <input
                type="checkbox"
                checked={asPrimary}
                onChange={(e) => setAsPrimary((e.target as HTMLInputElement).checked)}
              />
              Définir comme domaine principal
            </label>
          </form>
          <ul class="divide-y divide-[var(--color-line)]">
            {items.map((d) => (
              <li key={d.id} class="flex flex-col gap-2 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2 font-medium">
                    <span class="break-all">{d.fqdn}</span>
                    {d.is_primary && <Badge tone="ok">Principal</Badge>}
                  </div>
                  <div class="text-xs text-[var(--color-ink-muted)]">
                    {d.tls ? 'TLS' : 'HTTP'} · {d.status}
                  </div>
                </div>
                <div class="flex shrink-0 gap-1">
                  {!d.is_primary && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => makePrimary(d.id)}
                    >
                      Principal
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => detach(d.id)}>
                    Retirer
                  </Button>
                </div>
              </li>
            ))}
            {items.length === 0 && (
              <li class="py-2 text-sm text-[var(--color-ink-muted)]">Aucun domaine.</li>
            )}
          </ul>
        </Card>
      </div>
    </FadeIn>
  );
}

function ssoModeFromProject(project: Project): 'auto' | 'on' | 'off' {
  if (project.is_sso_protected === true || project.is_sso_protected === 1) return 'on';
  if (project.is_sso_protected === false || project.is_sso_protected === 0) return 'off';
  return 'auto';
}

function parseGithubOwnerRepo(url: string): { owner: string; repo: string } | null {
  const cleaned = url
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^git@github\.com:/i, '');
  const parts = cleaned.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[0], repo: parts[1].replace(/\.git$/i, '') };
}

function ProjectSettingsPanel({
  project,
  onSaved,
}: {
  project: Project;
  onSaved: (p: Project) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(project.name);
  const [branch, setBranch] = useState(project.git_branch || 'main');
  const [repo, setRepo] = useState(project.git_repository || '');
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [buildPack, setBuildPack] = useState(project.build_pack || 'nixpacks');
  const [port, setPort] = useState(Number(project.port ?? 3000));
  const [isStatic, setIsStatic] = useState(Boolean(project.is_static));
  const [ssoProtection, setSsoProtection] = useState<'auto' | 'on' | 'off'>(() =>
    ssoModeFromProject(project),
  );
  const [ownUserSystem, setOwnUserSystem] = useState(
    project.has_own_user_system === true || project.has_own_user_system === 1,
  );
  const [publishDir, setPublishDir] = useState(project.publish_directory || '');
  const [baseDir, setBaseDir] = useState(project.base_directory || '/');
  const [composePath, setComposePath] = useState(project.docker_compose_location || '');
  const [workdir, setWorkdir] = useState(project.workdir || '');
  const [prodUrl, setProdUrl] = useState(project.production_url || '');
  const [testCmd, setTestCmd] = useState(project.test_command || '');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [detectInfo, setDetectInfo] = useState<string | null>(null);

  useEffect(() => {
    setName(project.name);
    setBranch(project.git_branch || 'main');
    setRepo(project.git_repository || '');
    setBranches([]);
    setBuildPack(project.build_pack || 'nixpacks');
    setPort(Number(project.port ?? 3000));
    setIsStatic(Boolean(project.is_static));
    setSsoProtection(ssoModeFromProject(project));
    setOwnUserSystem(project.has_own_user_system === true || project.has_own_user_system === 1);
    setPublishDir(project.publish_directory || '');
    setBaseDir(project.base_directory || '/');
    setComposePath(project.docker_compose_location || '');
    setWorkdir(project.workdir || '');
    setProdUrl(project.production_url || '');
    setTestCmd(project.test_command || '');
    setConfirmDelete(false);
    setDetectInfo(null);
  }, [project.uuid]);

  useEffect(() => {
    const parsed = parseGithubOwnerRepo(repo);
    if (!parsed) {
      setBranches([]);
      setBranchesLoading(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setBranchesLoading(true);
      api
        .githubBranches(parsed.owner, parsed.repo)
        .then((r) => {
          if (cancelled) return;
          setBranches(r.data.map((b) => b.name));
        })
        .catch(() => {
          if (cancelled) return;
          setBranches([]);
        })
        .finally(() => {
          if (!cancelled) setBranchesLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [repo]);

  async function save(e: Event) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.updateProject(project.uuid, {
        name: name.trim(),
        git_branch: branch.trim(),
        git_repository: repo.trim() || null,
        build_pack: buildPack,
        port,
        is_static: isStatic,
        sso_protection: ssoProtection,
        has_own_user_system: ownUserSystem,
        publish_directory: publishDir.trim() || null,
        base_directory: baseDir.trim() || '/',
        docker_compose_location: composePath.trim() || null,
        workdir: workdir.trim() || null,
        production_url: prodUrl.trim() || null,
        test_command: testCmd.trim() || null,
      });
      onSaved(r.data);
      toast.push({ title: 'Settings enregistrés', tone: 'ok' });
    } catch (err) {
      toast.push({ title: 'Save KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function runDetect() {
    setBusy(true);
    try {
      const r = await api.projectDetect(project.uuid, { apply: true, from_github: true });
      const d = r.detection;
      setBuildPack(d.build_pack);
      setPort(d.port);
      setIsStatic(d.is_static);
      setPublishDir(d.publish_directory || '');
      setBaseDir(d.base_directory || '/');
      setComposePath(d.docker_compose_location || '');
      if (d.test_command) setTestCmd(d.test_command);
      setDetectInfo(
        `${d.label} (${Math.round(d.confidence * 100)}%) · ${d.build_pack} · port ${d.port}`,
      );
      onSaved(r.project);
      toast.push({
        title: 'Framework détecté',
        detail: d.label,
        tone: 'ok',
      });
    } catch (err) {
      toast.push({ title: 'Détection KO', detail: String(err), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function removeProject() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    try {
      await api.deleteProject(project.uuid);
      toast.push({ title: 'Projet supprimé', detail: project.name, tone: 'ok' });
      window.location.href = '/app/projects';
    } catch (err) {
      toast.push({ title: 'Suppression KO', detail: String(err), tone: 'danger' });
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <FadeIn>
      <Card>
        <CardHeader
          title="Configuration"
          description="Build, runtime et Git (post-création)."
          action={
            <Button size="sm" variant="outline" disabled={busy} onClick={runDetect}>
              Détecter le framework
            </Button>
          }
        />
        {detectInfo && (
          <Alert tone="ok" class="mb-3">
            {detectInfo}
          </Alert>
        )}
        <form class="grid gap-3 md:grid-cols-2" onSubmit={save}>
          <Input label="Nom" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          {branches.length > 0 ? (
            <label class="flex flex-col gap-1.5 text-sm">
              <span class="font-medium">Branche</span>
              <select
                class="h-10 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3"
                value={branch}
                disabled={busy || branchesLoading}
                onChange={(e) => setBranch((e.target as HTMLSelectElement).value)}
              >
                {(branches.includes(branch) ? branches : [branch, ...branches]).map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <Input
              label={branchesLoading ? 'Branche (chargement…)' : 'Branche'}
              value={branch}
              onInput={(e) => setBranch((e.target as HTMLInputElement).value)}
            />
          )}
          <div class="md:col-span-2">
            <Input
              label="Repository"
              value={repo}
              onInput={(e) => setRepo((e.target as HTMLInputElement).value)}
            />
          </div>
          <label class="flex flex-col gap-1.5 text-sm">
            <span class="font-medium">Build pack</span>
            <select
              class="h-10 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3"
              value={buildPack}
              onChange={(e) => setBuildPack((e.target as HTMLSelectElement).value)}
            >
              {['nixpacks', 'dockerfile', 'dockercompose', 'static'].map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <Input
            label="Port"
            type="number"
            value={String(port)}
            onInput={(e) => setPort(Number((e.target as HTMLInputElement).value) || 80)}
          />
          <label class="flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              checked={isStatic}
              onChange={(e) => setIsStatic((e.target as HTMLInputElement).checked)}
            />
            Static site
          </label>
          <label class="flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              checked={ownUserSystem}
              onChange={(e) => {
                const v = (e.target as HTMLInputElement).checked;
                setOwnUserSystem(v);
                if (v) setSsoProtection('off');
              }}
            />
            App avec son propre login (pas de barrière Traefik SSO)
          </label>
          <label class="flex flex-col gap-1.5 text-sm md:col-span-2">
            <span class="font-medium">Protection SSO Traefik</span>
            <select
              class="h-10 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3"
              value={ssoProtection}
              disabled={ownUserSystem}
              onChange={(e) =>
                setSsoProtection((e.target as HTMLSelectElement).value as 'auto' | 'on' | 'off')
              }
            >
              <option value="auto">Auto (réglage instance)</option>
              <option value="on">Toujours protégé</option>
              <option value="off">Jamais protégé</option>
            </select>
          </label>
          <Input
            label="Publish directory"
            value={publishDir}
            onInput={(e) => setPublishDir((e.target as HTMLInputElement).value)}
          />
          <Input
            label="Base directory"
            value={baseDir}
            onInput={(e) => setBaseDir((e.target as HTMLInputElement).value)}
          />
          <Input
            label="Docker compose path"
            value={composePath}
            onInput={(e) => setComposePath((e.target as HTMLInputElement).value)}
          />
          <Input
            label="Workdir"
            value={workdir}
            onInput={(e) => setWorkdir((e.target as HTMLInputElement).value)}
          />
          <Input
            label="Production URL"
            value={prodUrl}
            onInput={(e) => setProdUrl((e.target as HTMLInputElement).value)}
          />
          <Input
            label="Test command"
            value={testCmd}
            onInput={(e) => setTestCmd((e.target as HTMLInputElement).value)}
          />
          <div class="md:col-span-2">
            <Button type="submit" disabled={busy}>
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
        </form>
      </Card>

      <Card class="mt-4 border-[var(--color-danger)]/30">
        <CardHeader
          title="Zone dangereuse"
          description="Supprime le projet, ses env, agents et déploiements. Irréversible."
        />
        {confirmDelete && (
          <Alert tone="danger" class="mb-3">
            Confirme la suppression de « {project.name} ».
          </Alert>
        )}
        <div class="flex flex-wrap gap-2">
          <Button variant="danger" size="sm" disabled={busy} onClick={removeProject}>
            {confirmDelete ? 'Confirmer la suppression' : 'Supprimer le projet'}
          </Button>
          {confirmDelete && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirmDelete(false)}
            >
              Annuler
            </Button>
          )}
        </div>
      </Card>
    </FadeIn>
  );
}


function CronsPanel({ projectUuid }: { projectUuid: string }) {
  const toast = useToast();
  const [crons, setCrons] = useState<import('../lib/api').ProjectCron[]>([]);
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [cronExpr, setCronExpr] = useState('');
  const [command, setCommand] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [runsOpen, setRunsOpen] = useState<string | null>(null);
  const [runs, setRuns] = useState<import('../lib/api').CronRun[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState('');

  async function load() {
    try {
      const r = await api.cronsList(projectUuid);
      setCrons(r.data);
    } catch (e) {
      toast.push({ title: 'Erreur chargement crons', detail: String(e), tone: 'warn' });
    }
  }

  useEffect(() => {
    load();
  }, [projectUuid]);

  function openCreate() {
    setEditingId(null);
    setName('');
    setCronExpr('');
    setCommand('');
    setEnabled(true);
    setSelectedPreset('');
    setShowAdvanced(false);
    setFormOpen(true);
  }

  async function openEdit(cron: import('../lib/api').ProjectCron) {
    setEditingId(cron.id);
    setName(cron.name);
    setCronExpr(cron.cron_expression);
    setCommand(cron.command);
    setEnabled(cron.enabled === 1);
    
    // Check if it matches a preset
    const { CRON_PRESETS } = await import('../lib/cron-utils');
    const matchingPreset = CRON_PRESETS.find(p => p.value === cron.cron_expression);
    setSelectedPreset(matchingPreset ? cron.cron_expression : '');
    setShowAdvanced(!matchingPreset || matchingPreset.value === '');
    
    setFormOpen(true);
  }

  async function save(e: Event) {
    e.preventDefault();
    if (!name.trim() || !cronExpr.trim() || !command.trim()) return;
    setBusy(true);
    try {
      if (editingId) {
        await api.cronUpdate(projectUuid, editingId, {
          name: name.trim(),
          cron_expression: cronExpr.trim(),
          command: command.trim(),
          enabled,
        });
        toast.push({ title: 'Cron mis à jour', tone: 'ok' });
      } else {
        await api.cronCreate(projectUuid, {
          name: name.trim(),
          cron_expression: cronExpr.trim(),
          command: command.trim(),
          enabled,
        });
        toast.push({ title: 'Cron créé', tone: 'ok' });
      }
      setFormOpen(false);
      await load();
    } catch (e) {
      toast.push({ title: 'Erreur', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await api.cronDelete(projectUuid, id);
      toast.push({ title: 'Cron supprimé', tone: 'info' });
      await load();
    } catch (e) {
      toast.push({ title: 'Erreur suppression', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(cron: import('../lib/api').ProjectCron) {
    setBusy(true);
    try {
      if (cron.enabled) {
        await api.cronDisable(projectUuid, cron.id);
      } else {
        await api.cronEnable(projectUuid, cron.id);
      }
      await load();
    } catch (e) {
      toast.push({ title: 'Erreur', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function runNow(id: string) {
    setBusy(true);
    try {
      const r = await api.cronRunNow(projectUuid, id);
      toast.push({ title: r.message, tone: 'info' });
    } catch (e) {
      toast.push({ title: 'Erreur', detail: String(e), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function showRuns(cronId: string) {
    setRunsOpen(cronId);
    try {
      const r = await api.cronRuns(projectUuid, cronId);
      setRuns(r.data);
    } catch {
      setRuns([]);
    }
  }

  return (
    <FadeIn>
      <Card>
        <CardHeader
          title="Tâches planifiées"
          description="Commandes exécutées automatiquement dans le conteneur du projet."
          action={
            <Button size="sm" variant="secondary" onClick={openCreate}>
              Nouveau cron
            </Button>
          }
        />
        {crons.length === 0 ? (
          <p class="text-sm text-[var(--color-ink-muted)]">Aucune tâche planifiée.</p>
        ) : (
          <Table headers={['Nom', 'Planification', 'Commande', 'Statut', '']}>
            {crons.map((c) => {
              const { cronToFrench } = require('../lib/cron-utils');
              const schedule = cronToFrench(c.cron_expression);
              return (
              <Tr key={c.id}>
                <Td class="font-medium">{c.name}</Td>
                <Td>
                  <div class="flex flex-col gap-0.5">
                    <span class="text-sm">{schedule}</span>
                    <span class="font-mono text-xs text-[var(--color-ink-faint)]" title={c.cron_expression}>
                      {c.cron_expression}
                    </span>
                  </div>
                </Td>
                <Td class="truncate max-w-xs font-mono text-xs" title={c.command}>
                  {c.command}
                </Td>
                <Td>
                  <div class="flex items-center gap-2">
                    <Badge tone={c.enabled ? 'ok' : 'neutral'}>
                      {c.enabled ? 'Activé' : 'Désactivé'}
                    </Badge>
                    {c.last_status && (
                      <Badge tone={c.last_status === 'success' ? 'ok' : 'danger'}>
                        {c.last_status}
                      </Badge>
                    )}
                  </div>
                </Td>
                <Td>
                  <div class="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => toggle(c)} disabled={busy}>
                      {c.enabled ? 'Désactiver' : 'Activer'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => runNow(c.id)} disabled={busy}>
                      Lancer
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => showRuns(c.id)}>
                      Historique
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(c)} disabled={busy}>
                      Modifier
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(c.id)} disabled={busy}>
                      Supprimer
                    </Button>
                  </div>
                </Td>
              </Tr>
              );
            })}
          </Table>
        )}
      </Card>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingId ? 'Modifier la tâche' : 'Nouvelle tâche planifiée'}
        size="lg"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setFormOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" form="cron-form" variant="secondary" disabled={busy}>
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </>
        }
      >
        <form id="cron-form" class="space-y-4" onSubmit={save}>
          <Input
            label="Nom"
            placeholder="Nettoyage cache"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
          
          <div>
            <label class="mb-1.5 block text-sm font-medium">Planification</label>
            <select
              class="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-sm"
              value={selectedPreset}
              onChange={(e) => {
                const value = (e.target as HTMLSelectElement).value;
                setSelectedPreset(value);
                if (value === '') {
                  setShowAdvanced(true);
                } else {
                  setCronExpr(value);
                  setShowAdvanced(false);
                }
              }}
            >
              {(() => {
                const { CRON_PRESETS } = require('../lib/cron-utils');
                return CRON_PRESETS.map((preset: any) => (
                  <option key={preset.label} value={preset.value}>
                    {preset.label}
                  </option>
                ));
              })()}
            </select>
            {selectedPreset && selectedPreset !== '' && (
              <p class="mt-1.5 text-xs text-[var(--color-ink-muted)]">
                Expression : <code class="font-mono">{selectedPreset}</code>
              </p>
            )}
          </div>

          {(showAdvanced || selectedPreset === '') && (
            <div>
              <div class="mb-1.5 flex items-center justify-between">
                <label class="block text-sm font-medium">Expression cron personnalisée</label>
                {!showAdvanced && (
                  <button
                    type="button"
                    class="text-xs text-[var(--color-ink-faint)] hover:underline"
                    onClick={() => setShowAdvanced(true)}
                  >
                    Avancé
                  </button>
                )}
              </div>
              <Input
                placeholder="*/5 * * * *"
                value={cronExpr}
                onInput={(e) => {
                  const val = (e.target as HTMLInputElement).value;
                  setCronExpr(val);
                  setSelectedPreset('');
                }}
                hint="Format Unix 5 champs : minute heure jour mois jour-semaine"
              />
              {cronExpr && (
                <p class="mt-1.5 text-xs text-[var(--color-ink-muted)]">
                  Aperçu : {(() => {
                    const { cronToFrench } = require('../lib/cron-utils');
                    return cronToFrench(cronExpr);
                  })()}
                </p>
              )}
            </div>
          )}
          
          <div>
            <label class="mb-1.5 block text-sm font-medium">Commande</label>
            <textarea
              class="min-h-[80px] w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 font-mono text-xs"
              placeholder="npm run cleanup"
              value={command}
              onInput={(e) => setCommand((e.target as HTMLTextAreaElement).value)}
            />
          </div>
          
          <label class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled((e.target as HTMLInputElement).checked)}
            />
            Activé
          </label>
        </form>
      </Modal>

      <Modal
        open={!!runsOpen}
        onClose={() => setRunsOpen(null)}
        title="Historique d'exécution"
        size="lg"
        padded={false}
      >
        {runs.length === 0 ? (
          <p class="px-4 py-8 text-sm text-[var(--color-ink-muted)] sm:px-5">Aucune exécution.</p>
        ) : (
          <ul class="divide-y divide-[var(--color-line)]">
            {runs.map((r) => (
              <li key={r.id} class="px-4 py-3.5 sm:px-5">
                <div class="flex flex-wrap items-center gap-2">
                  <Badge tone={r.status === 'success' ? 'ok' : r.status === 'running' ? 'warn' : 'danger'}>
                    {r.status}
                  </Badge>
                  <span class="text-xs text-[var(--color-ink-faint)]">
                    {formatWhen(r.started_at)}
                  </span>
                  {r.exit_code != null && (
                    <span class="font-mono text-xs text-[var(--color-ink-muted)]">
                      exit {r.exit_code}
                    </span>
                  )}
                </div>
                {r.output && (
                  <pre class="mt-2 max-h-40 overflow-auto rounded border border-[var(--color-line)] bg-black/20 p-2 font-mono text-xs">
                    {r.output}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </FadeIn>
  );
}
