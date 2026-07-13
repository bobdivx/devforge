import { describe, expect, it } from 'vitest';
import { parseDeploymentStatus } from '../src/lib/deployment-status';
import { parseResourceStatus } from '../src/lib/resource-status';

describe('statuts ressource', () => {
    it('convertit running:unknown en icône et libellé lisible', () => {
        const parsed = parseResourceStatus('running:unknown');

        expect(parsed.shortLabel).toBe('En cours');
        expect(parsed.label).toBe('En cours de fonctionnement');
        expect(parsed.tone).toBe('warning');
    });

    it('gère les statuts serveur structurés', () => {
        expect(parseResourceStatus({ reachable: true, usable: true, validating: false }).shortLabel).toBe('En ligne');
        expect(parseResourceStatus({ reachable: false, usable: false, validating: true }).shortLabel).toBe('Validation');
    });
});

describe('statuts déploiement', () => {
    it('convertit finished en statut terminé', () => {
        const parsed = parseDeploymentStatus('finished');

        expect(parsed.shortLabel).toBe('Terminé');
        expect(parsed.tone).toBe('success');
    });
});
