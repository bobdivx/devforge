import type { AgentMission, AgentMissionStatus } from './domain-api';

export const MISSION_KIND_LABELS: Record<string, string> = {
    bug: 'Bug',
    feature: 'Feature',
    tech_watch: 'Veille',
    github_pr: 'PR',
    ops: 'Ops',
    other: 'Autre',
};

/** Limite d’affichage par colonne (le reste est derrière « Voir plus »). */
export const MISSION_COLUMN_LIMITS: Record<AgentMissionStatus, number> = {
    open: 8,
    in_progress: 5,
    blocked: 8,
    done: 5,
    cancelled: 0,
};

export function missionKindLabel(kind: string): string {
    return MISSION_KIND_LABELS[kind] ?? kind;
}

export function missionSourceHint(mission: AgentMission): string | null {
    const source = mission.source?.trim();
    if (!source) {
        return null;
    }

    if (source === 'tech-watch') {
        return 'Veille auto';
    }

    if (source === 'github' || source === 'github_pr') {
        return 'GitHub';
    }

    if (source === 'user' || source === 'manual') {
        return 'Manuel';
    }

    if (source === 'feature_request') {
        return 'Feature → PR';
    }

    return source;
}

export function isFeatureDeliveryMission(mission: AgentMission): boolean {
    if (mission.is_feature_delivery) {
        return true;
    }

    const meta = mission.metadata ?? {};
    return meta.workflow === 'feature_delivery'
        || (mission.kind === 'feature' && meta.force_pull_request === true);
}

export function groupMissionsByStatus(missions: AgentMission[]): Record<AgentMissionStatus, AgentMission[]> {
    const map: Record<AgentMissionStatus, AgentMission[]> = {
        open: [],
        in_progress: [],
        blocked: [],
        done: [],
        cancelled: [],
    };

    for (const mission of missions) {
        const status = String(mission.status) as AgentMissionStatus;
        if (status === 'cancelled') {
            continue;
        }
        if (status in map) {
            map[status].push(mission);
        } else {
            map.open.push(mission);
        }
    }

    return map;
}

export function visibleMissionsForColumn(
    missions: AgentMission[],
    status: AgentMissionStatus,
    expanded: boolean,
): { visible: AgentMission[]; hiddenCount: number; limit: number } {
    const limit = MISSION_COLUMN_LIMITS[status] ?? 8;
    if (expanded || missions.length <= limit) {
        return { visible: missions, hiddenCount: 0, limit };
    }

    return {
        visible: missions.slice(0, limit),
        hiddenCount: missions.length - limit,
        limit,
    };
}
