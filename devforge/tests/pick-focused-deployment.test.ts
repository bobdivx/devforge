import { describe, expect, it } from 'vitest';
import type { Deployment } from '../src/lib/domain-api';
import { pickFocusedDeployment } from '../src/lib/pick-focused-deployment';

function deployment(uuid: string, status: string, applicationUuid: string | null = null): Deployment {
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
        application: applicationUuid
            ? { uuid: applicationUuid, name: 'app' }
            : null,
        is_debug_enabled: false,
    };
}

describe('pickFocusedDeployment', () => {
    it('conserve un UUID explicitement sélectionné même hors liste récente tant que la liste est vide', () => {
        expect(pickFocusedDeployment([], 'agent-redeploy-uuid')).toBe('agent-redeploy-uuid');
    });

    it('conserve un UUID présent dans la liste récente', () => {
        const deployments = [
            deployment('active-deploy', 'in_progress'),
            deployment('older-deploy', 'finished'),
        ];

        expect(pickFocusedDeployment(deployments, 'older-deploy')).toBe('older-deploy');
    });

    it('abandonne un UUID stale d’une autre app dès que la liste de cette app est connue', () => {
        const deployments = [
            deployment('starbase-deploy', 'finished', 'starbase-uuid'),
            deployment('starbase-older', 'failed', 'starbase-uuid'),
        ];

        expect(pickFocusedDeployment(deployments, 'tesla-deploy-uuid')).toBe('starbase-deploy');
    });

    it('sélectionne le déploiement actif quand aucune préférence', () => {
        const deployments = [
            deployment('finished-deploy', 'finished'),
            deployment('active-deploy', 'in_progress'),
        ];

        expect(pickFocusedDeployment(deployments, null)).toBe('active-deploy');
    });

    it('retombe sur le premier déploiement si aucun n’est actif', () => {
        const deployments = [
            deployment('first-deploy', 'finished'),
            deployment('second-deploy', 'failed'),
        ];

        expect(pickFocusedDeployment(deployments, null)).toBe('first-deploy');
    });
});
