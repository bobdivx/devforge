import type { Agent, AgentInput } from './domain-api';
import { isEventOnlyAgentType } from './agent-triggers';
import { applySchedulePreset } from './agent-schedule-presets';

export const DEFAULT_AUTOMATION_NAME = 'Santé quotidienne DevForge';

export const DEFAULT_AUTOMATION_DESCRIPTION =
    'Chaque jour ouvré, inspecte le dépôt et ouvre une PR pour les correctifs petits et sûrs.';

export const DEFAULT_AUTOMATION_INSTRUCTIONS = `Tu es l'agent de santé quotidienne du dépôt DevForge.

À chaque exécution planifiée :
1. Inspecte le dépôt sur la branche main (hygiène, régressions évidentes, tests unitaires ciblés si pertinents).
2. Si tu identifies un correctif petit et sûr, ouvre une pull request. Ne merge rien.
3. Sinon, note le constat en mémoire et arrête-toi.

Interdits : secrets, migrations destructives, force push, changements hors périmètre.
Si rien n'est sûr à corriger, n'ouvre pas de PR.`;

export const DEFAULT_AUTOMATION_PRESET_ID = 'workday-morning';

export function isScheduledAutomation(agent: Pick<Agent, 'type' | 'schedule_minutes' | 'schedule_cron'>): boolean {
    if (isEventOnlyAgentType(agent.type)) {
        return false;
    }

    const cron = (agent.schedule_cron ?? '').trim();

    return cron !== '' || agent.schedule_minutes > 0;
}

export function selectScheduledAutomations(agents: Agent[]): Agent[] {
    return agents.filter((agent) => isScheduledAutomation(agent));
}

export function defaultAutomationInput(overrides: Partial<AgentInput> = {}): AgentInput {
    const schedule = applySchedulePreset(DEFAULT_AUTOMATION_PRESET_ID);

    return {
        type: 'tech-watch',
        name: DEFAULT_AUTOMATION_NAME,
        description: DEFAULT_AUTOMATION_DESCRIPTION,
        system_prompt: DEFAULT_AUTOMATION_INSTRUCTIONS,
        schedule_minutes: schedule.schedule_minutes,
        schedule_cron: schedule.schedule_cron,
        heartbeat_enabled: true,
        is_active: true,
        ...overrides,
    };
}
