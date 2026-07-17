import { describe, expect, it } from 'vitest';
import type { Deployment } from '../src/lib/domain-api';
import {
    deploymentAttemptBucket,
    partitionDeploymentAttempts,
} from '../src/lib/partition-deployment-attempts';

function deployment(uuid: string, status: string): Deployment {
    return {
        uuid,
        status,
        pull_request_id: 0,
        commit: null,
        commit_message: null,
        force_rebuild: false,
        rollback: false,
        created_at: null,
        updated_at: null,
        finished_at: null,
        application: null,
        is_debug_enabled: false,
    };
}

describe('partitionDeploymentAttempts', () => {
    it('isole la tentative suivie et classe les autres', () => {
        const deployments = [
            deployment('focus-fail', 'failed'),
            deployment('agent-redeploy', 'in_progress'),
            deployment('older-fail', 'failed'),
            deployment('ok', 'finished'),
        ];

        const partitioned = partitionDeploymentAttempts(deployments, 'focus-fail');

        expect(partitioned.current?.uuid).toBe('focus-fail');
        expect(partitioned.active.map((d) => d.uuid)).toEqual(['agent-redeploy']);
        expect(partitioned.failed.map((d) => d.uuid)).toEqual(['older-fail']);
        expect(partitioned.history.map((d) => d.uuid)).toEqual(['ok']);
    });

    it('marque correctement le bucket courant', () => {
        const item = deployment('x', 'failed');
        expect(deploymentAttemptBucket(item, 'x')).toBe('current');
        expect(deploymentAttemptBucket(item, 'y')).toBe('failed');
        expect(deploymentAttemptBucket(deployment('q', 'queued'), null)).toBe('active');
        expect(deploymentAttemptBucket(deployment('f', 'finished'), null)).toBe('history');
    });
});
