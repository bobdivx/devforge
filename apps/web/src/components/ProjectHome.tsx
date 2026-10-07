import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  Archive,
  Clock,
  Database,
  Eraser,
  ExternalLink,
  Eye,
  GitBranch,
  Globe,
  History,
  KeyRound,
  LayoutDashboard,
  MessagesSquare,
  Rocket,
  ScrollText,
  Settings2,
  SlidersHorizontal,
  Users,
  Workflow,
} from 'lucide-preact';
import {
  api,
  type Deployment,
  type Project,
  type ProjectAgent,
  type SpecFeature,
} from '../lib/api';
import { cn } from '../lib/cn';
import { projectSyncMeta } from '../lib/status';
import { braiseTitle, PERSONAS, teamStatus, type PersonaTone } from '../lib/personas';
import { ProjectAgentsPanel, type ChatChip } from './ProjectAgentsPanel';
import { PersonaAvatar } from './personas/PersonaAvatar';
import { PreviewModal } from './workspace/PreviewModal';
import { StatusBadge } from './StatusBadge';
import { PreviewPane } from './workspace/WorkspaceAtelier';
import type { PreviewServerStatus } from './workspace/WorkspaceTopBar';
import { Button, FadeIn, HubGrid, HubTile, Modal, Spinner, useToast } from './ui';

type Props = {
  uuid: string;
  project: Project | null;
  deployments: Deployment[];
  onDeployments: (d: Deployment[]) => void;
  onNewFeature: () => void;
  onOpenRules: () => void;
  /** Sélecteur de groupe (si l'app est dans un groupe). */
  groupSwitcher?: ComponentChildren;
  loading?: boolean;
};

const IN_PROGRESS = ['queued', 'running', 'building', 'pending', 'deploying'];
const KNOWN_SYNC = new Set(['up_to_date', 'behind', 'ahead', 'deploying', 'error']);

function isInProgress(status?: string | null) {
  return !!status && IN_PROGRESS.includes(status);
}

function isFailed(status?: string | null) {
  return status === 'failed' || status === 'error';
}

function tabHref(uuid: string, tab: string, extra = '') {
  return `/app/projects/view?uuid=${encodeURIComponent(uuid)}&tab=${tab}${extra}`;
}

function relativeFr(iso?: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diff = Math.max(0, Date.now() - t);
  const min = Math.round(diff / 60000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

/** Statut de l'app en mots simples. */
function appStatus(
  project: Project | null,
  current: Deployment | null,
): { label: string; tone: PersonaTone } {
  if (current && isInProgress(current.status)) return { label: 'Mise en ligne…', tone: 'warn' };
  switch (project?.status) {
    case 'live':
    case 'running':
      return { label: 'En ligne', tone: 'ok' };
    case 'unhealthy':
      return { label: 'En panne', tone: 'danger' };
    case 'unrouted':
      return { label: 'Adresse non branchée', tone: 'danger' };
    case 'failed':
    case 'error':
      return { label: 'Échec', tone: 'danger' };
    case 'stopped':
      return { label: 'Arrêtée', tone: 'neutral' };
    case 'deploying':
    case 'building':
    case 'queued':
      return { label: 'Mise en ligne…', tone: 'warn' };
    case 'draft':
    case 'ready':
      return { label: 'Pas encore en ligne', tone: 'neutral' };
    default:
      return { label: project?.status || '…', tone: 'neutral' };
  }
}

function deployWord(status: string): string {
  if (status === 'success' || status === 'deployed' || status === 'ok' || status === 'ready') return 'réussie';
  if (isFailed(status)) return 'échouée';
  if (status === 'cancelled' || status === 'canceled') return 'annulée';
  if (isInProgress(status)) return 'en cours';
  return status;
}

function toneDot(tone: PersonaTone) {
  return cn(
    'inline-block h-2 w-2 shrink-0 rounded-full',
    tone === 'ok' && 'bg-[var(--color-ok)]',
    tone === 'warn' && 'bg-[var(--color-warn)]',
    tone === 'danger' && 'bg-[var(--color-danger)]',
    tone === 'accent' && 'animate-pulse bg-[var(--color-accent)]',
    tone === 'neutral' && 'bg-[var(--color-ink-faint)]',
  );
}

function tileBadge(tone: PersonaTone | null) {
  if (!tone || tone === 'neutral') return null;
  return (
    <span
      class={cn(
        'absolute -right-1 -top-1 h-3 w-3 rounded-full ring-2 ring-[#1c1c1e]',
        tone === 'ok' && 'bg-[var(--color-ok)]',
        tone === 'warn' && 'bg-[var(--color-warn)]',
        tone === 'danger' && 'bg-[var(--color-danger)]',
        tone === 'accent' && 'bg-[var(--color-accent)]',
      )}
      aria-hidden
    />
  );
}

function shortRepo(url?: string | null) {
  if (!url) return null;
  return url.replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/, '');
}

/**
 * Page projet par défaut : une conversation avec Braise, l'aperçu,
 * un bouton « Mettre en ligne ». Le reste vit dans « Réglages avancés ».
 */
export function ProjectHome({
  uuid,
  project,
  deployments,
  onDeployments,
  onNewFeature,
  onOpenRules,
  groupSwitcher,
  loading,
}: Props) {
  const toast = useToast();
  const [agents, setAgents] = useState<ProjectAgent[]>([]);
  const [specs, setSpecs] = useState<SpecFeature[]>([]);
  const [previewStatus, setPreviewStatus] = useState<PreviewServerStatus>('stopped');
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [view, setView] = useState<'draft' | 'live' | null>(null);
  const [fullOpen, setFullOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deployBusy, setDeployBusy] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const latest = deployments[0] ?? null;
  const current = deployments.find((d) => isInProgress(d.status)) ?? latest;
  const status = appStatus(project, current);
  const liveUrl = project?.production_url || null;
  const name = project?.name || 'ton app';

  // Équipe + specs (lecture seule, rafraîchies doucement).
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void api
        .projectAgents(uuid)
        .then((r) => !cancelled && setAgents(r.data ?? []))
        .catch(() => {});
      void api
        .projectSpecs(uuid)
        .then((r) => !cancelled && setSpecs(r.data ?? []))
        .catch(() => {});
    };
    load();
    const id = window.setInterval(load, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [uuid]);

  // Aperçu brouillon : même endpoint que l'atelier.
  const refreshPreview = useCallback(async () => {
    try {
      const r = await api.previewStatus(uuid);
      const data = r.data ?? {};
      setPreviewStatus(data.status === 'running' ? 'running' : data.status === 'starting' ? 'starting' : 'stopped');
      if (typeof data.preview_url === 'string' && data.preview_url) setDraftUrl(data.preview_url);
    } catch {
      /* polling silencieux */
    }
  }, [uuid]);

  useEffect(() => {
    void refreshPreview();
    const id = window.setInterval(() => void refreshPreview(), 8000);
    const onRefresh = (ev: Event) => {
      const detail = (ev as CustomEvent<{ url?: string }>).detail;
      if (detail?.url) {
        setDraftUrl(detail.url);
        setPreviewStatus('running');
        setView('draft');
        setNonce((n) => n + 1);
      }
    };
    window.addEventListener('devforge:preview-refresh', onRefresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('devforge:preview-refresh', onRefresh);
    };
  }, [refreshPreview]);

  const draftReady = previewStatus === 'running' && !!draftUrl;
  // Brouillon par défaut dès qu'un serveur d'aperçu tourne ou démarre ; sinon la version en ligne.
  const draftActive = previewStatus === 'running' || previewStatus === 'starting';
  const effectiveView: 'draft' | 'live' = view ?? (draftActive || !liveUrl ? 'draft' : 'live');
  const shownUrl = effectiveView === 'draft' ? (draftReady ? draftUrl : null) : liveUrl;

  async function startPreview() {
    setPreviewBusy(true);
    setPreviewError(null);
    setPreviewStatus('starting');
    try {
      const r = await api.previewStart(uuid);
      const data = r.data ?? {};
      if (data.ok && typeof data.preview_url === 'string') {
        setDraftUrl(data.preview_url);
        setPreviewStatus('running');
      } else if (data.ok) {
        await refreshPreview();
      } else {
        setPreviewStatus('stopped');
        setPreviewError(
          typeof data.error === 'string' && data.error
            ? data.error
            : 'L’aperçu n’a pas pu démarrer. Demande à Braise de regarder.',
        );
      }
    } catch (e) {
      setPreviewStatus('stopped');
      setPreviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewBusy(false);
    }
  }

  // Toast quand une mise en ligne se termine.
  const lastSeen = useRef<{ uuid: string; status: string } | null>(null);
  useEffect(() => {
    if (!latest) return;
    const prev = lastSeen.current;
    lastSeen.current = { uuid: latest.uuid, status: latest.status };
    if (prev && prev.uuid === latest.uuid && isInProgress(prev.status) && !isInProgress(latest.status)) {
      toast.push(
        isFailed(latest.status)
          ? { title: 'La mise en ligne a échoué', detail: 'Rustine peut regarder : bouton « Répare la mise en ligne ».', tone: 'danger' }
          : { title: 'C’est en ligne 🎉', detail: liveUrl?.replace(/^https?:\/\//, '') || undefined, tone: 'ok' },
      );
    }
  }, [latest?.uuid, latest?.status]);

  async function deployNow() {
    setDeployBusy(true);
    try {
      await api.createDeployment(uuid, { git_message: 'Mise en ligne depuis la page projet' });
      toast.push({ title: 'Mise en ligne lancée', detail: 'Reconstruction depuis GitHub…', tone: 'info' });
      setConfirmOpen(false);
      const list = await api.deployments(uuid);
      onDeployments(list.data ?? []);
    } catch (e) {
      toast.push({ title: 'Mise en ligne impossible', detail: String(e), tone: 'danger' });
    } finally {
      setDeployBusy(false);
    }
  }

  const team = useMemo(() => teamStatus(agents, specs, latest), [agents, specs, latest]);
  const routineCount = useMemo(() => countActiveRoutines(agents), [agents]);
  const coordinatorUuid = agents.find((a) => a.role === 'coordinator')?.uuid ?? null;

  const chips: ChatChip[] = [
    { key: 'feature', label: '✨ Nouvelle fonctionnalité', onClick: onNewFeature },
    {
      key: 'health',
      label: '🩺 Est-ce que tout va bien ?',
      // Bilan en lecture seule : la puce ne doit jamais déclencher de modification.
      send: 'Est-ce que tout va bien ? Fais juste un bilan rapide (app en ligne, dernière mise en ligne, brouillon), sans rien modifier.',
    },
    {
      key: 'design',
      label: '🎨 Améliore le design',
      send: 'Améliore le design en local, puis montre-moi l’aperçu.',
    },
  ];
  if (latest && isFailed(latest.status)) {
    chips.unshift({
      key: 'repair',
      label: '🩹 Répare la mise en ligne',
      tone: 'danger',
      send: 'La dernière mise en ligne a échoué. Trouve la cause et propose une réparation, sans rien mettre en ligne.',
    });
  }

  const repo = shortRepo(project?.git_repository);
  const sync = projectSyncMeta(project?.sync ?? null);
  const recentOk = deployments.filter((d) => ['success', 'deployed', 'ok', 'ready'].includes(d.status)).length;
  const recentKo = deployments.filter((d) => isFailed(d.status)).length;
  const canDeploy = !!project?.git_repository;

  const brief: Array<{ label: string; value: string; tone?: PersonaTone }> = [];
  if (latest) {
    const when = relativeFr(latest.created_at);
    brief.push({
      label: 'Dernière mise en ligne',
      value: `${deployWord(latest.status)}${when ? ` · ${when}` : ''}`,
      tone: isFailed(latest.status) ? 'danger' : isInProgress(latest.status) ? 'warn' : 'ok',
    });
  }
  // « Sync inconnue », « Sans Git »… n'apprennent rien : on n'affiche que les états utiles.
  if (project?.sync?.state && KNOWN_SYNC.has(project.sync.state)) {
    brief.push({ label: 'Code sur GitHub', value: sync.label, tone: sync.tone });
  }
  if (deployments.length > 1) {
    brief.push({
      label: `Sur les ${deployments.length} dernières`,
      value: `${recentOk} réussie${recentOk > 1 ? 's' : ''}${recentKo ? ` · ${recentKo} échouée${recentKo > 1 ? 's' : ''}` : ''}`,
    });
  }

  return (
    <FadeIn class="df-tap">
      {/* En-tête */}
      <div class="mb-4 flex flex-col gap-4 sm:mb-5 sm:flex-row sm:items-center">
        <div class="flex min-w-0 items-center gap-3.5">
          <div
            class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-500 text-xl font-bold text-white shadow-[0_8px_24px_rgb(56_189_248/0.25)]"
            aria-hidden
          >
            {name.slice(0, 1).toUpperCase()}
          </div>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2.5">
              <h1 class="break-words text-2xl font-semibold tracking-tight">{project?.name ?? (loading ? '…' : 'App')}</h1>
              {groupSwitcher}
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span class="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-white/[0.03] px-2.5 py-0.5 text-xs text-[var(--color-ink-muted)]">
                <span class={toneDot(status.tone)} aria-hidden />
                {status.label}
              </span>
              {liveUrl && (
                <a
                  href={liveUrl}
                  target="_blank"
                  rel="noreferrer"
                  class="inline-flex min-w-0 max-w-full items-center gap-1 text-[var(--color-accent)] hover:underline"
                >
                  <span class="truncate">{liveUrl.replace(/^https?:\/\//, '')}</span>
                  <ExternalLink size={12} class="shrink-0" aria-hidden />
                </a>
              )}
            </div>
          </div>
          {/* Mobile/tablette : état global des apps, seulement s'il y a quelque chose à voir. */}
          <StatusBadge compact class="ml-auto lg:hidden" />
        </div>
        <div class="grid grid-cols-[1fr_1fr_auto] gap-2 sm:ml-auto sm:flex sm:shrink-0">
          <Button
            size="sm"
            variant="secondary"
            class="max-lg:h-11 max-lg:text-[13px]"
            onClick={() => {
              if (shownUrl) setFullOpen(true);
              else if (liveUrl) {
                setView('live');
                setFullOpen(true);
              } else {
                setView('draft');
                void startPreview();
              }
            }}
          >
            <Eye size={14} aria-hidden />
            Aperçu
          </Button>
          <Button
            size="sm"
            class="max-lg:h-11 max-lg:text-[13px]"
            disabled={!canDeploy || deployBusy || isInProgress(current?.status)}
            title={canDeploy ? 'Reconstruire et mettre en ligne depuis GitHub' : 'Relie d’abord un dépôt GitHub'}
            onClick={() => setConfirmOpen(true)}
          >
            {deployBusy || isInProgress(current?.status) ? <Spinner /> : <Rocket size={14} aria-hidden />}
            {isInProgress(current?.status) ? 'Mise en ligne…' : 'Mettre en ligne'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            class="max-lg:h-11 max-sm:w-11 max-sm:px-0 max-sm:ring-1 max-sm:ring-inset max-sm:ring-[var(--color-line-strong)]"
            onClick={() => setAdvancedOpen(true)}
            aria-label="Réglages avancés"
            title="Réglages avancés"
          >
            <Settings2 size={16} aria-hidden />
            <span class="hidden sm:inline">Réglages avancés</span>
          </Button>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-5">
        {/* Conversation avec Braise */}
        <section
          class="h-[max(380px,calc(100dvh-17rem-env(safe-area-inset-bottom,0px)))] min-w-0 lg:h-[calc(100dvh-10.5rem)] lg:min-h-[560px]"
          aria-label="Conversation avec Braise"
        >
          <ProjectAgentsPanel
            projectUuid={uuid}
            embedded
            persona={{
              name: PERSONAS.braise.name,
              title: braiseTitle(project?.name),
              tagline: PERSONAS.braise.tagline,
              avatar: <PersonaAvatar persona="braise" size={38} />,
              smallAvatar: <PersonaAvatar persona="braise" size={26} />,
              placeholder: 'Dis à Braise ce que tu veux…',
              emptyText: `Salut 👋 Je suis Braise. Dis-moi ce que tu veux changer dans ${name} : je prépare un plan, je construis en brouillon et je te montre l’aperçu. Rien ne part en ligne sans ton OK.`,
              chips,
            }}
          />
        </section>

        {/* Colonne de droite */}
        <aside class="flex min-w-0 flex-col gap-4">
          <div class="rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-3.5">
            <div class="mb-2.5 flex items-center justify-between gap-2">
              <h2 class="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">Aperçu</h2>
              <div class="inline-flex rounded-full border border-[var(--color-line)] p-0.5" role="tablist">
                {(
                  [
                    ['draft', 'Brouillon'],
                    ['live', 'En ligne'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={effectiveView === key}
                    class={cn(
                      'rounded-full px-2.5 py-0.5 text-[11.5px] font-medium transition max-lg:px-4 max-lg:text-[13px]',
                      effectiveView === key
                        ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                        : 'text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]',
                    )}
                    onClick={() => setView(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div class="h-[300px] overflow-hidden rounded-xl lg:h-[240px] border border-[var(--color-line)] bg-[var(--color-bg-elevated)]">
              {shownUrl ? (
                <PreviewPane
                  key={`${effectiveView}-${nonce}`}
                  previewUrl={shownUrl}
                  previewStatus="running"
                  nonce={nonce}
                  onRefresh={() => setNonce((n) => n + 1)}
                  onExpand={() => setFullOpen(true)}
                />
              ) : (
                <div class="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  {effectiveView === 'draft' ? (
                    <>
                      <p class="text-sm text-[var(--color-ink-muted)]">
                        {previewStatus === 'starting'
                          ? 'L’aperçu démarre…'
                          : 'Le brouillon n’est pas affiché. Lance l’aperçu pour voir tes changements avant de les mettre en ligne.'}
                      </p>
                      {previewStatus === 'starting' ? (
                        <Spinner />
                      ) : (
                        <Button size="sm" variant="secondary" disabled={previewBusy} onClick={() => void startPreview()}>
                          {previewBusy ? <Spinner /> : <Eye size={14} aria-hidden />}
                          Lancer l’aperçu
                        </Button>
                      )}
                    </>
                  ) : (
                    <p class="text-sm text-[var(--color-ink-muted)]">Pas encore en ligne.</p>
                  )}
                </div>
              )}
            </div>
            {previewError && effectiveView === 'draft' && (
              <p class="mt-2 line-clamp-3 text-xs text-[var(--color-danger)]">{previewError}</p>
            )}
          </div>

          <div class="rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-3.5">
            <h2 class="mb-1.5 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">
              L’équipe de {name}
              <a
                href={tabHref(uuid, 'agents')}
                class="inline-flex items-center justify-end text-[11px] font-normal normal-case tracking-normal text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] max-lg:text-[13px]"
              >
                Gérer
              </a>
            </h2>
            <ul>
              {team.map((m, i) => (
                <li
                  key={m.persona.key}
                  class={cn('flex items-center gap-3 py-2', i > 0 && 'border-t border-[var(--color-line)]')}
                >
                  <PersonaAvatar persona={m.persona.key} size={32} />
                  <div class="min-w-0 flex-1 leading-tight">
                    <div class="text-[13.5px] font-semibold">{m.persona.name}</div>
                    <div class="line-clamp-2 text-xs text-[var(--color-ink-faint)] lg:line-clamp-none lg:truncate">{m.detail || m.persona.role}</div>
                  </div>
                  {m.persona.key === 'braise' && m.label === 'Attend ton OK' ? (
                    <button
                      type="button"
                      class="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--color-warn)]/30 bg-[var(--color-warn)]/10 px-2 py-0.5 text-[11.5px] text-[var(--color-warn)] hover:bg-[var(--color-warn)]/15 max-lg:px-3 max-lg:text-[13px]"
                      onClick={onNewFeature}
                      title="Lire le plan et l’approuver"
                    >
                      <span class={toneDot(m.tone)} aria-hidden />
                      {m.label}
                    </button>
                  ) : (
                    <span class="flex shrink-0 items-center gap-1.5 text-[11.5px] text-[var(--color-ink-muted)]">
                      <span class={toneDot(m.tone)} aria-hidden />
                      {m.label}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {brief.length > 0 && (
            <div class="rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-3.5">
              <h2 class="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">En bref</h2>
              <dl class="space-y-1.5">
                {brief.map((b) => (
                  <div key={b.label} class="flex items-center justify-between gap-3 text-sm">
                    <dt class="text-[var(--color-ink-faint)]">{b.label}</dt>
                    <dd class="flex items-center gap-1.5 text-right text-[var(--color-ink)]">
                      {b.tone && <span class={toneDot(b.tone)} aria-hidden />}
                      {b.value}
                    </dd>
                  </div>
                ))}
              </dl>
              <button
                type="button"
                class="mt-2 w-full text-center text-[11px] text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] max-lg:text-xs"
                onClick={() => setAdvancedOpen(true)}
              >
                Adresse, variables, base, sauvegardes… → Réglages avancés
              </button>
            </div>
          )}
        </aside>
      </div>

      <PreviewModal
        open={fullOpen && !!shownUrl}
        onClose={() => setFullOpen(false)}
        previewUrl={shownUrl}
        isProduction={effectiveView === 'live'}
      />

      <Modal
        open={confirmOpen}
        onClose={() => !deployBusy && setConfirmOpen(false)}
        title={`Mettre ${name} en ligne ?`}
        description="DevForge reconstruit l’app depuis GitHub puis remplace la version en ligne."
        size="sm"
        class="df-tap"
        footer={
          <div class="flex w-full gap-2 sm:justify-end">
            <Button size="sm" variant="ghost" class="max-sm:flex-1 max-lg:h-11" disabled={deployBusy} onClick={() => setConfirmOpen(false)}>
              Annuler
            </Button>
            <Button size="sm" class="max-sm:flex-1 max-lg:h-11" disabled={deployBusy} onClick={() => void deployNow()}>
              {deployBusy ? <Spinner /> : <Rocket size={14} aria-hidden />}
              Mettre en ligne
            </Button>
          </div>
        }
      >
        <div class="space-y-2 text-sm text-[var(--color-ink-muted)]">
          {repo && (
            <p>
              Source : <span class="text-[var(--color-ink)]">{repo}</span>
              {project?.git_branch ? (
                <>
                  {' '}
                  · branche <span class="text-[var(--color-ink)]">{project.git_branch}</span>
                </>
              ) : null}
            </p>
          )}
          <p>Les changements du brouillon qui ne sont pas encore sur GitHub ne seront pas inclus.</p>
        </div>
      </Modal>

      <AdvancedSettingsModal
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        uuid={uuid}
        project={project}
        latest={latest}
        routineCount={routineCount}
        coordinatorUuid={coordinatorUuid}
        onOpenRules={() => {
          setAdvancedOpen(false);
          onOpenRules();
        }}
      />
    </FadeIn>
  );
}

function AdvancedSettingsModal({
  open,
  onClose,
  uuid,
  project,
  latest,
  routineCount,
  coordinatorUuid,
  onOpenRules,
}: {
  open: boolean;
  onClose: () => void;
  uuid: string;
  project: Project | null;
  latest: Deployment | null;
  routineCount: number;
  coordinatorUuid: string | null;
  onOpenRules: () => void;
}) {
  const toast = useToast();
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function clearConversation() {
    if (!coordinatorUuid) return;
    setClearing(true);
    try {
      await api.clearAgentMessages(uuid, coordinatorUuid);
      window.dispatchEvent(new CustomEvent('devforge:chat-cleared', { detail: { agentUuid: coordinatorUuid } }));
      toast.push({ title: 'Conversation effacée', detail: 'Braise repart d’une page blanche.', tone: 'ok' });
      setClearOpen(false);
      onClose();
    } catch (e) {
      toast.push({ title: 'Effacement impossible', detail: String(e), tone: 'danger' });
    } finally {
      setClearing(false);
    }
  }
  const name = project?.name || 'l’app';
  const repo = shortRepo(project?.git_repository);
  const sync = projectSyncMeta(project?.sync ?? null);
  const icon = (I: typeof Globe) => <I size={28} strokeWidth={1.75} aria-hidden />;

  const groups: Array<{
    title: string;
    tiles: Array<{
      key: string;
      title: string;
      description: string;
      icon: ComponentChildren;
      href?: string;
      onClick?: () => void;
      tone?: PersonaTone | null;
    }>;
  }> = [
    {
      title: 'En ligne',
      tiles: [
        {
          key: 'domains',
          title: 'Adresse',
          description: project?.production_url ? project.production_url.replace(/^https?:\/\//, '') : 'Pas encore d’adresse',
          icon: icon(Globe),
          href: tabHref(uuid, 'domains'),
          tone: project?.production_url ? 'ok' : null,
        },
        { key: 'env', title: 'Variables', description: 'Clés et secrets de l’app', icon: icon(KeyRound), href: tabHref(uuid, 'env') },
        { key: 'database', title: 'Base de données', description: 'Créer ou relier une base', icon: icon(Database), href: tabHref(uuid, 'database') },
        { key: 'backups', title: 'Sauvegardes', description: 'Copies et restauration', icon: icon(Archive), href: tabHref(uuid, 'backups') },
      ],
    },
    {
      title: 'Équipe & routines',
      tiles: [
        {
          key: 'agents',
          title: 'Équipe & routines',
          description:
            routineCount > 0
              ? `${routineCount} routine${routineCount > 1 ? 's' : ''} active${routineCount > 1 ? 's' : ''}`
              : 'Phare, Rustine, Plume et leurs réveils',
          icon: icon(Users),
          href: tabHref(uuid, 'agents'),
        },
        { key: 'crons', title: 'Tâches planifiées', description: 'Commandes qui tournent à heure fixe', icon: icon(Clock), href: tabHref(uuid, 'crons') },
        { key: 'rules', title: 'Règles de l’équipe', description: 'Consignes en français (AGENTS.md)', icon: icon(ScrollText), onClick: onOpenRules },
        { key: 'workspace', title: 'Atelier détaillé', description: 'Tous les fils, fichiers du brouillon, serveur d’aperçu', icon: icon(MessagesSquare), href: tabHref(uuid, 'workspace') },
        ...(coordinatorUuid
          ? [
              {
                key: 'clear',
                title: 'Effacer la conversation',
                description: 'Repartir de zéro avec Braise',
                icon: icon(Eraser),
                onClick: () => setClearOpen(true),
              },
            ]
          : []),
      ],
    },
    {
      title: 'Pour les curieux',
      tiles: [
        {
          key: 'deployments',
          title: 'Historique & journaux',
          description: latest ? `Dernière : ${deployWord(latest.status)}` : 'Aucune mise en ligne',
          icon: icon(History),
          href: tabHref(uuid, 'deployments'),
          tone: latest ? (isFailed(latest.status) ? 'danger' : isInProgress(latest.status) ? 'warn' : 'ok') : null,
        },
        {
          key: 'git',
          title: 'Code',
          description: repo ? `${repo}${project?.git_branch ? ` · ${project.git_branch}` : ''}` : 'Pas de dépôt relié',
          icon: icon(GitBranch),
          href: tabHref(uuid, 'git'),
          tone: !repo ? 'warn' : project?.sync?.state ? sync.tone : null,
        },
        { key: 'actions', title: 'CI GitHub', description: 'Workflows et machines de build', icon: icon(Workflow), href: tabHref(uuid, 'actions') },
        { key: 'settings', title: 'Machine & accès', description: 'Nœud, GPU, ports, dossiers, connexion', icon: icon(SlidersHorizontal), href: tabHref(uuid, 'settings') },
      ],
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Réglages avancés · ${name}`}
      description="Tout ce dont tu n’as pas besoin au quotidien. Chaque tuile ouvre sa page."
      size="xl"
      fullOnMobile
      class="df-tap"
      footer={
        <div class="flex w-full flex-wrap items-center justify-between gap-2 text-xs">
          <a href={tabHref(uuid, 'overview')} class="inline-flex items-center gap-1.5 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] max-lg:text-[13px]">
            <LayoutDashboard size={13} aria-hidden />
            Ancien tableau de bord
          </a>
          <a href={tabHref(uuid, 'settings', '&section=danger')} class="inline-flex items-center text-[var(--color-danger)] hover:underline max-lg:text-[13px]">
            Supprimer l’app…
          </a>
        </div>
      }
    >
      <div class="space-y-5">
        {groups.map((g) => (
          <section key={g.title}>
            <h3 class="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--color-ink-faint)]">{g.title}</h3>
            <HubGrid cols={4}>
              {g.tiles.map((t, i) => (
                <HubTile
                  key={t.key}
                  index={i}
                  title={t.title}
                  description={t.description}
                  icon={t.icon}
                  href={t.href}
                  onClick={t.onClick}
                  badge={tileBadge(t.tone ?? null)}
                />
              ))}
            </HubGrid>
          </section>
        ))}
      </div>
      <Modal
        open={clearOpen}
        onClose={() => !clearing && setClearOpen(false)}
        title="Effacer toute la conversation ?"
        description={`Tout l’historique avec Braise sur ${name} sera supprimé définitivement. Le code, les specs et l’app en ligne ne sont pas touchés.`}
        size="sm"
        class="df-tap"
        footer={
          <div class="flex w-full gap-2 sm:justify-end">
            <Button size="sm" variant="ghost" class="max-sm:flex-1 max-lg:h-11" disabled={clearing} onClick={() => setClearOpen(false)}>
              Annuler
            </Button>
            <Button size="sm" variant="danger" class="max-sm:flex-1 max-lg:h-11" disabled={clearing} onClick={() => void clearConversation()}>
              {clearing ? <Spinner /> : <Eraser size={14} aria-hidden />}
              Effacer tout l’historique
            </Button>
          </div>
        }
      >
        <p class="text-sm text-[var(--color-ink-muted)]">Cette action est irréversible.</p>
      </Modal>
    </Modal>
  );
}

function countActiveRoutines(agents: ProjectAgent[]): number {
  return agents.filter(
    (a) => a.enabled !== 0 && (a.trigger_type === 'cron' || a.trigger_type === 'event'),
  ).length;
}
