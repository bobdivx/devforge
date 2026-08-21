import type { AgentType } from './domain-api';
import { applySchedulePreset } from './agent-schedule-presets';
import { defaultScheduleForType } from './agent-presets';
import { isEventOnlyAgentType } from './agent-triggers';
import type { BotShape } from './bot-character';

export const BOT_STUDIO_TOOLS_KEY = 'devforge.bot-studio.tools';

export type BotMission = {
    id: string;
    type: AgentType;
    label: string;
    name: string;
    description: string;
    color: string;
    shape: BotShape;
    delay: string;
    schedulePreset?: string;
};

export type BotTool = {
    id: string;
    label: string;
    hint: string;
    comingSoon?: boolean;
};

export type BotSuggestion = {
    id: string;
    type: AgentType;
    name: string;
    description: string;
    color: string;
    shape: BotShape;
    schedulePreset?: string;
};

export const BOT_MISSIONS: BotMission[] = [
    {
        id: 'deploy-watch',
        type: 'deployment',
        label: 'Relanceur de déploiements',
        name: 'Relanceur de déploiements',
        description: 'Suit les builds, diagnostique les échecs et relance après correction.',
        color: '#ef4444',
        shape: 'circle',
        delay: '0s',
    },
    {
        id: 'weekly-sync',
        type: 'tech-watch',
        label: 'Point hebdomadaire',
        name: 'Point hebdomadaire',
        description: 'Prépare la synthèse tech du lundi matin et ouvre des missions.',
        color: '#14b8a6',
        shape: 'circle',
        delay: '0.35s',
        schedulePreset: 'workday-morning',
    },
    {
        id: 'app-health',
        type: 'debug',
        label: 'Santé des applications',
        name: 'Santé des applications',
        description: 'Lit logs et métriques, signale les régressions, propose un correctif.',
        color: '#3b82f6',
        shape: 'circle',
        delay: '0.7s',
    },
];

export const BOT_TOOLS: BotTool[] = [
    { id: 'github', label: 'GitHub', hint: 'Dépôts, PR, source' },
    { id: 'github-actions', label: 'GitHub Actions', hint: 'CI / workflows' },
    { id: 'docker', label: 'Docker', hint: 'Images et conteneurs' },
    { id: 'traefik', label: 'Traefik', hint: 'Proxy et domaines' },
    { id: 'postgres', label: 'PostgreSQL', hint: 'Bases gérées' },
    { id: 'slack', label: 'Slack', hint: 'Notifications équipe' },
    { id: 'discord', label: 'Discord', hint: 'Alertes salon' },
    { id: 'telegram', label: 'Telegram', hint: 'Alertes mobiles' },
    { id: 'email', label: 'E-mail', hint: 'Rapports et alertes' },
    { id: 'sentry', label: 'Sentry', hint: 'Erreurs applicatives', comingSoon: true },
    { id: 'grafana', label: 'Grafana', hint: 'Tableaux de bord', comingSoon: true },
    { id: 'notion', label: 'Notion', hint: 'Docs d’équipe', comingSoon: true },
];

export const BOT_SUGGESTIONS: BotSuggestion[] = [
    {
        id: 'qa',
        type: 'debug',
        name: 'Ingénieur QA',
        description: 'Teste les déploiements GitHub et rapporte les régressions.',
        color: '#22c55e',
        shape: 'cloud',
    },
    {
        id: 'night',
        type: 'tech-watch',
        name: 'Équipe de nuit',
        description: 'Travaille la nuit et prépare la synthèse du matin.',
        color: '#f97316',
        shape: 'triangle',
        schedulePreset: 'workday-morning',
    },
    {
        id: 'ci',
        type: 'github-actions',
        name: 'Correcteur CI',
        description: 'Trie les échecs de workflows et relance après correctif.',
        color: '#3b82f6',
        shape: 'squircle',
    },
];

export function filterBotTools(tools: BotTool[], query: string): BotTool[] {
    const needle = query.trim().toLowerCase();
    if (needle === '') {
        return tools;
    }

    return tools.filter((tool) => (
        tool.label.toLowerCase().includes(needle)
        || tool.hint.toLowerCase().includes(needle)
        || tool.id.includes(needle)
    ));
}

export function loadSelectedTools(): string[] {
    if (typeof localStorage === 'undefined') {
        return [];
    }

    try {
        const raw = localStorage.getItem(BOT_STUDIO_TOOLS_KEY);
        if (!raw) {
            return [];
        }

        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed.filter((id): id is string => typeof id === 'string' && BOT_TOOLS.some((tool) => tool.id === id && !tool.comingSoon));
    } catch {
        return [];
    }
}

export function saveSelectedTools(ids: string[]): void {
    if (typeof localStorage === 'undefined') {
        return;
    }

    const allowed = ids.filter((id) => BOT_TOOLS.some((tool) => tool.id === id && !tool.comingSoon));
    localStorage.setItem(BOT_STUDIO_TOOLS_KEY, JSON.stringify(allowed));
}

export function hasCompletedToolsOnboarding(): boolean {
    return loadSelectedTools().length > 0;
}

export function scheduleForMission(mission: Pick<BotMission, 'type' | 'schedulePreset'>): {
    schedule_minutes: number;
    schedule_cron: string | null;
} {
    if (isEventOnlyAgentType(mission.type)) {
        return { schedule_minutes: 0, schedule_cron: null };
    }

    if (mission.schedulePreset) {
        return applySchedulePreset(mission.schedulePreset);
    }

    return {
        schedule_minutes: defaultScheduleForType(mission.type),
        schedule_cron: null,
    };
}
