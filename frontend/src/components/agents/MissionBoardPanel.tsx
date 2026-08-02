import { CheckCircle, Circle, KeyRound, Plus, RefreshCw, RotateCcw } from 'lucide-preact';
import { useMemo, useState } from 'preact/hooks';
import type { AgentMission, AgentMissionStatus } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { ApiError } from '../../lib/api-client';
import { useApiQuery } from '../../lib/use-api-query';
import { useTeamContext } from '../../lib/team-context';

const kindLabels: Record<string, string> = {
    bug: 'Bug',
    feature: 'Feature',
    tech_watch: 'Veille',
    github_pr: 'PR',
    ops: 'Ops',
    other: 'Autre',
};

const columns: Array<{ id: AgentMissionStatus | 'done_recent'; status: AgentMissionStatus; title: string; hint: string }> = [
    { id: 'open', status: 'open', title: 'Ouvert', hint: 'À prendre' },
    { id: 'in_progress', status: 'in_progress', title: 'En cours', hint: 'Agents au travail' },
    { id: 'blocked', status: 'blocked', title: 'Bloqué (toi)', hint: 'Secret / token / confirm' },
    { id: 'done', status: 'done', title: 'Terminé', hint: 'Récents' },
];

function MissionCard({
    mission,
    onStatus,
    onFocusInbox,
}: {
    mission: AgentMission;
    onStatus: (mission: AgentMission, status: AgentMissionStatus) => void;
    onFocusInbox: () => void;
}) {
    const timeline = mission.timeline ?? [];

    return (
        <li class="rounded-lg border border-base-300/80 bg-base-100 px-3 py-2 shadow-sm">
            <div class="flex flex-wrap items-center gap-1.5">
                <span class="badge badge-ghost badge-xs">{kindLabels[mission.kind] ?? mission.kind}</span>
                {mission.priority && mission.priority !== 'normal' && (
                    <span class="badge badge-outline badge-xs">{mission.priority}</span>
                )}
            </div>
            <p class="mt-1 text-sm font-medium leading-snug">{mission.title}</p>
            {mission.description && (
                <p class="mt-0.5 line-clamp-2 text-[11px] text-base-content/55">{mission.description}</p>
            )}
            <div class="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-base-content/50">
                {mission.assignee_name && <span>→ {mission.assignee_name}</span>}
                {mission.assignee_type && !mission.assignee_name && <span>→ {mission.assignee_type}</span>}
                {mission.agent_name && <span>par {mission.agent_name}</span>}
                {mission.run_uuid && <span>run {mission.run_uuid.slice(0, 8)}</span>}
            </div>
            {mission.blocked_reason && (
                <p class="mt-1 rounded bg-warning/10 px-1.5 py-1 text-[10px] text-warning-content/90">
                    {mission.blocked_reason}
                </p>
            )}
            {timeline.length > 0 && (
                <ul class="mt-2 space-y-0.5 border-t border-base-300/60 pt-1.5">
                    {timeline.slice(0, 3).map((event, index) => (
                        <li key={`${mission.uuid}-t-${index}`} class="text-[10px] text-base-content/45">
                            {event.label}
                        </li>
                    ))}
                </ul>
            )}
            <div class="mt-2 flex flex-wrap gap-1">
                {mission.status === 'open' && (
                    <button
                        class="btn btn-ghost btn-xs"
                        type="button"
                        title="Marquer en cours"
                        onClick={() => onStatus(mission, 'in_progress')}
                    >
                        <Circle class="size-3.5" aria-hidden />
                    </button>
                )}
                {mission.status === 'blocked' && (
                    <>
                        <button
                            class="btn btn-warning btn-xs"
                            type="button"
                            title="Fournir secret / token"
                            onClick={onFocusInbox}
                        >
                            <KeyRound class="size-3.5" aria-hidden />
                            Secret
                        </button>
                        <button
                            class="btn btn-ghost btn-xs"
                            type="button"
                            title="Relancer (repasser en ouvert)"
                            onClick={() => onStatus(mission, 'open')}
                        >
                            <RotateCcw class="size-3.5" aria-hidden />
                            Relancer
                        </button>
                    </>
                )}
                {mission.status !== 'done' && mission.status !== 'cancelled' && (
                    <button
                        class="btn btn-ghost btn-xs text-success"
                        type="button"
                        title="Terminer"
                        onClick={() => onStatus(mission, 'done')}
                    >
                        <CheckCircle class="size-3.5" aria-hidden />
                    </button>
                )}
            </div>
        </li>
    );
}

export function MissionBoardPanel() {
    const { agentsEnabled } = useTeamContext();
    const [title, setTitle] = useState('');
    const [kind, setKind] = useState('other');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const query = useApiQuery(
        agentsEnabled ? 'agent-missions-kanban' : null,
        () => domainApi.agentMissions({ limit: 80 }),
    );

    const missions = query.data?.data ?? [];

    const byStatus = useMemo(() => {
        const map: Record<string, AgentMission[]> = {
            open: [],
            in_progress: [],
            blocked: [],
            done: [],
        };
        for (const mission of missions) {
            const status = String(mission.status);
            if (status === 'cancelled') {
                continue;
            }
            if (status === 'done') {
                map.done.push(mission);
            } else if (status in map) {
                map[status].push(mission);
            } else {
                map.open.push(mission);
            }
        }
        map.done = map.done.slice(0, 12);
        return map;
    }, [missions]);

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

    if (!agentsEnabled) {
        return null;
    }

    return (
        <section class="rounded-xl border border-base-300 bg-base-100 p-4">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h3 class="text-sm font-semibold">Travail de l’équipe</h3>
                    <p class="text-xs text-base-content/55">
                        Kanban missions — VT propose, implementer / debug exécutent.
                    </p>
                </div>
                <button class="btn btn-ghost btn-xs" type="button" onClick={() => void query.reload()}>
                    <RefreshCw class="size-3.5" aria-hidden />
                </button>
            </div>

            <form class="mb-4 flex flex-wrap gap-2" onSubmit={handleCreate}>
                <input
                    class="input input-bordered input-sm min-w-[12rem] flex-1"
                    placeholder="Nouvelle mission…"
                    value={title}
                    onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
                />
                <select
                    class="select select-bordered select-sm"
                    value={kind}
                    onChange={(e) => setKind((e.target as HTMLSelectElement).value)}
                >
                    {Object.entries(kindLabels).map(([value, label]) => (
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
                        <div key={column.id} class="rounded-lg bg-base-200/40 p-2">
                            <div class="mb-2 px-1">
                                <h4 class="text-xs font-semibold uppercase tracking-wide">{column.title}</h4>
                                <p class="text-[10px] text-base-content/45">{column.hint}</p>
                            </div>
                            <ul class="grid gap-2">
                                {(byStatus[column.status] ?? []).length === 0 ? (
                                    <li class="px-1 text-[11px] text-base-content/40">Vide</li>
                                ) : (
                                    (byStatus[column.status] ?? []).map((mission) => (
                                        <MissionCard
                                            key={mission.uuid}
                                            mission={mission}
                                            onStatus={(m, s) => void setStatus(m, s)}
                                            onFocusInbox={focusInbox}
                                        />
                                    ))
                                )}
                            </ul>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
