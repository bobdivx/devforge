import { CheckCircle, Circle, Plus, RefreshCw } from 'lucide-preact';
import { useState } from 'preact/hooks';
import type { AgentMission, AgentMissionStatus } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { ApiError } from '../../lib/api-client';
import { useApiQuery } from '../../lib/use-api-query';
import { useTeamContext } from '../../lib/team-context';

const statusLabels: Record<string, string> = {
    open: 'Ouverte',
    in_progress: 'En cours',
    blocked: 'Bloquée',
    done: 'Terminée',
    cancelled: 'Annulée',
};

const kindLabels: Record<string, string> = {
    bug: 'Bug',
    feature: 'Feature',
    tech_watch: 'Veille',
    github_pr: 'PR',
    ops: 'Ops',
    other: 'Autre',
};

export function MissionBoardPanel() {
    const { agentsEnabled } = useTeamContext();
    const [statusFilter, setStatusFilter] = useState<string>('open');
    const [title, setTitle] = useState('');
    const [kind, setKind] = useState('other');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const query = useApiQuery(
        agentsEnabled ? `agent-missions:${statusFilter}` : null,
        () => domainApi.agentMissions({
            status: statusFilter === 'all' ? undefined : statusFilter,
            limit: 40,
        }),
    );

    const missions = query.data?.data ?? [];

    const handleCreate = async (event: Event) => {
        event.preventDefault();
        const trimmed = title.trim();
        if (! trimmed) {
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            await domainApi.createAgentMission({ title: trimmed, kind, status: 'open', priority: 'normal' });
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
            await domainApi.updateAgentMission(mission.uuid, { status });
            await query.reload({ silent: true });
        } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Mise à jour impossible.');
        }
    };

    if (! agentsEnabled) {
        return null;
    }

    return (
        <section class="rounded-xl border border-base-300 bg-base-100 p-4">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h3 class="text-sm font-semibold">Mission board</h3>
                    <p class="text-xs text-base-content/55">Bugs, features et demandes veille tech.</p>
                </div>
                <div class="flex items-center gap-2">
                    <select
                        class="select select-bordered select-xs"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter((e.target as HTMLSelectElement).value)}
                    >
                        <option value="open">Ouvertes</option>
                        <option value="in_progress">En cours</option>
                        <option value="all">Toutes</option>
                        <option value="done">Terminées</option>
                    </select>
                    <button class="btn btn-ghost btn-xs" type="button" onClick={() => void query.reload()}>
                        <RefreshCw class="size-3.5" aria-hidden />
                    </button>
                </div>
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
                <button class="btn btn-primary btn-sm" type="submit" disabled={submitting || ! title.trim()}>
                    <Plus class="size-3.5" aria-hidden />
                    Ajouter
                </button>
            </form>

            {error && <p class="mb-2 text-xs text-error">{error}</p>}
            {query.error && <p class="mb-2 text-xs text-error">{query.error}</p>}

            {query.loading && missions.length === 0 ? (
                <p class="text-xs text-base-content/50">Chargement…</p>
            ) : missions.length === 0 ? (
                <p class="text-xs text-base-content/50">Aucune mission pour ce filtre.</p>
            ) : (
                <ul class="grid gap-2">
                    {missions.map((mission) => (
                        <li key={mission.uuid} class="flex items-start justify-between gap-3 rounded-lg border border-base-300/80 px-3 py-2">
                            <div class="min-w-0">
                                <div class="flex flex-wrap items-center gap-2">
                                    <span class="badge badge-ghost badge-xs">{kindLabels[mission.kind] ?? mission.kind}</span>
                                    <span class="badge badge-outline badge-xs">{statusLabels[mission.status] ?? mission.status}</span>
                                    <span class="truncate text-sm font-medium">{mission.title}</span>
                                </div>
                                {mission.description && (
                                    <p class="mt-0.5 line-clamp-2 text-[11px] text-base-content/55">{mission.description}</p>
                                )}
                            </div>
                            <div class="flex shrink-0 gap-1">
                                {mission.status !== 'in_progress' && mission.status !== 'done' && (
                                    <button
                                        class="btn btn-ghost btn-xs"
                                        type="button"
                                        title="Marquer en cours"
                                        onClick={() => void setStatus(mission, 'in_progress')}
                                    >
                                        <Circle class="size-3.5" aria-hidden />
                                    </button>
                                )}
                                {mission.status !== 'done' && (
                                    <button
                                        class="btn btn-ghost btn-xs text-success"
                                        type="button"
                                        title="Terminer"
                                        onClick={() => void setStatus(mission, 'done')}
                                    >
                                        <CheckCircle class="size-3.5" aria-hidden />
                                    </button>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
