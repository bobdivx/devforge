import type { AgentRun } from '../../lib/domain-api';
import { AgentModelRoutingBadge } from './AgentModelRoutingBadge';
import { AgentRunLog } from './AgentRunLog';
import { AgentRunProgress } from './AgentRunProgress';
import { AgentRunStatusBadge } from './AgentRunStatusBadge';

type Props = {
    run: AgentRun;
    tracking?: boolean;
};

export function AgentRunDetail({ run, tracking = false }: Props) {
    const isActive = tracking || run.status === 'running' || run.status === 'pending';

    return (
        <div class="flex min-h-0 flex-1 flex-col gap-4 rounded-xl border border-base-300 bg-base-200/20 p-4">
            <div class="flex flex-wrap items-start gap-3 border-b border-base-300/80 pb-3">
                <AgentRunStatusBadge status={run.status} />
                <AgentModelRoutingBadge routing={run.metadata?.model_routing} />
                {run.summary && (
                    <p class="min-w-0 flex-1 text-sm font-medium leading-snug text-base-content">{run.summary}</p>
                )}
            </div>

            {isActive && <AgentRunProgress run={run} />}

            {(run.metadata?.ephemeral_tasks?.length ?? 0) > 0 && (
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
                                    <span class="text-base-content/50">{task.status}</span>
                                </div>
                                <p class="mt-1 text-base-content/70">{task.goal}</p>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <AgentRunLog logs={run.logs} class="max-h-[min(28rem,50vh)] flex-1" />
        </div>
    );
}
