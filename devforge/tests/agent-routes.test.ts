import { describe, expect, it } from 'vitest';
import { agentDetailPath, shouldOpenAgentSettings } from '../src/lib/agent-routes';
import { findRoute, normalizeRoutePath } from '../src/lib/routes';

describe('agent-routes', () => {
    it('construit le chemin de configuration avec le paramètre settings', () => {
        expect(agentDetailPath('agent-uuid')).toBe('/agents/agent-uuid');
        expect(agentDetailPath('agent-uuid', { settings: true })).toBe('/agents/agent-uuid?settings=1');
    });

    it('détecte le paramètre settings dans la query string', () => {
        expect(shouldOpenAgentSettings('?settings=1')).toBe(true);
        expect(shouldOpenAgentSettings('?settings=true')).toBe(true);
        expect(shouldOpenAgentSettings('')).toBe(false);
        expect(shouldOpenAgentSettings('?settings=0')).toBe(false);
    });
});

describe('normalizeRoutePath avec query agent', () => {
    it('ignore la query string pour la résolution de route', () => {
        expect(normalizeRoutePath('/devforge/agents/agent-uuid/?settings=1')).toBe('/agents/agent-uuid');
        expect(findRoute('/agents/agent-uuid?settings=1').page).toBe('agent-detail');
    });
});
