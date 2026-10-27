/**
 * Outils purs du fil de chat : ids stables, réconciliation optimiste ↔ serveur,
 * signature de contenu (évite les re-rendus inutiles au polling).
 */
export type IdentifiedMessage = {
  id: string;
  role: string;
  content: string;
  toolCalls?: unknown[];
  error?: boolean;
  reactions?: { emoji: string; count: number; mine: boolean }[];
};

export const LOCAL_PREFIX = 'local-';

/** Id d'un message optimiste. `crypto.randomUUID` n'existe qu'en contexte sécurisé (HTTPS). */
export function localMessageId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') {
    try {
      return `${LOCAL_PREFIX}${c.randomUUID()}`;
    } catch {
      /* contexte non sécurisé */
    }
  }
  return `${LOCAL_PREFIX}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isLocalId(id: string): boolean {
  return id.startsWith(LOCAL_PREFIX);
}

/** Signature : longueur + dernier id + taille du dernier contenu + nb d'outils du dernier. */
export function messagesSignature(messages: IdentifiedMessage[]): string {
  const last = messages[messages.length - 1];

  // Réactions (P5-03) : une réaction ailleurs dans le fil doit se voir au rechargement.
  // Using string concatenation in a loop to avoid intermediate array allocations and map calls
  // which causes significant memory/CPU overhead on long lists.
  let reactionsSig = '';
  for (let i = 0; i < messages.length; i++) {
    const r = messages[i].reactions;
    if (r && r.length > 0) {
      reactionsSig += i + ':';
      for (let j = 0; j < r.length; j++) {
        const x = r[j];
        reactionsSig += x.emoji + x.count + (x.mine ? '*' : '');
      }
      reactionsSig += ',';
    }
  }

  return `${messages.length}|${last?.id ?? ''}|${last?.content.length ?? 0}|${last?.toolCalls?.length ?? 0}|${reactionsSig}`;
}

/**
 * Réconcilie par position les messages optimistes (ids `local-…`) avec ceux renvoyés
 * par le serveur : même position + même rôle ⇒ on garde l'id local comme clé React
 * (pas de remontage ni de ré-animation). Les ids serveur sont conservés ailleurs.
 */
export function reconcileMessageIds<T extends IdentifiedMessage>(prev: T[], next: T[]): T[] {
  if (!prev.length) return next;
  // Les cartes d'erreur ne sont jamais persistées : on les retire du décompte de positions.
  const prevPersistable = prev.filter((m) => !m.error);
  let changed = false;
  const out = next.map((m, i) => {
    const p = prevPersistable[i];
    if (p && isLocalId(p.id) && p.role === m.role && p.id !== m.id) {
      changed = true;
      return { ...m, id: p.id };
    }
    return m;
  });
  return changed ? out : next;
}

/** Id stable d'un message serveur (uuid), repli sur la position si absent. */
export function serverMessageId(uuid: string | undefined, index: number): string {
  return uuid && uuid.trim() ? uuid : `srv-${index}`;
}
