import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSseParser, streamAgentChat, type AgentToolCall } from './agent-stream';
import FIXTURE from './__fixtures__/agent-stream.sse?raw';


/** Réponse SSE découpée en paquets de `size` octets (coupe les événements et l'UTF-8). */
function sseResponse(text: string, size: number): Response {
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('createSseParser', () => {
  it('garde un événement coupé entre deux paquets', () => {
    const seen: string[] = [];
    const p = createSseParser((_e, d) => seen.push(d));
    p.push('data: {"a":');
    expect(seen).toEqual([]);
    p.push('1}\n');
    p.push('\ndata: {"b":2}\r\n\r\n');
    expect(seen).toEqual(['{"a":1}', '{"b":2}']);
  });
});

describe('streamAgentChat (flux enregistré)', () => {
  for (const size of [1, 7, 64, 100_000]) {
    it(`paquets de ${size} octets : mêmes événements`, async () => {
      vi.stubGlobal('fetch', vi.fn(async () => sseResponse(FIXTURE, size)));
      const calls: string[] = [];
      const deltas: string[] = [];
      const done: AgentToolCall[] = [];
      const milestones: string[] = [];
      const res = await streamAgentChat(
        'Corrige le contraste',
        { project_uuid: 'p', agent_uuid: 'a' },
        {
          onRunStarted: (run, msg) => calls.push(`run:${run}:${msg}`),
          onAck: (t) => calls.push(`ack:${t}`),
          onDelta: (t) => deltas.push(t),
          onDeltaReset: (r) => calls.push(`reset:${r}`),
          onMilestone: (l, s) => milestones.push(`${l}:${s}`),
          onToolStart: (c) => calls.push(`start:${c.call_id}:${c.label}`),
          onToolDone: (c) => done.push(c),
        },
      );
      expect(calls.slice(0, 3)).toEqual(['run:run-1:msg-1', "ack:C'est noté, je m'en occupe.", 'reset:1']);
      expect(calls).toContain('start:c1:Lecture de src/Header.astro');
      expect(deltas.join('')).toBe('Je lis le header.Contraste corrigé, build OK.');
      expect(milestones).toEqual([
        'Modification des fichiers:running',
        'Modification des fichiers:done',
        'Build:running',
        'Build:done',
      ]);
      expect(done.map((c) => c.summary)).toEqual([
        '✓ Lecture de src/Header.astro · 40 ms',
        '✓ Écriture de src/Header.astro · 12 ms',
        '✓ build OK · 12 s',
      ]);
      expect(done[2].elapsed_ms).toBe(12300);
      expect(res.reply).toBe('Contraste corrigé, build OK.');
      expect(res.tool_calls.map((t) => t.call_id)).toEqual(['c1', 'c2', 'c3']);
      // Le texte du tour à outils est passé en réflexion (une seule fois).
      expect(res.reflections?.map((r) => r.detail)).toEqual(['Je lis le header.']);
    });
  }

  it('ancien client sans handlers : fonctionne', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(FIXTURE, 13)));
    const res = await streamAgentChat('x', {});
    expect(res.reply).toBe('Contraste corrigé, build OK.');
  });

  it('ancien serveur : jalon sans status = libellé en cours ; tool_done sans id apparié par nom', async () => {
    const legacy = [
      'data: {"type":"milestone","label":"Modèle saturé, nouvel essai…"}',
      'data: {"type":"tool_start","name":"get_project","arguments":{}}',
      'data: {"type":"tool_done","name":"get_project","ok":true,"arguments":{},"result":{"ok":true}}',
      'data: {"type":"reply","content":"ok","provider":"x","tool_calls":[]}',
      '',
    ].join('\n\n');
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(legacy, 5)));
    const labels: string[] = [];
    const milestones: string[] = [];
    const res = await streamAgentChat(
      'x',
      {},
      { onThinking: (l) => labels.push(l), onMilestone: (l) => milestones.push(l) },
    );
    expect(labels).toEqual(['Modèle saturé, nouvel essai…']);
    expect(milestones).toEqual([]);
    expect(res.tool_calls).toHaveLength(1);
    expect(res.tool_calls[0].result?.ok).toBe(true);
  });

  it('erreur du flux : rejetée', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse('data: {"type":"error","message":"boom","retryable":true}\n\n', 4)),
    );
    await expect(streamAgentChat('x', {})).rejects.toThrow('boom');
  });
});
