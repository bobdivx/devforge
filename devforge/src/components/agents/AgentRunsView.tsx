import { Activity, RefreshCw, Zap } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import type { Agent } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { shouldOpenAgentSettings, syncAgentDetailQuery } from '../../lib/agent-routes';
import { useAgentRunTracker } from '../../lib/use-agent-run-tracker';
import { AgentRunDetail } from './AgentRunDetail';
import { RunHistoryTable } from './RunHistoryTable';

type Props = {
    agent: Agent;
    initialRunUuid?: string | null;
    onAgentUpdated: () => void;
};

export function AgentRunsView({ agent, initialRunUuid = null, onAgentUpdated }: Props) {
    const [runs, setRuns] = useState<Awaited<ReturnType<typeof domainApi.agentRuns>>['data']>([]);
    const [selectedRunUuid, setSelectedRunUuid] = useState<string | null>(initialRunUuid);
    const [selectedRun, setSelectedRun] = useState<Awaited<ReturnType<typeof domainApi.agentRun>>['data'] | null>(null);
    const [loading, setLoading] = useState(true);

    const refreshRuns = async () => {
        const response = await domainApi.agentRuns(agent.uuid);
        setRuns(response.data);
        return response.data;
    };

    const {
        isTracking,
        activeRun,
        trackExistingRun,
    } = useAgentRunTracker(agent.uuid, {
        onRefresh: () => {
            onAgentUpdated();
            void refreshRuns();
        },
    });

    useEffect(() => {
        setLoading(true);
        refreshRuns()
            .then((loaded) => {
                let preferred = initialRunUuid;

                if (!preferred && agent.status === 'running') {
                    preferred = agent.latest_run?.uuid ?? null;
                }

                if (!preferred) {
                    preferred = loaded[0]?.uuid ?? null;
                }

                if (preferred) {
                    setSelectedRunUuid(preferred);
                }
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [agent.uuid]);

    useEffect(() => {
        if (initialRunUuid) {
            setSelectedRunUuid(initialRunUuid);
        }
    }, [initialRunUuid]);

    useEffect(() => {
        if (agent.status === 'running' && agent.latest_run?.uuid && !isTracking) {
            trackExistingRun(agent.latest_run.uuid);
            setSelectedRunUuid(agent.latest_run.uuid);
        }
    }, [agent.status, agent.latest_run?.uuid, isTracking, trackExistingRun]);

    useEffect(() => {
        if (!selectedRunUuid) {
            setSelectedRun(null);
            return;
        }

        domainApi.agentRun(agent.uuid, selectedRunUuid)
            .then((response) => setSelectedRun(response.data))
            .catch(() => setSelectedRun(null));
    }, [selectedRunUuid, agent.uuid]);

    useEffect(() => {
        const hasActive = runs.some((run) => run.status === 'running' || run.status === 'pending')
            || agent.status === 'running'
            || isTracking;

        if (!hasActive) {
            return;
        }

        const interval = window.setInterval(() => {
            void refreshRuns();
            if (selectedRunUuid) {
                domainApi.agentRun(agent.uuid, selectedRunUuid)
                    .then((response) => setSelectedRun(response.data))
                    .catch(() => {});
            }
        }, 3000);

        return () => window.clearInterval(interval);
    }, [runs, agent.status, isTracking, selectedRunUuid, agent.uuid]);

    const displayRun = (isTracking && activeRun && activeRun.uuid === selectedRunUuid)
        ? activeRun
        : selectedRun;

    const hasLiveRun = runs.some((run) => run.status === 'running' || run.status === 'pending')
        || agent.status === 'running'
        || isTracking;

    return (
        <div class="flex min-h-0 flex-1 flex-col">
            {hasLiveRun && (
                <div class="flex shrink-0 items-center gap-3 border-b border-success/30 bg-success/10 px-4 py-2.5">
                    <span class="relative flex size-2.5 shrink-0">
                        <span class="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
                        <span class="relative inline-flex size-2.5 rounded-full bg-success" />
                    </span>
                    <Activity class="size-4 shrink-0 text-success" aria-hidden />
                    <p class="min-w-0 flex-1 text-xs text-success">
                        <span class="font-semibold">Exécution en cours</span>
                        <span class="text-success/80"> — les logs se mettent à jour automatiquement.</span>
                    </p>
                </div>
            )}

            <div class="flex shrink-0 items-center justify-between border-b border-base-300 bg-base-100 px-4 py-2.5">
                <p class="text-xs text-base-content/60">
                    Historique des runs autonomes
                </p>
                <button
                    class="btn btn-ghost btn-xs gap-1.5"
                    type="button"
                    onClick={() => void refreshRuns()}
                >
                    <RefreshCw class="size-3.5" aria-hidden />
                    Actualiser
                </button>
            </div>

            <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
                <aside class="shrink-0 border-b border-base-300 bg-base-200/20 lg:w-80 lg:max-w-[40%] lg:border-b-0 lg:border-e lg:overflow-y-auto">
                    {loading ? (
                        <div class="flex items-center justify-center px-4 py-10 text-xs text-base-content/50">
                            <span class="loading loading-spinner loading-sm me-2" />
                            Chargement des exécutions…
                        </div>
                    ) : (
                        <RunHistoryTable
                            runs={runs}
                            selectedUuid={selectedRunUuid}
                            onSelect={(uuid) => {
                                setSelectedRunUuid(uuid);
                                syncAgentDetailQuery({
                                    settings: shouldOpenAgentSettings(window.location.search),
                                    view: 'runs',
                                    run: uuid,
                                });
                            }}
                        />
                    )}
                </aside>

                <div class="min-h-0 flex-1 overflow-y-auto bg-base-100 p-4">
                    {displayRun ? (
                        <AgentRunDetail run={displayRun} tracking={isTracking && displayRun.uuid === activeRun?.uuid} />
                    ) : (
                        <div class="flex h-full min-h-[16rem] flex-col items-center justify-center gap-4 px-6 py-12 text-center">
                            <div class="grid size-14 place-items-center rounded-2xl border border-base-300 bg-base-200/60 text-base-content/40">
                                <Zap class="size-7" aria-hidden />
                            </div>
                            <div class="max-w-sm">
                                <p class="text-sm font-semibold text-base-content/85">Sélectionnez une exécution</p>
                                <p class="mt-1.5 text-xs leading-relaxed text-base-content/50">
                                    Choisissez un run dans la liste pour consulter le résumé, la progression et les logs détaillés.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
