import { describe, expect, it, vi } from 'vitest';
import { domainApi } from '../src/lib/domain-api';

function jsonResponse(data: unknown): Response {
    return new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}

describe('API Ollama control', () => {
    it('liste les instances et lit le statut d’une instance', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(jsonResponse({ data: [{ id: 1, name: 'PC', reachable: true }] }))
            .mockResolvedValueOnce(jsonResponse({ data: { reachable: true, models: [] } }))
            .mockResolvedValueOnce(new Response(null, { status: 204 }))
            .mockResolvedValueOnce(jsonResponse({ data: { ok: true, model: 'qwen2.5:7b' } }));

        await domainApi.ollamaInstances();
        await domainApi.ollamaStatus({ providerId: 1 });
        await domainApi.ollamaPull({ model: 'qwen2.5:7b', provider_id: 1, base_url: 'https://ollama.briseteia.me' });

        expect(String(fetchMock.mock.calls[0][0])).toBe('/api/devforge/v1/ai/ollama/instances');
        expect(String(fetchMock.mock.calls[1][0])).toBe('/api/devforge/v1/ai/ollama?provider_id=1');
        expect(String(fetchMock.mock.calls[3][0])).toBe('/api/devforge/v1/ai/ollama/pull');
    });
});
