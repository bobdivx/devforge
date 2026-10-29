import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { prefersReducedMotion } from '../../lib/motion';
import { cn } from '../../lib/cn';
import { JumpToLatest } from './JumpToLatest';
import type { ChatMessage } from './types';

/** Autoscroll : suit le bas seulement si l'utilisateur y est déjà (il peut remonter lire). */
export function useStickToBottom(messages: ChatMessage[], resetKey: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const lastSig = useRef('');
  const lastLen = useRef(0);
  const [hasUnseen, setHasUnseen] = useState(false);

  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    // On ne défile que si le contenu a réellement changé.
    const last = messages[messages.length - 1];
    const sig =
      messages.length +
      '|' +
      (last?.content.length ?? 0) +
      '|' +
      (last?.toolCalls?.length ?? 0) +
      '|' +
      (last?.actions?.length ?? 0) +
      '|' +
      (last?.reflections?.length ?? 0) +
      '|' +
      (last?.milestones?.length ?? 0) +
      '|' +
      (last?.liveLabel ?? '') +
      '|' +
      (last?.streaming ? 1 : 0);
    if (sig === lastSig.current) return;
    const first = lastSig.current === '';
    lastSig.current = sig;
    const grew = messages.length > lastLen.current;
    lastLen.current = messages.length;
    // Message que l'on vient d'envoyer : toujours le montrer (une fois, pas pendant tout le run).
    const justSent = grew && last?.role === 'user';
    if (!first && !stickRef.current && !justSent) {
      // L'utilisateur lit plus haut : on signale le nouveau contenu sans le déplacer.
      setHasUnseen(true);
      return;
    }
    // Seule la zone des messages défile, jamais la page (sinon l'écran saute sur mobile).
    // Pendant le streaming : 'auto' (le smooth saccade à chaque delta), smooth pour un nouveau message.
    const instant = first || prefersReducedMotion() || (!!last?.streaming && !grew);
    box.scrollTo({ top: box.scrollHeight, behavior: instant ? 'auto' : 'smooth' });
  }, [messages]);

  useEffect(() => {
    // Nouveau fil : repartir en bas.
    lastSig.current = '';
    lastLen.current = 0;
    stickRef.current = true;
    setHasUnseen(false);
  }, [resetKey]);

  return {
    scrollRef,
    stickRef,
    hasUnseen,
    /** Envoi : on revient en bas et on suit. */
    follow() {
      stickRef.current = true;
      setHasUnseen(false);
    },
    jumpToLatest() {
      const box = scrollRef.current;
      if (!box) return;
      stickRef.current = true;
      setHasUnseen(false);
      box.scrollTo({ top: box.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    },
    /** Clavier mobile : garder la dernière bulle visible si on suivait le bas. */
    keepBottom() {
      if (!stickRef.current) return;
      window.requestAnimationFrame(() => {
        const box = scrollRef.current;
        if (box) box.scrollTo({ top: box.scrollHeight, behavior: 'auto' });
      });
    },
    onScroll(el: HTMLElement) {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      stickRef.current = atBottom;
      if (atBottom) setHasUnseen(false);
    },
  };
}

export type StickToBottom = ReturnType<typeof useStickToBottom>;

/** Lecteurs d'écran : annonce chaque nouvelle réponse de l'agent (pas l'historique). */
function useAnnounce(messages: ChatMessage[], historyIds: Set<string>) {
  const [announce, setAnnounce] = useState('');
  const lastAnnounced = useRef<string | null>(null);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role === 'user') return;
    if (lastAnnounced.current === null || historyIds.has(last.id)) {
      lastAnnounced.current = last.id;
      return;
    }
    if (last.id === lastAnnounced.current) return;
    lastAnnounced.current = last.id;
    setAnnounce(last.error ? 'Erreur de l’agent' : 'Nouvelle réponse de l’agent');
  }, [messages]);
  return announce;
}

/** Zone de messages défilante (elle seule), annonce a11y et bouton « nouveaux messages ». */
export function ChatThread({
  messages,
  historyIds,
  stick,
  class: className,
  children,
}: {
  messages: ChatMessage[];
  historyIds: Set<string>;
  stick: StickToBottom;
  class?: string;
  children: ComponentChildren;
}) {
  const announce = useAnnounce(messages, historyIds);
  return (
    <div class="relative flex min-h-0 flex-1 flex-col">
      <span class="sr-only" aria-live="polite">
        {announce}
      </span>
      <div
        ref={stick.scrollRef}
        class={cn('min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4', className)}
        onScroll={(e) => stick.onScroll(e.currentTarget)}
      >
        {children}
      </div>
      <JumpToLatest visible={stick.hasUnseen} onClick={stick.jumpToLatest} />
    </div>
  );
}
