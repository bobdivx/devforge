import { describe, expect, it } from 'vitest';
import {
    buildLlmUrl,
    buildStudioUrl,
    DEFAULT_LLM_PORT,
    DEFAULT_PINOKIO_HOST,
    DEFAULT_STUDIO_PORT,
    parsePinokioEndpoints,
} from '../src/lib/pinokio-urls';

describe('pinokio-urls', () => {
    it('construit les URLs à partir de l’hôte et des ports', () => {
        expect(buildStudioUrl('10.1.0.88', 42000)).toBe('http://10.1.0.88:42000');
        expect(buildLlmUrl('10.1.0.88', 10086)).toBe('http://10.1.0.88:10086/v1');
    });

    it('normalise un hôte saisi avec schéma ou port', () => {
        expect(parsePinokioEndpoints('http://192.168.1.50:42000', 'http://192.168.1.50:10086/v1')).toEqual({
            host: '192.168.1.50',
            studioPort: 42000,
            llmPort: 10086,
        });
    });

    it('utilise les ports par défaut Demeter', () => {
        expect(parsePinokioEndpoints('', '')).toEqual({
            host: DEFAULT_PINOKIO_HOST,
            studioPort: DEFAULT_STUDIO_PORT,
            llmPort: DEFAULT_LLM_PORT,
        });
    });
});
