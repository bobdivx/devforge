import { afterEach, describe, expect, it, vi } from 'vitest';
import { reconnectDelay, streamAgentChat, subscribeRun } from './agent-stream';

/** Flux SSE ; `cut` : la connexion casse après ces octets (coupure réseau). */
function sse(text: string, cut?: number): Response {
  const bytes = new TextEncoder().encode(text);
  let sent = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (cut === undefined) {
        c.enqueue(bytes);
        c.close();
      } else if (!sent) {
        sent = true;
        c.enqueue(bytes.slice(0, cut));
      } else {
        c.error(new TypeError('network error'));
      }
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const ev = (seq: number, payload: object) => `id: ${seq}\nevent: message\ndata: ${JSON.stringify(payload)}\n\n`;
const noSleep = async () => undefined;

afterEach(() => vi.unstubAllGlobals());

describe('reprise d’un run (P4-02)', () => {
  it('délais de reconnexion 1 s → 10 s', () => {
    expect([1, 2, 3, 4, 5, 9].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000, 10000, 10000]);
  });

  it('coupure en plein run : reprise avec after=<seq>, sans perte ni doublon', async () => {
    const first =
      ev(1, { type: 'run_started', run_uuid: 'run-9', message_uuid: 'm' }) +
      ev(2, { type: 'delta', text: 'Bon', round: 1 }) +
      ev(3, { type: 'delta', text: 'jour', round: 1 });
    // Le serveur renvoie seq > 3, mais on simule aussi un doublon (3) déjà vu.
    const resumed =
      ev(3, { type: 'delta', text: 'jour', round: 1 }) +
      ev(4, { type: 'delta', text: ' !', round: 1 }) +
      ev(5, { type: 'reply', content: 'Bonjour !', provider: 'p', tool_calls: [] }) +
      'event: done\ndata: {"status":"completed"}\n\n';
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(url);
      if (url.endsWith('/agent/chat')) return sse(first + 'id: 4\nevent: mes', first.length + 10);
      expect((init?.headers as Record<string, string>)['Last-Event-ID']).toBe('3');
      return sse(resumed);
    });
    vi.stubGlobal('fetch', fetchMock);
    const deltas: string[] = [];
    const res = await streamAgentChat('salut', { project_uuid: 'p', agent_uuid: 'a' }, { onDelta: (t) => deltas.push(t) }, undefined, { sleep: noSleep });
    expect(deltas.join('')).toBe('Bonjour !');
    expect(res.reply).toBe('Bonjour !');
    expect(urls[1]).toMatch(/\/agent\/runs\/run-9\/events\?after=3$/);
  });

  it('se reconnecte plusieurs fois (serveur indisponible) puis termine', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls += 1;
        if (calls < 3) return new Response('busy', { status: 502 });
        expect(url).toMatch(/after=7$/);
        return sse(ev(8, { type: 'reply', content: 'fini', tool_calls: [] }) + 'event: done\ndata: {"status":"completed"}\n\n');
      }),
    );
    const sleeps: number[] = [];
    const res = await subscribeRun('run-1', {}, undefined, 7, { sleep: async (ms) => void sleeps.push(ms) });
    expect(res.reply).toBe('fini');
    expect(res.status).toBe('completed');
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('run introuvable : erreur immédiate, pas de boucle', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"run introuvable"}', { status: 404 })));
    await expect(subscribeRun('x', {}, undefined, 0, { sleep: noSleep })).rejects.toThrow('run introuvable');
  });

  it('run arrêté : la réponse « Arrêté à ta demande » est rendue avec le statut', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sse(ev(1, { type: 'reply', content: 'Arrêté à ta demande après « npm install ».', tool_calls: [] }) + 'event: done\ndata: {"status":"cancelled"}\n\n'),
      ),
    );
    const res = await subscribeRun('r', {}, undefined, 0, { sleep: noSleep });
    expect(res.status).toBe('cancelled');
    expect(res.reply).toContain('Arrêté à ta demande');
  });
});
