import { describe, expect, it } from 'vitest';
import { isDeploymentActive } from '../src/lib/deployment-status';

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
