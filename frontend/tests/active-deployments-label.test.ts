import { describe, expect, it } from 'vitest';
import { formatActiveDeploymentsLabel } from '../src/lib/active-deployments-label';

describe('formatActiveDeploymentsLabel', () => {
    it('singulier et pluriel', () => {
        expect(formatActiveDeploymentsLabel(1)).toBe('1 déploiement');
        expect(formatActiveDeploymentsLabel(3)).toBe('3 déploiements');
    });

    it('cas vide', () => {
        expect(formatActiveDeploymentsLabel(0)).toBe('Aucun déploiement');
    });
});
