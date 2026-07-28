import { describe, expect, it } from 'vitest';
import type { DeploymentAgentRun } from '../src/lib/api/domain';
import { selectVisibleAgentRuns } from '../src/lib/select-visible-agent-runs';

function run(partial: Partial<DeploymentAgentRun> & Pick<DeploymentAgentRun, 'uuid' | 'status'>): DeploymentAgentRun {
    return {
        trigger: 'event',
        summary: null,
        actions_taken: [],
        iterations: 1,
        tokens_used: 0,
        duration_seconds: null,
        started_at: null,
        finished_at: null,
        created_at: '2026-07-28T10:00:00.000Z',
        event_context: null,
        agent: { uuid: 'agent-1', name: 'Build', type: 'deployment', avatar_color: '#000' },
        ...partial,
    };
}

describe('selectVisibleAgentRuns', () => {
    it('n’affiche que le run en cours en mode live', () => {
        const runs = [
            run({ uuid: 'running', status: 'running' }),
            run({ uuid: 'done', status: 'completed' }),
            run({ uuid: 'old', status: 'failed' }),
        ];

        expect(selectVisibleAgentRuns(runs).map((item) => item.uuid)).toEqual(['running']);
    });

    it('n’affiche rien en mode live sans run en cours', () => {
        const runs = [
            run({ uuid: 'done', status: 'completed' }),
            run({ uuid: 'old', status: 'failed' }),
        ];

        expect(selectVisibleAgentRuns(runs)).toEqual([]);
    });

    it('ignore les runs rattachés à une autre tentative', () => {
        const runs = [
            run({ uuid: 'other', status: 'running', historical_for_other_attempt: true }),
            run({ uuid: 'mine', status: 'completed' }),
        ];

        expect(selectVisibleAgentRuns(runs)).toEqual([]);
        expect(selectVisibleAgentRuns(runs, { historyMode: true }).map((item) => item.uuid)).toEqual(['mine']);
    });

    it('affiche le run le plus récent en mode historique', () => {
        const runs = [
            run({ uuid: 'latest', status: 'completed' }),
            run({ uuid: 'older', status: 'failed' }),
        ];

        expect(selectVisibleAgentRuns(runs, { historyMode: true }).map((item) => item.uuid)).toEqual(['latest']);
    });

    it('traite waiting_for_subagents comme run actif', () => {
        const runs = [
            run({ uuid: 'waiting', status: 'waiting_for_subagents' }),
            run({ uuid: 'done', status: 'completed' }),
        ];

        expect(selectVisibleAgentRuns(runs).map((item) => item.uuid)).toEqual(['waiting']);
    });
});
