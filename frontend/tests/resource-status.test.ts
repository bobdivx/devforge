import { describe, expect, it } from 'vitest';
import { classifyResourceStatusTone, parseResourceStatus } from '../src/lib/resource-status';

describe('statuts ressource', () => {
    it('considère running:unknown comme en ligne (sans healthcheck)', () => {
        const parsed = parseResourceStatus('running:unknown');

        expect(parsed.shortLabel).toBe('En ligne');
        expect(parsed.label).toBe('En ligne');
        expect(parsed.tone).toBe('success');
        expect(classifyResourceStatusTone('running:unknown')).toBe('success');
    });

    it('marque degraded:unhealthy comme dégradé', () => {
        const parsed = parseResourceStatus('degraded:unhealthy');

        expect(parsed.shortLabel).toBe('Dégradé');
        expect(parsed.tone).toBe('warning');
        expect(classifyResourceStatusTone('degraded:unhealthy')).toBe('warning');
    });

    it('marque running:unhealthy comme dégradé', () => {
        expect(classifyResourceStatusTone('running:unhealthy')).toBe('warning');
    });

    it('marque exited comme arrêté', () => {
        expect(classifyResourceStatusTone('exited')).toBe('error');
    });

    it('gère les statuts serveur structurés', () => {
        expect(parseResourceStatus({ reachable: true, usable: true, validating: false }).shortLabel).toBe('En ligne');
        expect(parseResourceStatus({ reachable: false, usable: false, validating: true }).shortLabel).toBe('Validation');
    });
});
