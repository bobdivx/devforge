import type { AgentType, AgentTriggerMode } from './domain-api';

export function isEventOnlyAgentType(type: AgentType): boolean {
    return type === 'devforge';
}

export function triggerModeLabel(mode: AgentTriggerMode): string {
    switch (mode) {
        case 'webhook':
            return 'Webhook (build)';
        case 'schedule':
            return 'Planifié';
        default:
            return 'Manuel';
    }
}

export function scheduleLabel(agent: { type: AgentType; schedule_minutes: number; trigger_mode?: AgentTriggerMode }): string {
    if (agent.trigger_mode === 'webhook' || isEventOnlyAgentType(agent.type)) {
        return 'À chaque build webhook';
    }

    if (agent.schedule_minutes > 0) {
        return `Toutes les ${agent.schedule_minutes} min`;
    }

    return 'Manuel';
}
