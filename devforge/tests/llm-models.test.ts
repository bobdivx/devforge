import { describe, expect, it } from 'vitest';
import { formatAgentProviderDisplay, formatModelLabel, formatProviderModel, isAutoModel } from '../src/lib/llm-models';

describe('llm-models', () => {
    it('detects auto model values', () => {
        expect(isAutoModel('auto')).toBe(true);
        expect(isAutoModel('')).toBe(true);
        expect(isAutoModel('gemini-2.5-flash')).toBe(false);
    });

    it('formats auto labels for display', () => {
        expect(formatModelLabel('auto', 'Auto')).toBe('Auto');
        expect(formatModelLabel('gemini-2.5-flash')).toBe('gemini-2.5-flash');
        expect(formatProviderModel('gemini', 'auto', 'Auto')).toBe('gemini/Auto');
    });

    it('formats agent provider display as auto', () => {
        expect(formatAgentProviderDisplay('gemini')).toBe('gemini/Auto');
    });
});
