import { CheckCircle, CheckCheck, ChevronDown, ChevronUp, Circle, KeyRound, Plus, RefreshCw, RotateCcw } from 'lucide-preact';
import { useMemo, useState } from 'preact/hooks';
import type { AgentMission, AgentMissionStatus } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { ApiError } from '../../lib/api-client';
import {
    groupMissionsByStatus,
    isFeatureDeliveryMission,
    missionKindLabel,
    MISSION_KIND_LABELS,
    missionSourceHint,
    visibleMissionsForColumn,
} from '../../lib/mission-board';
import { useApiQuery } from '../../lib/use-api-query';
import { useTeamContext } from '../../lib/team-context';
import { FeatureDeliveryActions } from './FeatureDeliveryActions';

const columns: Array<{ id: AgentMissionStatus; status: AgentMissionStatus; title: string; hint: string }> = [
    { id: 'open', status: 'open', title: 'Ouvert', hint: 'À prendre' },
    { id: 'in_progress', status: 'in_progress', title: 'En cours', hint: 'Claim auto des agents' },
    { id: 'blocked', status: 'blocked', title: 'Bloqué', hint: 'Secret / confirm' },
    { id: 'done', status: 'done', title: 'Terminé', hint: 'Récents' },
];

function MissionCard({
    mission,
    onStatus,
    onFocusInbox,
    onReload,
}: {
    mission: AgentMission;
    onStatus: (mission: AgentMission, status: AgentMissionStatus) => void;
    onFocusInbox: () => void;
    onReload: () => void;
}) {
    const [open, setOpen] = useState(false);
    const source = missionSourceHint(mission);
    const assignee = mission.assignee_name ?? mission.assignee_type ?? null;
    const timeline = mission.timeline ?? [];
    const featureDelivery = isFeatureDeliveryMission(mission);

    return (
        <li class="rounded-lg border border-base-300/80 bg-base-100 shadow-sm">
            <button
                type="button"
                class="flex w-full min-w-0 items-start gap-2 px-2.5 py-2 text-left hover:bg-base-200/40"
                onClick={() => setOpen((current) => !current)}
                aria-expanded={open}
            >
                <span class="badge badge-ghost badge-xs mt-0.5 shrink-0">{missionKindLabel(mission.kind)}</span>
                <span class="min-w-0 flex-1">
                    <span class="line-clamp-2 text-xs font-medium leading-snug">{mission.title}</span>
                    <span class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-base-content/50">
                        {assignee && <span>→ {assignee}</span>}
                        {source && <span>{source}</span>}
                        {mission.priority && mission.priority !== 'normal' && (
                            <span class="font-medium uppercase">{mission.priority}</span>
                        )}
                    </span>
                </span>
                {open
                    ? <ChevronUp class="mt-0.5 size-3.5 shrink-0 opacity-50" aria-hidden />
                    : <ChevronDown class="mt-0.5 size-3.5 shrink-0 opacity-50" aria-hidden />}
            </button>

            {open && (
                <div class="grid gap-2 border-t border-base-300/60 px-2.5 py-2">
                    {mission.description && (
                        <p class="line-clamp-4 text-[11px] leading-relaxed text-base-content/60">{mission.description}</p>
                    )}
                    {mission.blocked_reason && (
                        <p class="rounded bg-warning/10 px-1.5 py-1 text-[10px] text-warning-content/90">
                            {mission.blocked_reason}
                        </p>
                    )}
                    {timeline.length > 0 && (
                        <ul class="space-y-0.5">
                            {timeline.slice(-2).map((event, index) => (
                                <li key={`${mission.uuid}-t-${index}`} class="text-[10px] text-base-content/45">
                                    {event.label}
                                </li>
                            ))}
                        </ul>
                    )}
                    {featureDelivery && (
                        <FeatureDeliveryActions mission={mission} onUpdated={onReload} />
                    )}
                    <div class="flex flex-wrap gap-1">
                        {mission.status === 'open' && (
                            <button
                                class="btn btn-ghost btn-xs h-7 min-h-7 gap-1"
                                type="button"
                                title="Marquer en cours"
                                onClick={() => onStatus(mission, 'in_progress')}
                            >
                                <Circle class="size-3.5" aria-hidden />
                                Prendre
                            </button>
                        )}
                        {mission.status === 'blocked' && (
                            <>
                                <button
                                    class="btn btn-warning btn-xs h-7 min-h-7 gap-1"
                                    type="button"
                                    title="Fournir secret / token"
                                    onClick={onFocusInbox}
                                >
                                    <KeyRound class="size-3.5" aria-hidden />
                                    Secret
                                </button>
                                <button
                                    class="btn btn-ghost btn-xs h-7 min-h-7 gap-1"
                                    type="button"
                                    title="Relancer (repasser en ouvert)"
                                    onClick={() => onStatus(mission, 'open')}
                                >
                                    <RotateCcw class="size-3.5" aria-hidden />
                                    Relancer
                                </button>
                            </>
                        )}
                        {mission.status === 'in_progress' && (
                            <button
                                class="btn btn-ghost btn-xs h-7 min-h-7 gap-1"
                                type="button"
                                title="Remettre en ouvert"
                                onClick={() => onStatus(mission, 'open')}
                            >
                                <RotateCcw class="size-3.5" aria-hidden />
                                Rouvrir
                            </button>
                        )}
                        {mission.status !== 'done' && mission.status !== 'cancelled' && (
                            <button
                                class="btn btn-ghost btn-xs h-7 min-h-7 gap-1 text-success"
                                type="button"
                                title="Terminer"
                                onClick={() => onStatus(mission, 'done')}
                            >
                                <CheckCircle class="size-3.5" aria-hidden />
                                Terminer
                            </button>
                        )}
                    </div>
                </div>
            )}
        </li>
    );
}

function MissionColumn({
    column,
    missions,
    onStatus,
    onFocusInbox,
    onReload,
    onBulkComplete,
    bulkCompleting = false,
}: {
    column: (typeof columns)[number];
    missions: AgentMission[];
    onStatus: (mission: AgentMission, status: AgentMissionStatus) => void;
    onFocusInbox: () => void;
    onReload: () => void;
    onBulkComplete?: () => void;
    bulkCompleting?: boolean;
}) {
    const [expanded, setExpanded] = useState(false);
    const { visible, hiddenCount, limit } = visibleMissionsForColumn(missions, column.status, expanded);
    const canCollapse = expanded && missions.length > limit;
    const showBulkComplete = column.status === 'in_progress' && missions.length > 0 && Boolean(onBulkComplete);

    return (
        <div class="flex min-h-0 min-w-0 flex-col rounded-lg bg-base-200/40 p-2">
            <div class="mb-2 flex items-start justify-between gap-2 px-1">
                <div class="min-w-0">
                    <h4 class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
                        {column.title}
                        <span class="badge badge-ghost badge-xs tabular-nums">{missions.length}</span>
                    </h4>
                    <p class="text-[10px] text-base-content/45">{column.hint}</p>
                </div>
                {showBulkComplete && (
                    <button
                        type="button"
                        class="btn btn-ghost btn-xs h-7 min-h-7 shrink-0 gap-1 text-success"
                        title="Terminer toutes les missions en cours"
                        disabled={bulkCompleting}
                        onClick={onBulkComplete}
                    >
                        {bulkCompleting
                            ? <span class="loading loading-spinner loading-xs" aria-hidden />
                            : <CheckCheck class="size-3.5" aria-hidden />}
                        <span class="hidden sm:inline">Tout terminer</span>
                    </button>
                )}
            </div>
            <ul class="grid max-h-[22rem] gap-1.5 overflow-y-auto">
                {missions.length === 0 ? (
                    <li class="px-1 py-2 text-[11px] text-base-content/40">Vide</li>
                ) : (
                    visible.map((mission) => (
                        <MissionCard
                            key={mission.uuid}
                            mission={mission}
                            onStatus={onStatus}
                            onFocusInbox={onFocusInbox}
                            onReload={onReload}
                        />
                    ))
                )}
            </ul>
            {hiddenCount > 0 && (
                <button
                    type="button"
                    class="btn btn-ghost btn-xs mt-1.5 h-7 min-h-7 w-full justify-center"
                    onClick={() => setExpanded(true)}
                >
                    +{hiddenCount} de plus
                </button>
            )}
            {canCollapse && (
                <button
                    type="button"
                    class="btn btn-ghost btn-xs mt-1.5 h-7 min-h-7 w-full justify-center"
                    onClick={() => setExpanded(false)}
                >
                    Réduire
                </button>
            )}
        </div>
    );
}

export function MissionBoardPanel() {
    const { agentsEnabled } = useTeamContext();
    const [title, setTitle] = useState('');
    const [kind, setKind] = useState('other');
    const [submitting, setSubmitting] = useState(false);
    const [bulkCompleting, setBulkCompleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const query = useApiQuery(
        agentsEnabled ? 'agent-missions-kanban' : null,
        () => domainApi.agentMissions({ limit: 80 }),
    );

    const missions = query.data?.data ?? [];
    const byStatus = useMemo(() => groupMissionsByStatus(missions), [missions]);
    const inProgressCount = byStatus.in_progress.length;

    const focusInbox = () => {
        const el = document.getElementById('agent-user-requests-inbox');
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const handleCreate = async (event: Event) => {
        event.preventDefault();
        const trimmed = title.trim();
        if (!trimmed) {
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            await domainApi.createAgentMission({
                title: trimmed,
                kind,
                status: 'open',
                priority: 'normal',
                assignee_type: kind === 'bug' ? 'debug' : 'devforge',
            });
            setTitle('');
            await query.reload({ silent: true });
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Création impossible.');
        } finally {
            setSubmitting(false);
        }
    };

    const setStatus = async (mission: AgentMission, status: AgentMissionStatus) => {
        try {
            await domainApi.updateAgentMission(mission.uuid, {
                status,
                ...(status === 'open' ? { blocked_reason: null } : {}),
            });
            await query.reload({ silent: true });
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Mise à jour impossible.');
        }
    };

    const completeInProgress = async () => {
        const count = byStatus.in_progress.length;
        if (count === 0) {
            return;
        }

        if (!window.confirm(
            `Terminer les ${count} mission${count > 1 ? 's' : ''} « En cours » ?\n`
            + 'Utile pour les claims fantômes (runs déjà finis).',
        )) {
            return;
        }

        setBulkCompleting(true);
        setError(null);
        try {
            const response = await domainApi.bulkUpdateAgentMissions({
                from_status: 'in_progress',
                to_status: 'done',
            });
            await query.reload({ silent: true });
            if (response.meta.updated === 0) {
                setError('Aucune mission en cours à terminer.');
            }
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Clôture en masse impossible.');
        } finally {
            setBulkCompleting(false);
        }
    };

    if (!agentsEnabled) {
        return null;
    }

    return (
        <section class="min-w-0 overflow-hidden rounded-xl border border-base-300 bg-base-100 p-3 sm:p-4">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div class="min-w-0">
                    <h3 class="text-sm font-semibold">
                        Kanban — Travail de l’équipe
                        <span class="badge badge-primary badge-sm ml-2">missions</span>
                    </h3>
                    <p class="text-xs text-base-content/55">
                        La veille et le worker claiment des missions → elles passent en « En cours ».
                        Ouvre une carte pour les détails, ou termine celles qui sont obsolètes.
                    </p>
                    {inProgressCount > 5 && (
                        <p class="mt-1 text-[11px] text-warning">
                            {inProgressCount} missions en cours — beaucoup restent là si l’agent n’a pas clôturé le run.
                        </p>
                    )}
                </div>
                <div class="flex shrink-0 items-center gap-1">
                    {inProgressCount > 0 && (
                        <button
                            class="btn btn-ghost btn-xs h-8 min-h-8 gap-1 text-success"
                            type="button"
                            disabled={bulkCompleting}
                            onClick={() => void completeInProgress()}
                        >
                            {bulkCompleting
                                ? <span class="loading loading-spinner loading-xs" aria-hidden />
                                : <CheckCheck class="size-3.5" aria-hidden />}
                            Terminer les en cours ({inProgressCount})
                        </button>
                    )}
                    <button class="btn btn-ghost btn-xs btn-square size-8 min-h-8 p-0" type="button" onClick={() => void query.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                    </button>
                </div>
            </div>

            <form class="mb-4 flex min-w-0 flex-wrap gap-2" onSubmit={handleCreate}>
                <input
                    class="input input-bordered input-sm min-w-0 flex-1 basis-full sm:basis-auto sm:min-w-[12rem]"
                    placeholder="Nouvelle mission…"
                    value={title}
                    onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
                />
                <select
                    class="select select-bordered select-sm"
                    value={kind}
                    onChange={(e) => setKind((e.target as HTMLSelectElement).value)}
                >
                    {Object.entries(MISSION_KIND_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                    ))}
                </select>
                <button class="btn btn-primary btn-sm" type="submit" disabled={submitting || !title.trim()}>
                    <Plus class="size-3.5" aria-hidden />
                    Ajouter
                </button>
            </form>

            {error && <p class="mb-2 text-xs text-error">{error}</p>}
            {query.error && <p class="mb-2 text-xs text-error">{query.error}</p>}

            {query.loading && missions.length === 0 ? (
                <p class="text-xs text-base-content/50">Chargement…</p>
            ) : (
                <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {columns.map((column) => (
                        <MissionColumn
                            key={column.id}
                            column={column}
                            missions={byStatus[column.status]}
                            onStatus={(m, s) => void setStatus(m, s)}
                            onFocusInbox={focusInbox}
                            onReload={() => void query.reload({ silent: true })}
                            onBulkComplete={column.status === 'in_progress' ? () => void completeInProgress() : undefined}
                            bulkCompleting={bulkCompleting}
                        />
                    ))}
                </div>
            )}
        </section>
    );
}
