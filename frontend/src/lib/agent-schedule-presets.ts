/**
 * Presets de planification autonome (intervalle ou cron).
 * Le cron est prioritaire côté backend s’il est renseigné.
 */

export type AgentSchedulePreset = {
    id: string;
    label: string;
    hint?: string;
    schedule_minutes: number;
    schedule_cron: string | null;
};

export const AGENT_SCHEDULE_PRESETS: AgentSchedulePreset[] = [
    {
        id: 'manual',
        label: 'Manuel uniquement',
        hint: 'Ne tourne que si tu forces un run (ou via événements / missions).',
        schedule_minutes: 0,
        schedule_cron: null,
    },
    {
        id: 'every-15',
        label: 'Toutes les 15 min',
        schedule_minutes: 15,
        schedule_cron: null,
    },
    {
        id: 'every-30',
        label: 'Toutes les 30 min',
        schedule_minutes: 30,
        schedule_cron: null,
    },
    {
        id: 'hourly',
        label: 'Toutes les heures',
        schedule_minutes: 60,
        schedule_cron: null,
    },
    {
        id: 'every-6h',
        label: 'Toutes les 6 heures',
        schedule_minutes: 360,
        schedule_cron: null,
    },
    {
        id: 'daily',
        label: 'Une fois par jour',
        schedule_minutes: 1440,
        schedule_cron: null,
    },
    {
        id: 'workday-hourly',
        label: 'Heures de travail — chaque heure',
        hint: 'Lun–ven, 9h–18h (fuseau de l’instance). Idéal veille tech.',
        schedule_minutes: 0,
        schedule_cron: '0 9-18 * * 1-5',
    },
    {
        id: 'workday-morning',
        label: 'Matin jours ouvrés — 9h',
        hint: 'Lun–ven à 9h. Scan VT du matin.',
        schedule_minutes: 0,
        schedule_cron: '0 9 * * 1-5',
    },
    {
        id: 'workday-twice',
        label: 'Jours ouvrés — 9h et 14h',
        hint: 'Lun–ven à 9h et 14h.',
        schedule_minutes: 0,
        schedule_cron: '0 9,14 * * 1-5',
    },
    {
        id: 'custom',
        label: 'Personnalisé…',
        hint: 'Régler minutes et/ou cron ci-dessous.',
        schedule_minutes: 60,
        schedule_cron: null,
    },
];

export function matchSchedulePreset(scheduleMinutes: number, scheduleCron?: string | null): string {
    const cron = (scheduleCron ?? '').trim();

    if (cron !== '') {
        const byCron = AGENT_SCHEDULE_PRESETS.find((preset) => preset.schedule_cron === cron);
        if (byCron) {
            return byCron.id;
        }

        return 'custom';
    }

    if (!scheduleMinutes || scheduleMinutes <= 0) {
        return 'manual';
    }

    const byMinutes = AGENT_SCHEDULE_PRESETS.find(
        (preset) => preset.schedule_cron === null && preset.id !== 'manual' && preset.id !== 'custom'
            && preset.schedule_minutes === scheduleMinutes,
    );

    return byMinutes?.id ?? 'custom';
}

export function applySchedulePreset(presetId: string): Pick<AgentSchedulePreset, 'schedule_minutes' | 'schedule_cron'> {
    const preset = AGENT_SCHEDULE_PRESETS.find((row) => row.id === presetId)
        ?? AGENT_SCHEDULE_PRESETS[0];

    return {
        schedule_minutes: preset.schedule_minutes,
        schedule_cron: preset.schedule_cron,
    };
}

export function scheduleCronLabel(cron: string): string | null {
    const trimmed = cron.trim();
    if (!trimmed) {
        return null;
    }

    const preset = AGENT_SCHEDULE_PRESETS.find((row) => row.schedule_cron === trimmed);
    if (preset) {
        return preset.label;
    }

    return `Cron ${trimmed}`;
}
