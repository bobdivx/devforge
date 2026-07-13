import { describe, expect, it } from 'vitest';
import { CUSTOM_MODEL_VALUE, modelSelectValue } from '../src/lib/llm-models';

describe('llm-models', () => {
    it('returns custom value when model is empty or unknown', () => {
        expect(modelSelectValue('', [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }])).toBe(CUSTOM_MODEL_VALUE);
        expect(modelSelectValue('unknown-model', [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }])).toBe(CUSTOM_MODEL_VALUE);
    });

    it('keeps known model ids from the fetched catalog', () => {
        expect(modelSelectValue('gemini-2.5-flash', [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }])).toBe('gemini-2.5-flash');
    });
});
