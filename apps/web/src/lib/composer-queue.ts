/**
 * File d'attente du composer : pendant qu'un agent travaille, un envoi est mis en
 * attente (un seul message, les envois successifs sont regroupés) puis part
 * automatiquement à la fin du run.
 */
export type ComposerQueue = { queued: string | null };

export type ComposerQueueAction =
  | { type: 'enqueue'; text: string }
  | { type: 'flushOnIdle' }
  | { type: 'cancelQueued' };

export const EMPTY_QUEUE: ComposerQueue = { queued: null };

/** Ajoute un message en file. Un message déjà en attente est complété (pas écrasé). */
export function enqueue(state: ComposerQueue, text: string): ComposerQueue {
  const t = text.trim();
  if (!t) return state;
  return { queued: state.queued ? `${state.queued}\n\n${t}` : t };
}

/** Fin de run : renvoie le texte à envoyer (ou null) et vide la file. */
export function flushOnIdle(state: ComposerQueue): { state: ComposerQueue; send: string | null } {
  return { state: EMPTY_QUEUE, send: state.queued };
}

/** ✕ sur la puce « En attente » : on abandonne le message. */
export function cancelQueued(_state: ComposerQueue): ComposerQueue {
  return EMPTY_QUEUE;
}

export function composerQueueReducer(state: ComposerQueue, action: ComposerQueueAction): ComposerQueue {
  switch (action.type) {
    case 'enqueue':
      return enqueue(state, action.text);
    case 'flushOnIdle':
      return flushOnIdle(state).state;
    case 'cancelQueued':
      return cancelQueued(state);
    default:
      return state;
  }
}
