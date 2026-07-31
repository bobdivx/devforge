import type { AgentType } from './domain-api';
import { isEventOnlyAgentType } from './agent-triggers';

export type AgentPresetCategory = 'reactive' | 'watch' | 'manual';

export type AgentPreset = {
    type: AgentType;
    label: string;
    description: string;
    triggerHint: string;
    category: AgentPresetCategory;
    suggestedName: string;
    defaultScheduleMinutes: number;
    recommended?: boolean;
};

export type SubAgentPreset = {
    id: string;
    type: AgentType;
    label: string;
    description: string;
    suggestedName: string;
};

const scheduleHint = (minutes: number): string => {
    if (minutes <= 0) {
        return 'Manuel (vous lancez quand vous voulez)';
    }

    if (minutes < 60) {
        return `Planifié toutes les ${minutes} min`;
    }

    if (minutes === 60) {
        return 'Planifié toutes les heures';
    }

    if (minutes % 60 === 0) {
        return `Planifié toutes les ${minutes / 60} h`;
    }

    return `Planifié toutes les ${minutes} min`;
};

export const agentPresets: AgentPreset[] = [
    {
        type: 'deployment',
        label: 'Déploiement',
        description: 'Suit les builds et corrige les déploiements en échec.',
        triggerHint: 'Déclenché par les événements de déploiement',
        category: 'reactive',
        suggestedName: 'Gardien déploiements',
        defaultScheduleMinutes: 0,
        recommended: true,
    },
    {
        type: 'github-actions',
        label: 'GitHub Actions',
        description: 'Réagit aux échecs CI, lit les logs, corrige les workflows et relance.',
        triggerHint: 'Webhook workflow_run (échec)',
        category: 'reactive',
        suggestedName: 'Correcteur CI',
        defaultScheduleMinutes: 0,
        recommended: true,
    },
    {
        type: 'devforge',
        label: 'DevForge',
        description: 'Observe chaque build webhook et améliore la plateforme.',
        triggerHint: 'À chaque build webhook',
        category: 'reactive',
        suggestedName: 'Observateur DevForge',
        defaultScheduleMinutes: 0,
    },
    {
        type: 'debug',
        label: 'Débogage',
        description: 'Analyse logs et erreurs, propose des corrections.',
        triggerHint: scheduleHint(15),
        category: 'watch',
        suggestedName: 'Débogueur',
        defaultScheduleMinutes: 15,
    },
    {
        type: 'github',
        label: 'GitHub',
        description: 'Surveille les PR, previews et branches liées.',
        triggerHint: scheduleHint(30),
        category: 'watch',
        suggestedName: 'Veilleur GitHub',
        defaultScheduleMinutes: 30,
    },
    {
        type: 'tech-watch',
        label: 'Veille Tech',
        description: 'Repère configs obsolètes et ressources inactives.',
        triggerHint: scheduleHint(60),
        category: 'watch',
        suggestedName: 'Veille technique',
        defaultScheduleMinutes: 60,
    },
    {
        type: 'security',
        label: 'Sécurité',
        description: 'Inspecte les configurations et signale les risques.',
        triggerHint: scheduleHint(360),
        category: 'watch',
        suggestedName: 'Sentinelle sécurité',
        defaultScheduleMinutes: 360,
    },
];

export const categoryLabels: Record<AgentPresetCategory, string> = {
    reactive: 'Réactifs (événements)',
    watch: 'Surveillance planifiée',
    manual: 'Manuel',
};

export function presetForType(type: AgentType): AgentPreset | undefined {
    return agentPresets.find((preset) => preset.type === type);
}

export function defaultScheduleForType(type: AgentType): number {
    if (isEventOnlyAgentType(type)) {
        return 0;
    }

    return presetForType(type)?.defaultScheduleMinutes ?? 15;
}

/** Spécialistes permanents suggérés selon le type du parent (pour delegate_task). */
export function subAgentPresetsForParent(parentType: AgentType): SubAgentPreset[] {
    switch (parentType) {
        case 'deployment':
        case 'debug':
            return [
                {
                    id: 'diagnose',
                    type: 'debug',
                    label: 'Diagnostiqueur',
                    description: 'Lit logs et isole la cause racine.',
                    suggestedName: 'Diagnostiqueur',
                },
                {
                    id: 'fix',
                    type: 'debug',
                    label: 'Correcteur',
                    description: 'Applique des correctifs ciblés.',
                    suggestedName: 'Correcteur',
                },
                {
                    id: 'redeploy',
                    type: 'deployment',
                    label: 'Relance',
                    description: 'Relance un déploiement après correction.',
                    suggestedName: 'Relance déploiement',
                },
            ];
        case 'github-actions':
            return [
                {
                    id: 'fix-ci',
                    type: 'github-actions',
                    label: 'Correcteur CI',
                    description: 'Corrige YAML Actions et relance les jobs.',
                    suggestedName: 'Correcteur CI',
                },
                {
                    id: 'diagnose-ci',
                    type: 'debug',
                    label: 'Analyseur de logs',
                    description: 'Extrait les erreurs des logs de jobs.',
                    suggestedName: 'Analyseur logs CI',
                },
            ];
        case 'github':
            return [
                {
                    id: 'pr-watch',
                    type: 'github',
                    label: 'Suivi PR',
                    description: 'Suit une PR ou une preview dédiée.',
                    suggestedName: 'Suivi PR',
                },
            ];
        default:
            return [
                {
                    id: 'specialist',
                    type: parentType,
                    label: 'Spécialiste',
                    description: 'Sous-agent permanent pour tâches déléguées.',
                    suggestedName: 'Spécialiste',
                },
            ];
    }
}
