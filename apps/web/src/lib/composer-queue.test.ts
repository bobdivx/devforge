import { describe, expect, it } from 'vitest';
import { cancelQueued, composerQueueReducer, EMPTY_QUEUE, enqueue, flushOnIdle } from './composer-queue';

describe('file du composer', () => {
  it('enqueue met un message en attente', () => {
    expect(enqueue(EMPTY_QUEUE, '  salut  ')).toEqual({ queued: 'salut' });
  });
  it('enqueue ignore un texte vide', () => {
    expect(enqueue(EMPTY_QUEUE, '   ')).toBe(EMPTY_QUEUE);
  });
  it('un seul message : les envois successifs sont regroupés', () => {
    const q = enqueue(enqueue(EMPTY_QUEUE, 'a'), 'b');
    expect(q.queued).toBe('a\n\nb');
  });
  it('flushOnIdle renvoie le message et vide la file', () => {
    const { state, send } = flushOnIdle({ queued: 'x' });
    expect(send).toBe('x');
    expect(state.queued).toBeNull();
  });
  it('flushOnIdle sans message → rien à envoyer', () => {
    expect(flushOnIdle(EMPTY_QUEUE).send).toBeNull();
  });
  it('cancelQueued vide la file', () => {
    expect(cancelQueued({ queued: 'x' }).queued).toBeNull();
  });
  it('reducer', () => {
    let s = composerQueueReducer(EMPTY_QUEUE, { type: 'enqueue', text: 'a' });
    expect(s.queued).toBe('a');
    s = composerQueueReducer(s, { type: 'cancelQueued' });
    expect(s.queued).toBeNull();
    s = composerQueueReducer(composerQueueReducer(s, { type: 'enqueue', text: 'b' }), { type: 'flushOnIdle' });
    expect(s.queued).toBeNull();
  });
});
