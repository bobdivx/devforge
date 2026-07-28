import { describe, expect, it } from 'vitest';
import { isDeploymentActive, isDeploymentCancellable } from '../src/lib/deployment-status';

describe('isDeploymentActive', () => {
    it('détecte les déploiements en cours', () => {
        expect(isDeploymentActive('in_progress')).toBe(true);
        expect(isDeploymentActive('queued')).toBe(true);
        expect(isDeploymentActive('building')).toBe(true);
    });

    it('ignore les déploiements terminés', () => {
        expect(isDeploymentActive('finished')).toBe(false);
        expect(isDeploymentActive('failed')).toBe(false);
        expect(isDeploymentActive('cancelled-by-user')).toBe(false);
    });
});

describe('isDeploymentCancellable', () => {
    it('autorise queued et in_progress', () => {
        expect(isDeploymentCancellable('queued')).toBe(true);
        expect(isDeploymentCancellable('in_progress')).toBe(true);
    });

    it('refuse les déploiements terminés', () => {
        expect(isDeploymentCancellable('finished')).toBe(false);
        expect(isDeploymentCancellable('failed')).toBe(false);
        expect(isDeploymentCancellable('cancelled-by-user')).toBe(false);
    });
});
