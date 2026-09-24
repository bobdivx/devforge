import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  Activity,
  Clock,
  MessageSquare,
  Play,
  ScrollText,
  Zap,
} from 'lucide-preact';
import {
  api,
  type AgentTriggerConfig,
  type AgentTriggerType,
  type ProjectAgent,
} from '../lib/api';
import { cn } from '../lib/cn';
import { cronToFrench, CRON_PRESETS } from '../lib/cron-utils';
import {
  launchAgent,
  markLaunchedStatus,
  subscribeOpenAgent,
  syncLaunchedProjectName,
} from '../lib/launched-agents';
import { ProjectAgentsPanel } from './ProjectAgentsPanel';
import {
  Alert,
  Badge,
  Button,
  Card,
  FadeIn,
  HubAddTile,
  HubGrid,
  HubTile,
  Input,
  Modal,
  Skeleton,
  Switch,
  useToast,
} from './ui';

const ROLE_LABELS: Record<string, string> = {
  coordinator: 'Coordinateur',
  deploy: 'Déploiements',
  runner: 'Runners',
  actions: 'Actions',
  ops: 'Ops',
  crons: 'Crons',
  reviewer: 'Revue',
  custom: 'Personnalisé',
  worker: 'Worker',
};

const EVENT_OPTIONS: { value: string; label: string }[] = [
  { value: 'deploy_fail', label: 'Échec de déploiement' },
  { value: 'deploy_success', label: 'Déploiement réussi' },
  { value: 'unhealthy', label: 'Santé dégradée' },
  { value: 'unrouted', label: 'Application non routée' },
  { value: 'workflow', label: 'Workflow CI' },
  { value: 'runner', label: 'Runner GitHub' },
  { value: 'schedule', label: 'Tâche planifiée (lié crons)' },
  { value: 'webhook', label: 'Webhook' },
];

function parseConfig(raw?: string | null): AgentTriggerConfig {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as AgentTriggerConfig;
  } catch {
    return {};
  }
}

function eventLabel(event?: string): string {
  if (!event) return 'Événement';
  return EVENT_OPTIONS.find((o) => o.value === event)?.label ?? event;
}

function triggerSummary(agent: ProjectAgent): string {
  const type = (agent.trigger_type || '').trim();
  const cfg = parseConfig(agent.trigger_config);
  if (type === 'system' || agent.role === 'coordinator') {
    return 'Fil interactif (Workspace / Coordinateur)';
  }
  if (type === 'cron') {
    const expr = cfg.cron_expression?.trim();
    if (!expr) return 'Cron · non configuré';
    return `Cron · ${cronToFrench(expr)}`;
  }
  if (type === 'event') {
    return `Événement · ${eventLabel(cfg.event)}`;
  }
  return 'Sans déclencheur';
}

function statusOf(agent: ProjectAgent): { label: string; tone: 'ok' | 'warn' | 'neutral' | 'danger' } {
  if (agent.enabled === 0) return { label: 'Désactivé', tone: 'neutral' };
  if (agent.status === 'working') return { label: 'En cours', tone: 'warn' };
  if (agent.status === 'idle') return { label: 'En veille', tone: 'ok' };
  return { label: agent.status || 'Inconnu', tone: 'neutral' };
}


function statusDotClass(tone: 'ok' | 'warn' | 'danger' | 'neutral' | 'accent') {
  if (tone === 'ok') return 'bg-[var(--color-ok)]';
  if (tone === 'warn') return 'bg-[var(--color-warn)]';
  if (tone === 'danger') return 'bg-[var(--color-danger)]';
  if (tone === 'accent') return 'bg-[var(--color-accent)]';
  return 'bg-[var(--color-ink-faint)]';
}

function agentIcon(agent: ProjectAgent) {
  if (agent.role === 'coordinator' || agent.trigger_type === 'system') {
    return <MessageSquare size={28} strokeWidth={1.75} aria-hidden />;
  }
  if (agent.trigger_type === 'cron') {
    return <Clock size={28} strokeWidth={1.75} aria-hidden />;
  }
  if (agent.trigger_type === 'event') {
    return <Zap size={28} strokeWidth={1.75} aria-hidden />;
  }
  return <Activity size={28} strokeWidth={1.75} aria-hidden />;
}

function formatRelativeFr(iso?: string | null): string {
  if (!iso) return 'Jamais';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const future = diff < 0;
  const abs = Math.abs(diff);
  const sec = Math.round(abs / 1000);
  if (sec < 60) return future ? 'Dans un instant' : 'À l’instant';
  const min = Math.round(sec / 60);
  if (min < 60) return future ? `Dans ${min} min` : `Il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return future ? `Dans ${h} h` : `Il y a ${h} h`;
  const d = Math.round(h / 24);
  return future ? `Dans ${d} j` : `Il y a ${d} j`;
}

function roleLabel(role: string): string {
  return ROLE_LABELS[role] || role;
}

type CreateState = {
  name: string;
  triggerType: 'cron' | 'event';
  cronExpr: string;
  cronPreset: string;
  event: string;
  instructions: string;
};

const emptyCreate = (): CreateState => ({
  name: '',
  triggerType: 'cron',
  cronExpr: '0 9 * * 1-5',
  cronPreset: '0 9 * * 1-5',
  event: 'deploy_fail',
  instructions: '',
});

export function ProjectAgentsHub({
  projectUuid,
  projectName = '',
}: {
  projectUuid: string;
  projectName?: string;
}) {
  const toast = useToast();
  const [agents, setAgents] = useState<ProjectAgent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyUuid, setBusyUuid] = useState<string | null>(null);
  const [openChat, setOpenChat] = useState<ProjectAgent | null>(null);
  const [openActivity, setOpenActivity] = useState<ProjectAgent | null>(null);
  const [activityLines, setActivityLines] = useState<
    Array<{ role: string; content: string; created_at: string }>
  >([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<CreateState>(emptyCreate);
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const openedFromQuery = useRef(false);
  const projectNameRef = useRef(projectName);
  projectNameRef.current = projectName;

  function remember(agent: ProjectAgent) {
    launchAgent({
      uuid: agent.uuid,
      projectUuid,
      projectName,
      title: roleLabel(agent.role) || agent.name,
      role: agent.role,
      status: agent.status,
    });
  }

  async function loadAgents() {
    setLoading(true);
    try {
      const r = await api.projectAgents(projectUuid);
      const list = r.data ?? [];
      setAgents(list);
      for (const agent of list.filter((a) => a.kind !== 'subagent')) {
        if (agent.status === 'working') {
          launchAgent({
            uuid: agent.uuid,
            projectUuid,
            projectName: projectNameRef.current,
            title: roleLabel(agent.role) || agent.name,
            role: agent.role,
            status: agent.status,
          });
        } else {
          markLaunchedStatus(agent.uuid, agent.status);
        }
      }
      setError(null);
    } catch (e: unknown) {
      setError(String((e as Error).message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    syncLaunchedProjectName(projectUuid, projectName);
  }, [projectUuid, projectName]);

  useEffect(() => {
    void loadAgents();
  }, [projectUuid]);

  useEffect(() => {
    if (loading || openedFromQuery.current) return;
    const openId = new URLSearchParams(window.location.search).get('open');
    if (!openId) return;
    const agent = agents.find((item) => item.uuid === openId && item.kind !== 'subagent');
    if (!agent) return;
    openedFromQuery.current = true;
    setSelectedUuid(agent.uuid);
    if (agent.role === 'coordinator') remember(agent);
  }, [loading, agents, projectUuid, projectName]);

  useEffect(() => {
    return subscribeOpenAgent((launched) => {
      if (launched.projectUuid !== projectUuid) return;
      const agent = agents.find((item) => item.uuid === launched.uuid);
      if (!agent) return;
      setSelectedUuid(agent.uuid);
      if (agent.role === 'coordinator') setOpenChat(agent);
      else void openLastActivity(agent);
    });
  }, [agents, projectUuid]);

  const gridAgents = useMemo(() => {
    const roots = agents.filter((a) => a.kind !== 'subagent');
    const coord = roots.filter((a) => a.role === 'coordinator');
    const auto = roots
      .filter((a) => a.role !== 'coordinator')
      .slice()
      .sort((a, b) => {
        const ae = a.enabled === 0 ? 1 : 0;
        const be = b.enabled === 0 ? 1 : 0;
        if (ae !== be) return ae - be;
        if (a.status === 'working' && b.status !== 'working') return -1;
        if (b.status === 'working' && a.status !== 'working') return 1;
        return (b.updated_at || '').localeCompare(a.updated_at || '');
      });
    return [...coord, ...auto];
  }, [agents]);

  const selected = gridAgents.find((a) => a.uuid === selectedUuid) ?? null;

  async function toggleEnabled(agent: ProjectAgent) {
    setBusyUuid(agent.uuid);
    try {
      const next =
        agent.enabled === 0
          ? await api.enableProjectAgent(projectUuid, agent.uuid)
          : await api.disableProjectAgent(projectUuid, agent.uuid);
      setAgents((prev) => prev.map((a) => (a.uuid === agent.uuid ? next.data : a)));
      toast.push({
        title: next.data.enabled === 0 ? 'Agent désactivé' : 'Agent activé',
        detail: next.data.name,
        tone: 'ok',
      });
    } catch (e: unknown) {
      toast.push({ title: 'Action impossible', detail: String(e), tone: 'danger' });
    } finally {
      setBusyUuid(null);
    }
  }

  async function runNow(agent: ProjectAgent) {
    setBusyUuid(agent.uuid);
    try {
      const r = await api.runProjectAgentNow(projectUuid, agent.uuid);
      setAgents((prev) => prev.map((a) => (a.uuid === agent.uuid ? r.data : a)));
      remember(r.data);
      toast.push({ title: 'Agent lancé', detail: agent.name, tone: 'ok' });
    } catch (e: unknown) {
      toast.push({ title: 'Lancement impossible', detail: String(e), tone: 'danger' });
    } finally {
      setBusyUuid(null);
    }
  }

  async function openLastActivity(agent: ProjectAgent) {
    setOpenActivity(agent);
    setActivityLoading(true);
    setActivityLines([]);
    try {
      const r = await api.agentMessages(projectUuid, agent.uuid);
      setActivityLines(
        (r.data ?? []).slice(-40).map((m) => ({
          role: m.role,
          content: m.content,
          created_at: m.created_at,
        })),
      );
    } catch (e: unknown) {
      toast.push({ title: 'Journal indisponible', detail: String(e), tone: 'warn' });
    } finally {
      setActivityLoading(false);
    }
  }

  async function submitCreate() {
    const name = createForm.name.trim();
    if (!name) {
      toast.push({ title: 'Nom requis', tone: 'warn' });
      return;
    }
    if (createForm.triggerType === 'cron' && !createForm.cronExpr.trim()) {
      toast.push({ title: 'Expression cron requise', tone: 'warn' });
      return;
    }
    setCreating(true);
    try {
      const trigger_type: AgentTriggerType = createForm.triggerType;
      const trigger_config: AgentTriggerConfig =
        createForm.triggerType === 'cron'
          ? {
              cron_expression: createForm.cronExpr.trim(),
              timezone: 'Europe/Paris',
            }
          : { event: createForm.event };
      const created = await api.createProjectAgent(projectUuid, {
        name,
        role: 'custom',
        kind: 'custom',
        trigger_type,
        trigger_config,
        instructions: createForm.instructions.trim(),
        enabled: true,
      });
      setAgents((prev) => [created.data, ...prev]);
      setSelectedUuid(created.data.uuid);
      setCreateOpen(false);
      setCreateForm(emptyCreate());
      toast.push({ title: 'Agent créé', detail: created.data.name, tone: 'ok' });
    } catch (e: unknown) {
      toast.push({ title: 'Création impossible', detail: String(e), tone: 'danger' });
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      {error && (
        <Alert tone="warn" class="mb-4">
          {error}
        </Alert>
      )}

      {/* List hubs: prefer HubGrid / HubTile (+ detail on select), like Runners. */}
      <div class="mb-4">
        <p class="text-sm text-[var(--color-ink-muted)]">
          Agents autonomes réveillés par un{' '}
          <span class="text-[var(--color-ink)]">cron</span> ou un{' '}
          <span class="text-[var(--color-ink)]">événement</span> (échec deploy, santé…). Le chat
          interactif reste sur le Coordinateur / Workspace.
        </p>
      </div>

      {loading ? (
        <HubGrid cols={4}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} class="min-h-[8.75rem] rounded-2xl sm:aspect-square sm:min-h-0" />
          ))}
        </HubGrid>
      ) : (
        <FadeIn>
          <HubGrid cols={4}>
            {gridAgents.map((agent, i) => {
              const status = statusOf(agent);
              const selectedCard = agent.uuid === selectedUuid;
              return (
                <HubTile
                  key={agent.uuid}
                  index={i}
                  title={agent.name || roleLabel(agent.role)}
                  onClick={() =>
                    setSelectedUuid(agent.uuid === selectedUuid ? null : agent.uuid)
                  }
                  icon={agentIcon(agent)}
                  class={selectedCard ? 'ring-1 ring-white/20' : undefined}
                  badge={
                    <span
                      class={cn(
                        'absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full ring-2 ring-[#1c1c1e]',
                        statusDotClass(status.tone),
                        status.tone === 'warn' ? 'animate-pulse' : '',
                      )}
                      title={status.label}
                      aria-hidden
                    />
                  }
                  subtitle={
                    <div class="mt-1 space-y-0.5">
                      <div
                        class={cn(
                          'text-[11px] font-medium',
                          status.tone === 'ok' && 'text-[var(--color-ok)]',
                          status.tone === 'warn' && 'text-[var(--color-warn)]',
                          status.tone === 'danger' && 'text-[var(--color-danger)]',
                          status.tone === 'neutral' && 'text-[var(--color-ink-faint)]',
                        )}
                      >
                        {status.label}
                      </div>
                      <div class="line-clamp-2 text-[10px] text-[var(--color-ink-faint)]">
                        {triggerSummary(agent)}
                      </div>
                    </div>
                  }
                />
              );
            })}
            <HubAddTile
              index={gridAgents.length}
              label="Nouvel agent"
              onClick={() => {
                setCreateForm(emptyCreate());
                setCreateOpen(true);
              }}
            />
          </HubGrid>
        </FadeIn>
      )}

      {!loading && !error && gridAgents.filter((a) => a.role !== 'coordinator').length === 0 && (
        <p class="mt-6 text-center text-sm text-[var(--color-ink-muted)]">
          Aucun agent autonome pour l’instant. Crée-en un déclenché par cron ou par événement.
        </p>
      )}

      {selected && (
        <FadeIn delay={40} class="mt-6">
          <Card padding="md">
            <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div class="min-w-0 flex-1 space-y-1.5">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="truncate text-sm font-medium text-[var(--color-ink)]">
                    {selected.name || roleLabel(selected.role)}
                  </h3>
                  <Badge tone="neutral">{roleLabel(selected.role)}</Badge>
                  {(selected.role === 'coordinator' || selected.kind === 'required') && (
                    <Badge tone="accent">Système</Badge>
                  )}
                  <Badge
                    tone={
                      statusOf(selected).tone === 'warn'
                        ? 'warn'
                        : statusOf(selected).tone === 'ok'
                          ? 'ok'
                          : 'neutral'
                    }
                  >
                    {statusOf(selected).label}
                  </Badge>
                </div>
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-ink-muted)]">
                  <span class="inline-flex items-center gap-1">
                    {selected.trigger_type === 'cron' ? (
                      <Clock size={12} aria-hidden />
                    ) : selected.role === 'coordinator' ? (
                      <MessageSquare size={12} aria-hidden />
                    ) : (
                      <Zap size={12} aria-hidden />
                    )}
                    {triggerSummary(selected)}
                  </span>
                  {selected.role !== 'coordinator' && (
                    <>
                      <span class="inline-flex items-center gap-1">
                        <Activity size={12} aria-hidden />
                        Dernière exécution · {formatRelativeFr(selected.last_run_at)}
                      </span>
                      {selected.trigger_type === 'cron' && selected.next_run_at ? (
                        <span>Prochaine · {formatRelativeFr(selected.next_run_at)}</span>
                      ) : null}
                    </>
                  )}
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-2 sm:justify-end">
                {selected.role === 'coordinator' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      remember(selected);
                      setOpenChat(selected);
                    }}
                  >
                    <MessageSquare size={14} aria-hidden />
                    Ouvrir le fil
                  </Button>
                ) : (
                  <>
                    <Switch
                      checked={selected.enabled !== 0}
                      disabled={busyUuid === selected.uuid}
                      label={selected.enabled !== 0 ? 'Désactiver' : 'Activer'}
                      onToggle={() => void toggleEnabled(selected)}
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={
                        busyUuid === selected.uuid ||
                        selected.enabled === 0 ||
                        selected.status === 'working'
                      }
                      onClick={() => void runNow(selected)}
                      title="Lancer maintenant"
                    >
                      <Play size={14} aria-hidden />
                      Lancer maintenant
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void openLastActivity(selected)}
                    >
                      <ScrollText size={14} aria-hidden />
                      Journal
                    </Button>
                  </>
                )}
              </div>
            </div>
          </Card>
        </FadeIn>
      )}

      <Modal
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        title="Nouvel agent autonome"
        description="Choisis un déclencheur, un nom et les instructions. Pas de chat : l’agent se réveille seul."
        size="md"
        footer={
          <div class="flex justify-end gap-2">
            <Button variant="ghost" disabled={creating} onClick={() => setCreateOpen(false)}>
              Annuler
            </Button>
            <Button disabled={creating} onClick={() => void submitCreate()}>
              {creating ? 'Création…' : 'Créer'}
            </Button>
          </div>
        }
      >
        <div class="space-y-4">
          <Input
            label="Nom"
            value={createForm.name}
            placeholder="ex. Garde-fou nuit"
            onInput={(e) =>
              setCreateForm((f) => ({
                ...f,
                name: (e.target as HTMLInputElement).value,
              }))
            }
          />

          <div>
            <p class="mb-1.5 text-sm font-medium text-[var(--color-ink)]">Déclencheur</p>
            <div class="flex flex-wrap gap-2">
              {(
                [
                  ['cron', 'Cron (planifié)'],
                  ['event', 'Événement'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  class={cn(
                    'rounded-xl px-3 py-2 text-sm ring-1 transition-colors',
                    createForm.triggerType === value
                      ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] ring-[var(--color-accent)]/40'
                      : 'bg-[var(--color-surface)] text-[var(--color-ink-muted)] ring-[var(--color-line)] hover:text-[var(--color-ink)]',
                  )}
                  onClick={() => setCreateForm((f) => ({ ...f, triggerType: value }))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {createForm.triggerType === 'cron' ? (
            <div class="space-y-2">
              <label class="flex flex-col gap-1.5 text-sm">
                <span class="font-medium text-[var(--color-ink)]">Planification</span>
                <select
                  class="h-10 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-ink)]"
                  value={createForm.cronPreset}
                  onChange={(e) => {
                    const v = (e.target as HTMLSelectElement).value;
                    setCreateForm((f) => ({
                      ...f,
                      cronPreset: v,
                      cronExpr: v || f.cronExpr,
                    }));
                  }}
                >
                  {CRON_PRESETS.map((p) => (
                    <option key={p.label} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              {(createForm.cronPreset === '' ||
                !CRON_PRESETS.some((p) => p.value && p.value === createForm.cronExpr)) && (
                <Input
                  label="Expression cron"
                  value={createForm.cronExpr}
                  hint={cronToFrench(createForm.cronExpr)}
                  onInput={(e) =>
                    setCreateForm((f) => ({
                      ...f,
                      cronExpr: (e.target as HTMLInputElement).value,
                      cronPreset: '',
                    }))
                  }
                />
              )}
              {createForm.cronPreset && createForm.cronPreset !== '' && (
                <p class="text-xs text-[var(--color-ink-muted)]">
                  {cronToFrench(createForm.cronExpr)}
                </p>
              )}
            </div>
          ) : (
            <label class="flex flex-col gap-1.5 text-sm">
              <span class="font-medium text-[var(--color-ink)]">Type d’événement</span>
              <select
                class="h-10 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-ink)]"
                value={createForm.event}
                onChange={(e) =>
                  setCreateForm((f) => ({
                    ...f,
                    event: (e.target as HTMLSelectElement).value,
                  }))
                }
              >
                {EVENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label class="flex flex-col gap-1.5 text-sm">
            <span class="font-medium text-[var(--color-ink)]">Instructions / prompt</span>
            <textarea
              class="min-h-[7rem] w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]/50 focus:ring-2 focus:ring-[var(--color-accent-soft)]"
              placeholder="Ce que l’agent doit faire à chaque réveil…"
              value={createForm.instructions}
              onInput={(e) =>
                setCreateForm((f) => ({
                  ...f,
                  instructions: (e.target as HTMLTextAreaElement).value,
                }))
              }
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={!!openActivity}
        onClose={() => setOpenActivity(null)}
        title={openActivity ? `Journal · ${openActivity.name}` : 'Journal'}
        description={openActivity ? triggerSummary(openActivity) : undefined}
        size="lg"
      >
        {activityLoading ? (
          <p class="text-sm text-[var(--color-ink-muted)]">Chargement…</p>
        ) : activityLines.length === 0 ? (
          <p class="text-sm text-[var(--color-ink-muted)]">Aucune activité pour cet agent.</p>
        ) : (
          <ul class="max-h-[min(55dvh,28rem)] space-y-3 overflow-y-auto pr-1">
            {activityLines.map((line, i) => (
              <li
                key={`${line.created_at}-${i}`}
                class="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3"
              >
                <div class="mb-1 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-[var(--color-ink-faint)]">
                  <span>{line.role}</span>
                  <span>{formatRelativeFr(line.created_at)}</span>
                </div>
                <pre class="whitespace-pre-wrap break-words font-sans text-xs text-[var(--color-ink-muted)]">
                  {line.content.length > 1200
                    ? `${line.content.slice(0, 1200)}…`
                    : line.content}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <Modal
        open={!!openChat}
        onClose={() => setOpenChat(null)}
        title={openChat?.name || 'Coordinateur'}
        description="Fil permanent du projet — contexte accumulé"
        size="xl"
        padded={false}
        bodyClass="overflow-hidden"
      >
        {openChat && (
          <div class="h-[min(70dvh,640px)] min-h-[22rem]">
            <ProjectAgentsPanel
              key={openChat.uuid}
              projectUuid={projectUuid}
              defaultAgentUuid={openChat.uuid}
              mode="team"
              embedded
            />
          </div>
        )}
      </Modal>
    </>
  );
}
