import type { AgentRun } from '../../lib/domain-api';
import { agentRunProgressLabel, parseLastAgentLogLine } from '../../lib/agent-run-tracker';
import { AgentModelRoutingBadge } from './AgentModelRoutingBadge';

type Props = {
    run: AgentRun;
    compact?: boolean;
};

export function AgentRunProgress({ run, compact = false }: Props) {
    const progressLabel = agentRunProgressLabel(run);
    const lastLogLine = parseLastAgentLogLine(run.logs);

    if (compact) {
        return (
            <div class="rounded-md border border-success/25 bg-success/5 px-2.5 py-2" role="status" aria-live="polite">
                <div class="flex items-center gap-2">
                    <span class="min-w-0 flex-1 truncate text-[11px] font-medium text-success">
                        {progressLabel}
                    </span>
                    <AgentModelRoutingBadge routing={run.metadata?.model_routing} compact />
                </div>
                {lastLogLine && (
                    <p class="mt-1 truncate text-[10px] text-base-content/55" title={lastLogLine}>
                        {lastLogLine}
                    </p>
                )}
            </div>
        );
    }

    return (
        <div class="rounded-lg border border-success/25 bg-success/5 p-3" role="status" aria-live="polite">
            <div class="flex items-center gap-2">
                <div class="min-w-0 flex-1">
                    <p class="text-xs font-medium text-success">{progressLabel}</p>
                    {lastLogLine && (
                        <p class="mt-0.5 truncate text-[11px] text-base-content/60" title={lastLogLine}>
                            {lastLogLine}
                        </p>
                    )}
                </div>
                <AgentModelRoutingBadge routing={run.metadata?.model_routing} />
            </div>
        </div>
    );
}
