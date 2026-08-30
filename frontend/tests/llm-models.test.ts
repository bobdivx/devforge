import { describe, expect, it } from 'vitest';
import {
    formatAgentProviderDisplay,
    formatModelLabel,
    formatProviderModel,
    isAutoModel,
    isModelTooSmallForTools,
    parseModelParamBillions,
    SMALL_MODEL_TOOLS_WARNING,
} from '../src/lib/llm-models';

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

    it('parses ollama parameter counts', () => {
        expect(parseModelParamBillions('qwen2.5:3b')).toBe(3);
        expect(parseModelParamBillions('qwen2.5:1b')).toBe(1);
        expect(parseModelParamBillions('llama3.2:1.5b')).toBe(1.5);
        expect(parseModelParamBillions('qwen2.5:0.5b')).toBe(0.5);
        expect(parseModelParamBillions('qwen2.5-coder:7b')).toBe(7);
        expect(parseModelParamBillions('qwen2.5:14b')).toBe(14);
        expect(parseModelParamBillions('llama3.2:3b-instruct-q4_0')).toBe(3);
        expect(parseModelParamBillions('mixtral:8x7b')).toBeNull();
        expect(parseModelParamBillions('gemini-2.5-flash')).toBeNull();
        expect(parseModelParamBillions('auto')).toBeNull();
    });

    it('flags models under 7B including tiny/mini tags', () => {
        expect(isModelTooSmallForTools('qwen2.5:3b')).toBe(true);
        expect(isModelTooSmallForTools('qwen2.5:1b')).toBe(true);
        expect(isModelTooSmallForTools('phi3:mini')).toBe(true);
        expect(isModelTooSmallForTools('tinyllama')).toBe(true);
        expect(isModelTooSmallForTools('qwen2.5-coder:7b')).toBe(false);
        expect(isModelTooSmallForTools('qwen2.5:7b')).toBe(false);
        expect(isModelTooSmallForTools('qwen2.5:14b')).toBe(false);
        expect(isModelTooSmallForTools('gemini-2.5-flash')).toBe(false);
        expect(isModelTooSmallForTools('auto')).toBe(false);
        expect(isModelTooSmallForTools(null)).toBe(false);
        expect(SMALL_MODEL_TOOLS_WARNING).toContain('trop petit');
        expect(SMALL_MODEL_TOOLS_WARNING).toContain('qwen2.5-coder:7b');
    });
});
