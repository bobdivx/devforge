import { describe, expect, it } from 'vitest';
import {
    AGENTS_SETTINGS_SECTIONS,
    parseAgentsSettingsSection,
} from '../src/lib/agents-settings-sections';

describe('agents-settings-sections', () => {
    it('expose les sections DevForge (pas Voice/Gateway)', () => {
        const ids = AGENTS_SETTINGS_SECTIONS.map((section) => section.id);
        expect(ids).toEqual(['providers', 'models', 'instructions', 'memory', 'mcp', 'advanced']);
        expect(ids).not.toContain('voice');
        expect(ids).not.toContain('gateway');
    });

    it('parse le hash et fallback providers', () => {
        expect(parseAgentsSettingsSection('#mcp')).toBe('mcp');
        expect(parseAgentsSettingsSection('instructions')).toBe('instructions');
        expect(parseAgentsSettingsSection('#voice')).toBe('providers');
        expect(parseAgentsSettingsSection(null)).toBe('providers');
    });
});
