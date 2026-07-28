import type { DeploymentAgentRun } from './api/domain';

function isAgentRunActive(status: string): boolean {
    return status === 'pending'
        || status === 'running'
        || status === 'waiting_for_subagents';
}

export function countActiveSubagentTasks(
    tasks: Array<{ status?: string }> | null | undefined,
): number {
    if (!Array.isArray(tasks)) {
        return 0;
    }

    return tasks.filter((task) => {
        const status = String(task.status ?? '');
        return status === 'pending' || status === 'running' || status === 'queued';
    }).length;
}

/**
 * Choisit le run à afficher dans la carte Agent IA (au plus un).
 * - Mode live : uniquement le run en cours (pending / running / waiting_for_subagents)
 * - Mode historique : le run le plus récent de cette tentative
 * - Exclut toujours les runs d’une autre tentative
 */
export function selectVisibleAgentRuns(
    runs: DeploymentAgentRun[],
    options: { historyMode?: boolean } = {},
): DeploymentAgentRun[] {
    const ownRuns = runs.filter((run) => !run.historical_for_other_attempt);
    const activeRuns = ownRuns.filter((run) => isAgentRunActive(run.status));

    if (activeRuns.length > 0) {
        return [activeRuns[0]];
    }

    if (options.historyMode) {
        return ownRuns.length > 0 ? [ownRuns[0]] : [];
    }

    return [];
}
