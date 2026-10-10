import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeToolCalls, streamAgentChat, toolCallKey } from './agent-stream';

function sseResponse(events: Array<Record<string, unknown>>): Response {
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizeToolCalls / toolCallKey', () => {
  it('mappe id → call_id et tolère l’ancien format', () => {
    const out = normalizeToolCalls([
      { id: 'c1', name: 'a', arguments: {}, result: {} },
      { name: 'b', arguments: {} },
      null,
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].call_id).toBe('c1');
    expect('id' in out[0]).toBe(false);
    expect(out[1].call_id).toBeUndefined();
  });
  it('clé stable : id sinon nom + position', () => {
    expect(toolCallKey({ call_id: 'c1', name: 'x' }, 4)).toBe('c1');
    expect(toolCallKey({ name: 'x' }, 4)).toBe('x-4');
  });
});

describe('streamAgentChat', () => {
  it('relie tool_start / tool_done par id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sseResponse([
          { type: 'tool_start', id: 'c1', name: 'read_project_file', arguments: {} },
          { type: 'tool_start', id: 'c2', name: 'read_project_file', arguments: {} },
          { type: 'tool_done', id: 'c1', name: 'read_project_file', ok: true, arguments: {}, result: { ok: true } },
          {
            type: 'reply',
            content: 'ok',
            provider: 'p',
            tool_calls: [{ id: 'c1', name: 'read_project_file', arguments: {}, result: { ok: true } }],
          },
        ]),
      ),
    );
    const starts: string[] = [];
    const dones: string[] = [];
    const res = await streamAgentChat('hi', {}, {
      onToolStart: (c) => starts.push(c.call_id || ''),
      onToolDone: (c) => dones.push(c.call_id || ''),
    });
    expect(starts).toEqual(['c1', 'c2']);
    expect(dones).toEqual(['c1']);
    expect(res.reply).toBe('ok');
    expect(res.tool_calls[0].call_id).toBe('c1');
  });

  it('transmet le signal d’annulation au fetch', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const ctrl = new AbortController();
    const p = streamAgentChat('hi', {}, {}, ctrl.signal);
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(ctrl.signal);
  });
});
