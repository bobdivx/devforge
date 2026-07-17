import type { AgentRun, AgentRunStatus } from './domain-api';

export const TERMINAL_AGENT_RUN_STATUSES: AgentRunStatus[] = ['completed', 'failed', 'awaiting_approval'];

export function isTerminalAgentRunStatus(status: AgentRunStatus): boolean {
    return status === 'completed' || status === 'failed' || status === 'awaiting_approval';
}

export function parseLastAgentLogLine(logs: string | null | undefined, maxLength = 140): string | null {
    if (!logs?.trim()) {
        return null;
    }

    const lastLine = logs.trim().split('\n').filter(Boolean).at(-1) ?? null;

    if (!lastLine) {
        return null;
    }

    const withoutTimestamp = lastLine.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '');

    if (withoutTimestamp.length <= maxLength) {
        return withoutTimestamp;
    }

    return `${withoutTimestamp.slice(0, maxLength - 1)}…`;
}

export function agentRunProgressLabel(run: AgentRun | null): string | null {
    if (!run) {
        return null;
    }

    if (run.status === 'completed') {
        return run.summary?.trim() || 'Exécution terminée.';
    }

    if (run.status === 'awaiting_approval') {
        return run.summary?.trim() || 'Approbation requise.';
    }

    if (run.status === 'failed') {
        return run.summary?.trim() || 'Exécution échouée.';
    }

    if (run.iterations > 0) {
        return `Itération #${run.iterations}…`;
    }

    return 'Démarrage de l\'agent…';
}
