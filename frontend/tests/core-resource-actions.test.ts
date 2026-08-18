import { describe, expect, it } from 'vitest';
import {
    canVisitApplication,
    resolveCoreResourceActions,
} from '../src/lib/core-resource-actions';
import type { CoreResource } from '../src/lib/domain-api';

function application(overrides: Partial<CoreResource> = {}): CoreResource {
    return {
        uuid: 'app-1',
        type: 'application',
        name: 'demo',
        description: null,
        status: 'running:healthy',
        configuration: {},
        actions: ['start', 'stop', 'restart', 'deploy'],
        created_at: null,
        updated_at: null,
        ...overrides,
    };
}

describe('resolveCoreResourceActions', () => {
    it('expose démarrer et déployer pour une application arrêtée', () => {
        expect(resolveCoreResourceActions(application({ status: 'exited:unknown' }))).toEqual(['start', 'deploy']);
    });

    it('n’expose pas démarrer pour une application en cours d’exécution', () => {
        expect(resolveCoreResourceActions(application({ status: 'running:healthy' }))).toEqual([
            'stop',
            'restart',
            'deploy',
        ]);
    });
});

describe('canVisitApplication', () => {
    it('autorise la visite dès qu’un domaine provisoire existe', () => {
        expect(canVisitApplication('running:healthy', null)).toBe(false);
        expect(canVisitApplication('exited:unknown', 'https://demo.test')).toBe(true);
        expect(canVisitApplication('running:healthy', 'https://demo.test')).toBe(true);
    });
});
