import { describe, expect, it } from 'vitest';
import { isLocalId, localMessageId, messagesSignature, reconcileMessageIds, serverMessageId } from './chat-messages';

describe('ids de messages', () => {
  it('ids locaux uniques et préfixés', () => {
    const a = localMessageId();
    const b = localMessageId();
    expect(a).not.toBe(b);
    expect(isLocalId(a)).toBe(true);
  });
  it('repli sans crypto.randomUUID (HTTP LAN)', () => {
    const orig = crypto.randomUUID;
    // @ts-expect-error simulation d'un contexte non sécurisé
    crypto.randomUUID = undefined;
    try {
      expect(isLocalId(localMessageId())).toBe(true);
    } finally {
      crypto.randomUUID = orig;
    }
  });
  it('serverMessageId utilise l’uuid', () => {
    expect(serverMessageId('abc', 3)).toBe('abc');
    expect(serverMessageId('', 3)).toBe('srv-3');
  });
});

describe('messagesSignature', () => {
  it('change avec le contenu du dernier message', () => {
    const a = [{ id: '1', role: 'assistant', content: 'abc', toolCalls: [] }];
    const b = [{ id: '1', role: 'assistant', content: 'abcd', toolCalls: [] }];
    expect(messagesSignature(a)).not.toBe(messagesSignature(b));
    expect(messagesSignature(a)).toBe(messagesSignature([{ ...a[0] }]));
  });
});

describe('reconcileMessageIds', () => {
  it('garde les ids locaux à la même position et même rôle', () => {
    const prev = [
      { id: 'u1', role: 'user', content: 'a' },
      { id: 'local-x', role: 'user', content: 'b' },
      { id: 'local-y', role: 'assistant', content: 'r' },
    ];
    const next = [
      { id: 'u1', role: 'user', content: 'a' },
      { id: 'srv-b', role: 'user', content: 'b' },
      { id: 'srv-r', role: 'assistant', content: 'r' },
    ];
    expect(reconcileMessageIds(prev, next).map((m) => m.id)).toEqual(['u1', 'local-x', 'local-y']);
  });
  it('ignore les cartes d’erreur (jamais persistées)', () => {
    const prev = [
      { id: 'local-u', role: 'user', content: 'a' },
      { id: 'local-e', role: 'assistant', content: 'boom', error: true },
    ];
    const next = [
      { id: 'srv-u', role: 'user', content: 'a' },
      { id: 'srv-r', role: 'assistant', content: 'réponse arrivée en fond' },
    ];
    expect(reconcileMessageIds(prev, next).map((m) => m.id)).toEqual(['local-u', 'srv-r']);
  });
  it('renvoie le même tableau sans changement', () => {
    const next = [{ id: 'a', role: 'user', content: 'x' }];
    expect(reconcileMessageIds([{ id: 'a', role: 'user', content: 'x' }], next)).toBe(next);
  });
});
