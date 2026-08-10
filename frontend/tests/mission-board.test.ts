import { describe, expect, it } from 'vitest';
import type { AgentMission } from '../src/lib/domain-api';
import {
    groupMissionsByStatus,
    isFeatureDeliveryMission,
    missionSourceHint,
    visibleMissionsForColumn,
} from '../src/lib/mission-board';

function mission(partial: Partial<AgentMission> & Pick<AgentMission, 'uuid' | 'status'>): AgentMission {
    return {
        kind: 'tech_watch',
        priority: 'normal',
        title: `Mission ${partial.uuid}`,
        description: null,
        source: 'tech-watch',
        resource_uuid: null,
        agent_id: null,
        assignee_agent_id: null,
        metadata: {},
        created_at: null,
        updated_at: null,
        completed_at: null,
        ...partial,
    };
}

describe('mission-board', () => {
    it('groupe les missions par statut et ignore cancelled', () => {
        const grouped = groupMissionsByStatus([
            mission({ uuid: '1', status: 'open' }),
            mission({ uuid: '2', status: 'in_progress' }),
            mission({ uuid: '3', status: 'in_progress' }),
            mission({ uuid: '4', status: 'cancelled' }),
            mission({ uuid: '5', status: 'done' }),
        ]);

        expect(grouped.open).toHaveLength(1);
        expect(grouped.in_progress).toHaveLength(2);
        expect(grouped.done).toHaveLength(1);
        expect(grouped.cancelled).toHaveLength(0);
    });

    it('limite En cours à 5 cartes avec un compteur caché', () => {
        const missions = Array.from({ length: 12 }, (_, index) => (
            mission({ uuid: String(index + 1), status: 'in_progress' })
        ));

        const collapsed = visibleMissionsForColumn(missions, 'in_progress', false);
        expect(collapsed.visible).toHaveLength(5);
        expect(collapsed.hiddenCount).toBe(7);

        const expanded = visibleMissionsForColumn(missions, 'in_progress', true);
        expect(expanded.visible).toHaveLength(12);
        expect(expanded.hiddenCount).toBe(0);
    });

    it('étiquette la source veille', () => {
        expect(missionSourceHint(mission({ uuid: '1', status: 'open', source: 'tech-watch' }))).toBe('Veille auto');
        expect(missionSourceHint(mission({ uuid: '2', status: 'open', source: null }))).toBeNull();
        expect(missionSourceHint(mission({ uuid: '3', status: 'open', source: 'feature_request' }))).toBe('Feature → PR');
    });

    it('détecte les missions feature delivery', () => {
        expect(isFeatureDeliveryMission(mission({
            uuid: '1',
            status: 'blocked',
            kind: 'feature',
            is_feature_delivery: true,
            metadata: {},
        }))).toBe(true);

        expect(isFeatureDeliveryMission(mission({
            uuid: '2',
            status: 'open',
            kind: 'feature',
            metadata: { workflow: 'feature_delivery', force_pull_request: true },
        }))).toBe(true);

        expect(isFeatureDeliveryMission(mission({
            uuid: '3',
            status: 'open',
            kind: 'bug',
            metadata: {},
        }))).toBe(false);
    });
});
