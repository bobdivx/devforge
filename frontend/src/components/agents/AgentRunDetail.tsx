import type { AgentRun } from '../../lib/domain-api';
import { domainApi } from '../../lib/domain-api';
import { useState } from 'preact/hooks';
import { AgentModelRoutingBadge } from './AgentModelRoutingBadge';
import { AgentRunLog } from './AgentRunLog';
import { AgentRunProgress } from './AgentRunProgress';
import { AgentRunStatusBadge } from './AgentRunStatusBadge';
import { AgentTeamContributionsPanel } from './AgentTeamContributionsPanel';

type Props = {
    run: AgentRun;
    agentUuid?: string;
    tracking?: boolean;
    onResolved?: () => void;
};

export function AgentRunDetail({ run, agentUuid, tracking = false, onResolved }: Props) {
    const isActive = tracking || run.status === 'running' || run.status === 'pending';
    const pendingMeta = run.metadata?.pending_approval;
    const pending = run.status === 'awaiting_approval'
        && pendingMeta?.status === 'ask'
        && !pendingMeta?.resolved;
    const [resolving, setResolving] = useState(false);

    const resolve = async (decision: 'approve' | 'deny') => {
        if (!agentUuid || resolving) {
            return;
        }
        setResolving(true);
        try {
            await domainApi.resolveAgentRunApproval(agentUuid, run.uuid, decision);
            onResolved?.();
        } finally {
            setResolving(false);
        }
    };

    return (
        <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 sm:gap-3 md:gap-2.5 sm:gap-3 md:gap-4 rounded-xl border border-base-300 bg-base-200/20 p-3 sm:p-4">
            <div class="flex flex-col gap-2 border-b border-base-300/80 pb-3 lg:flex-row lg:items-start lg:gap-3">
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                    <AgentRunStatusBadge status={run.status} />
                    <AgentModelRoutingBadge routing={run.metadata?.model_routing} />
                </div>
                {run.summary && (
                    <p class="min-w-0 text-xs sm:text-sm font-medium leading-snug text-base-content lg:flex-1">{run.summary}</p>
                )}
            </div>

            {pending && agentUuid && (
                <div class="rounded-lg border border-warning/40 bg-warning/10 p-3">
                    <p class="mb-2 text-xs font-semibold text-base-content">
                        Approbation requise : {pendingMeta?.tool ?? 'outil'}
                    </p>
                    <p class="mb-3 text-xs text-base-content/70">
                        {pendingMeta?.reason}
                    </p>
                    <div class="flex flex-wrap gap-2">
                        <button type="button" class="btn btn-success btn-sm" disabled={resolving} onClick={() => void resolve('approve')}>
                            Approuver
                        </button>
                        <button type="button" class="btn btn-ghost btn-sm" disabled={resolving} onClick={() => void resolve('deny')}>
                            Refuser
                        </button>
                    </div>
                </div>
            )}

            {isActive && <AgentRunProgress run={run} />}

            <AgentTeamContributionsPanel report={run.metadata?.team_report} />

            {(run.metadata?.ephemeral_tasks?.length ?? 0) > 0 && !run.metadata?.team_report && (
                <div class="rounded-lg border border-base-300 bg-base-200/40 p-3">
                    <p class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-base-content/50">
                        Sous-tâches éphémères
                    </p>
                    <ul class="space-y-2">
                        {run.metadata?.ephemeral_tasks?.map((task) => (
                            <li key={task.run_uuid} class="text-xs">
                                <div class="flex flex-wrap items-center gap-2">
                                    <AgentModelRoutingBadge routing={{
                                        tier: task.tier as 'light' | 'standard' | 'heavy',
                                        tier_label: task.tier_label,
                                        model_label: task.model_label,
                                        reason: task.goal,
                                        display: task.display,
                                    }} compact ephemeral />
                                    {task.role_slug && (
                                        <span class="text-base-content/60">{task.role_slug}</span>
                                    )}
                                    <span class="text-base-content/50">{task.status}</span>
                                </div>
                                <p class="mt-1 text-base-content/70">{task.goal}</p>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <AgentRunLog logs={run.logs} class="min-h-[8rem] min-w-0 lg:max-h-[min(28rem,50vh)] lg:flex-1" />
        </div>
    );
}
