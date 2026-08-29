import { describe, expect, it } from 'vitest';
import type { AgentKeyRequest } from '../src/lib/domain-api';
import {
    connexionIdForKey,
    groupAgentRequests,
    isIgnoredProductKey,
    matchesConnexionQuery,
    requestsForConnexion,
    resolveConnexionStatus,
} from '../src/lib/connexions-catalog';

function request(overrides: Partial<AgentKeyRequest> & Pick<AgentKeyRequest, 'uuid' | 'key_name'>): AgentKeyRequest {
    return {
        reason: null,
        status: 'pending',
        ...overrides,
    };
}

describe('connexions-catalog', () => {
    it('regroupe les alias DATABASE_URL sur Turso et ignore HEALTH_GATEWAY', () => {
        const rows = [
            request({ uuid: '1', key_name: 'ASTRO_DB_REMOTE_URL', resource_uuid: 'app-1' }),
            request({ uuid: '2', key_name: 'DATABASE_URL', resource_uuid: 'app-1' }),
            request({ uuid: '3', key_name: 'TURSO_DATABASE_URL', resource_uuid: 'app-2' }),
            request({ uuid: '4', key_name: 'HEALTH_GATEWAY' }),
            request({ uuid: '5', key_name: 'LOCALHOST_SERVER_UUID' }),
            request({ uuid: '6', key_name: 'APPLICATION_UUID' }),
            request({ uuid: '7', key_name: 'GITHUB_PAT' }),
            request({ uuid: '8', key_name: 'OPENAI_API_KEY' }),
        ];

        expect(connexionIdForKey('ASTRO_DB_REMOTE_URL')).toBe('turso');
        expect(connexionIdForKey('GITHUB_PAT')).toBe('github');
        expect(connexionIdForKey('OPENAI_API_KEY')).toBe('team');
        expect(isIgnoredProductKey('HEALTH_GATEWAY')).toBe(true);
        expect(connexionIdForKey('HEALTH_GATEWAY')).toBeNull();
        expect(connexionIdForKey('LOCALHOST_SERVER_UUID')).toBeNull();
        expect(connexionIdForKey('APPLICATION_UUID')).toBeNull();

        const grouped = groupAgentRequests(rows);
        expect(grouped.map((item) => item.uuid)).toEqual(['1', '3', '4', '5', '6', '7', '8']);

        expect(requestsForConnexion(rows, 'turso').map((item) => item.uuid)).toEqual(['1', '3']);
        expect(requestsForConnexion(rows, 'github').map((item) => item.uuid)).toEqual(['7']);
        expect(requestsForConnexion(rows, 'team').map((item) => item.uuid)).toEqual(['8']);
        expect(requestsForConnexion(rows, 'mcp')).toEqual([]);
    });

    it('priorise Demande agent puis Branché / À configurer', () => {
        const pending = [request({ uuid: '1', key_name: 'DATABASE_URL' })];

        expect(resolveConnexionStatus({
            id: 'turso',
            requests: pending,
            githubInstalled: false,
            tursoConfigured: true,
            teamKeysConfigured: true,
            mcpConfigured: true,
        })).toBe('agent_request');

        expect(resolveConnexionStatus({
            id: 'github',
            requests: [],
            githubInstalled: true,
            tursoConfigured: false,
            teamKeysConfigured: false,
            mcpConfigured: false,
        })).toBe('connected');

        expect(resolveConnexionStatus({
            id: 'mcp',
            requests: [],
            githubInstalled: false,
            tursoConfigured: false,
            teamKeysConfigured: false,
            mcpConfigured: false,
        })).toBe('needs_setup');
    });

    it('filtre le catalogue par titre, description ou statut', () => {
        const item = {
            title: 'GitHub',
            description: 'Reliez un compte GitHub pour déployer vos dépôts.',
            status: 'agent_request' as const,
        };

        expect(matchesConnexionQuery('git', item)).toBe(true);
        expect(matchesConnexionQuery('demande', item)).toBe(true);
        expect(matchesConnexionQuery('turso', item)).toBe(false);
    });
});
