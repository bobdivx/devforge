import type { AgentType, AgentTriggerMode } from './domain-api';
import { scheduleCronLabel } from './agent-schedule-presets';

export function isEventOnlyAgentType(type: AgentType): boolean {
    return type === 'devforge' || type === 'github-actions';
}

export function eventTriggerLabel(type: AgentType): string | null {
    switch (type) {
        case 'devforge':
            return 'À chaque build webhook (push Git, etc.). Pas de minuteur.';
        case 'github-actions':
            return 'Sur échec d’un workflow GitHub Actions (webhook workflow_run). Pas de minuteur.';
        default:
            return null;
    }
}

export function triggerModeLabel(mode: AgentTriggerMode): string {
    switch (mode) {
        case 'webhook':
            return 'Événement';
        case 'schedule':
            return 'Planifié';
        case 'cron':
            return 'Horaires';
        default:
            return 'Manuel';
    }
}

export function scheduleLabel(agent: {
    type: AgentType;
    schedule_minutes: number;
    schedule_cron?: string | null;
    trigger_mode?: AgentTriggerMode;
}): string {
    if (agent.trigger_mode === 'webhook' || isEventOnlyAgentType(agent.type)) {
        if (agent.type === 'github-actions') {
            return 'Sur échec Actions (webhook)';
        }

        return 'À chaque build webhook';
    }

    const cronLabel = scheduleCronLabel(agent.schedule_cron ?? '');
    if (cronLabel) {
        return cronLabel;
    }

    if (agent.schedule_minutes > 0) {
        return `Toutes les ${agent.schedule_minutes} min`;
    }

    return 'Manuel';
}
