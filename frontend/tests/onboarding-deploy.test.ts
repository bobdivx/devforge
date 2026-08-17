import { describe, expect, it } from 'vitest';
import type { CoreResource, Deployment, GithubRepository } from '../src/lib/domain-api';
import {
    createInitialDeployItems,
    markDeployItemCreated,
    markDeployItemCreating,
    markDeployItemFailed,
    mergeOnboardingDeployStatus,
    onboardingDeployProgress,
    overallPipelineIndex,
    phaseFromApplicationStatus,
    phaseFromDeploymentStatus,
} from '../src/lib/onboarding-deploy';

const repo: GithubRepository = {
    id: 7,
    name: 'popcorn',
    full_name: 'bob/popcorn',
    owner: 'bob',
    private: true,
    html_url: 'https://github.com/bob/popcorn',
    default_branch: 'main',
    description: null,
};

function application(status: string): CoreResource {
    return {
        uuid: 'app-1',
        type: 'application',
        name: 'popcorn',
        description: null,
        status,
        configuration: {},
        actions: [],
        created_at: null,
        updated_at: null,
    };
}

function deployment(status: string): Deployment {
    return {
        uuid: 'dep-1',
        status,
        pull_request_id: 0,
        commit: 'abc',
        commit_message: 'feat: boot',
        force_rebuild: false,
        rollback: false,
        created_at: null,
        updated_at: null,
        finished_at: null,
        application: { uuid: 'app-1', name: 'popcorn' },
        is_debug_enabled: false,
    };
}

describe('onboarding-deploy', () => {
    it('prépare les apps en attente puis suit création et file', () => {
        const initial = createInitialDeployItems([repo]);
        expect(initial[0]?.phase).toBe('waiting');

        const creating = markDeployItemCreating(initial, 7);
        expect(creating[0]?.phase).toBe('creating');

        const created = markDeployItemCreated(creating, 7, 'app-1');
        expect(created[0]).toMatchObject({ uuid: 'app-1', phase: 'queued' });
        expect(onboardingDeployProgress(created).canContinue).toBe(true);
        expect(onboardingDeployProgress(creating).canContinue).toBe(false);
    });

    it('mappe les statuts de déploiement et d’application', () => {
        expect(phaseFromDeploymentStatus('queued')).toBe('queued');
        expect(phaseFromDeploymentStatus('in_progress')).toBe('building');
        expect(phaseFromDeploymentStatus('finished')).toBe('healthy');
        expect(phaseFromDeploymentStatus('failed')).toBe('failed');
        expect(phaseFromApplicationStatus('running:healthy')).toBe('healthy');
        expect(phaseFromApplicationStatus('starting')).toBe('building');
    });

    it('fusionne le suivi live sans reculer une app déjà en ligne', () => {
        const queued = markDeployItemCreated(markDeployItemCreating(createInitialDeployItems([repo]), 7), 7, 'app-1');
        const building = mergeOnboardingDeployStatus(queued, [deployment('in_progress')], []);
        expect(building[0]?.phase).toBe('building');

        const healthy = mergeOnboardingDeployStatus(building, [deployment('finished')], [application('running:healthy')]);
        expect(healthy[0]?.phase).toBe('healthy');

        const stillHealthy = mergeOnboardingDeployStatus(healthy, [deployment('queued')], [application('running:healthy')]);
        expect(stillHealthy[0]?.phase).toBe('healthy');
    });

    it('marque un échec de création et avance le pipeline global', () => {
        const failed = markDeployItemFailed(createInitialDeployItems([repo]), 7, 'Délai dépassé');
        expect(failed[0]?.phase).toBe('failed');
        expect(onboardingDeployProgress(failed)).toMatchObject({
            canContinue: true,
            failed: 1,
            completed: 0,
        });
        expect(overallPipelineIndex(failed)).toBe(1);
    });
});
