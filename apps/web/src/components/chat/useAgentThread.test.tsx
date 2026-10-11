import { act, renderHook, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import type { AgentChatResult, StreamHandlers } from '../../lib/agent-stream';
import { useAgentThread, type AgentThreadApi } from './useAgentThread';

type Srv = { uuid: string; role: string; content: string; provider?: string; tool_calls_json?: string };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function client(over: Partial<AgentThreadApi> & { history?: Srv[] } = {}) {
  let history = over.history ?? [];
  const c: AgentThreadApi & { setHistory(h: Srv[]): void } = {
    setHistory: (h) => (history = h),
    agentMessages: vi.fn(async () => ({ data: history })) as never,
    activeRun: vi.fn(async () => ({ data: null })) as never,
    cancelAgentRun: vi.fn(async () => ({ data: { ok: true, status: 'cancelling' } })) as never,
    clearAgentMessages: vi.fn(async () => ({})) as never,
    approvePublish: vi.fn(async () => ({})) as never,
    projectAgents: vi.fn(async () => ({ data: [] })) as never,
    stream: vi.fn(),
    subscribe: vi.fn(),
    ...over,
  };
  return c;
}

const reply = (text: string): AgentChatResult => ({ reply: text, tool_calls: [], provider: 'mock' }) as AgentChatResult;

describe('useAgentThread (P5-00)', () => {
  it('charge l’historique sans l’animer', async () => {
    const c = client({ history: [{ uuid: 'a', role: 'user', content: 'salut' }, { uuid: 'b', role: 'assistant', content: 'bonjour' }] });
    const { result } = renderHook(() => useAgentThread({ projectUuid: 'p', agentUuid: 'ag', client: c }));
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(result.current.historyIds.has('a')).toBe(true);
    expect(c.activeRun).toHaveBeenCalledWith('p', 'ag');
  });

  it('envoi : brouillon streamé puis finalisé sur le même id', async () => {
    const done = deferred<AgentChatResult>();
    let h: StreamHandlers | undefined;
    const c = client({
      stream: vi.fn((_t: string, _ctx: unknown, handlers: StreamHandlers) => {
        h = handlers;
        return done.promise;
      }) as never,
    });
    const onSent = vi.fn();
    const { result } = renderHook(() => useAgentThread({ projectUuid: 'p', agentUuid: 'ag', client: c, onSent }));
    await waitFor(() => expect(c.agentMessages).toHaveBeenCalled());
    act(() => void result.current.send('  Bonjour  '));
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(onSent).toHaveBeenCalled();
    const [user, draft] = result.current.messages;
    expect(user).toMatchObject({ role: 'user', content: 'Bonjour' });
    expect(draft.streaming).toBe(true);
    expect(result.current.busy).toBe(true);
    act(() => {
      h!.onAck?.('C’est noté');
      h!.onDelta?.('Tout ', 1);
      h!.onDelta?.('va bien', 1);
    });
    expect(result.current.messages[1]).toMatchObject({ id: draft.id, content: 'Tout va bien', ack: 'C’est noté' });
    await act(async () => done.resolve(reply('Tout va bien.')));
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.messages[1]).toMatchObject({ id: draft.id, content: 'Tout va bien.', streaming: false });
    expect(result.current.messages[1].elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('file : un message envoyé pendant un run part à la fin', async () => {
    const first = deferred<AgentChatResult>();
    const stream = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(async () => reply('deux'));
    const c = client({ stream: stream as never });
    const { result } = renderHook(() => useAgentThread({ projectUuid: 'p', agentUuid: 'ag', client: c }));
    await waitFor(() => expect(c.agentMessages).toHaveBeenCalled());
    act(() => void result.current.send('un'));
    await waitFor(() => expect(result.current.busy).toBe(true));
    act(() => void result.current.send('deux'));
    expect(result.current.queued).toBe('deux');
    expect(stream).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve(reply('un')));
    await waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.messages.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['un', 'deux']));
    expect(result.current.queued).toBeNull();
  });

  it('réconciliation : le rechargement serveur garde les ids locaux (pas de re-montage)', async () => {
    const c = client({ stream: vi.fn(async () => reply('ok')) as never });
    const { result } = renderHook(() => useAgentThread({ projectUuid: 'p', agentUuid: 'ag', client: c }));
    await waitFor(() => expect(c.agentMessages).toHaveBeenCalled());
    await act(async () => result.current.send('hello'));
    const ids = result.current.messages.map((m) => m.id);
    c.setHistory([
      { uuid: 'srv-u', role: 'user', content: 'hello' },
      { uuid: 'srv-a', role: 'assistant', content: 'ok' },
    ]);
    await act(async () => result.current.loadMessages('ag'));
    expect(result.current.messages.map((m) => m.id)).toEqual(ids);
  });

  it('erreur : carte d’erreur au même endroit, puis Réessayer renvoie le message', async () => {
    const stream = vi.fn().mockRejectedValueOnce(new Error('524')).mockResolvedValueOnce(reply('ok'));
    const c = client({ stream: stream as never });
    const { result } = renderHook(() => useAgentThread({ projectUuid: 'p', agentUuid: 'ag', client: c }));
    await waitFor(() => expect(c.agentMessages).toHaveBeenCalled());
    await act(async () => result.current.send('hello'));
    const err = result.current.messages[1];
    expect(err).toMatchObject({ error: true, content: '524' });
    await act(async () => result.current.onRetry(err.id));
    await waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.messages.map((m) => m.content)).toEqual(['hello', 'ok']));
  });

  it('reprend un run en cours (flux simulé) et l’arrête pour de vrai', async () => {
    const done = deferred<AgentChatResult>();
    let h: StreamHandlers | undefined;
    const c = client({
      activeRun: vi.fn(async () => ({ data: { run_uuid: 'run-9', started_at: new Date().toISOString() } })) as never,
      subscribe: vi.fn((_r: string, handlers: StreamHandlers) => {
        h = handlers;
        return done.promise;
      }) as never,
    });
    const onRunEnd = vi.fn();
    const { result } = renderHook(() => useAgentThread({ projectUuid: 'p', agentUuid: 'ag', client: c, onRunEnd }));
    await waitFor(() => expect(result.current.following).toBe(true));
    act(() => h!.onDelta?.('en cours', 1));
    expect(result.current.messages.at(-1)).toMatchObject({ streaming: true, content: 'en cours' });
    act(() => result.current.stop());
    expect(c.cancelAgentRun).toHaveBeenCalledWith('run-9');
    expect(result.current.messages.at(-1)?.liveLabel).toBe('Arrêt demandé…');
    await act(async () => done.resolve(reply('Arrêté à ta demande.')));
    await waitFor(() => expect(result.current.following).toBe(false));
    expect(onRunEnd).toHaveBeenCalledWith('ag');
  });
});
