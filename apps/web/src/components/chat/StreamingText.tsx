import { useEffect, useRef, useState } from 'preact/hooks';
import { cn } from '../../lib/cn';
import { Markdown, MD_MESSAGE_CLASS } from '../../lib/markdown';
import { prefersReducedMotion } from '../../lib/motion';

/** Caractères révélés par frame : rattrape tout seul les gros paquets réseau. */
export function revealStep(pending: number): number {
  return Math.min(60, Math.max(2, Math.ceil(pending / 8)));
}

/** Nombre de frames pour révéler `length` caractères (borne utilisée par les tests). */
export function framesToReveal(length: number): number {
  let shown = 0;
  let frames = 0;
  while (shown < length) {
    shown = Math.min(length, shown + revealStep(length - shown));
    frames += 1;
  }
  return frames;
}

/** Re-rendu Markdown au plus toutes les 50 ms pendant le streaming (pas à chaque frame). */
export const MARKDOWN_THROTTLE_MS = 50;

/**
 * Texte de l'agent qui s'écrit au fil des deltas (P2-02).
 * Reduced-motion : pas de révélation progressive ni de curseur, le texte suit les deltas.
 */
export function StreamingText({
  text,
  streaming,
  class: className,
}: {
  text: string;
  streaming: boolean;
  class?: string;
}) {
  const [reduced] = useState(prefersReducedMotion);
  const animate = streaming && !reduced;
  const [shown, setShown] = useState(animate ? 0 : text.length);
  const shownRef = useRef(shown);
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    if (!animate) {
      shownRef.current = text.length;
      setShown(text.length);
      return;
    }
    // Texte remplacé (ex. remis à zéro) : on repart de sa longueur actuelle.
    if (text.length < shownRef.current) {
      shownRef.current = text.length;
      setShown(text.length);
    }
    let raf = 0;
    const tick = () => {
      const target = textRef.current.length;
      if (shownRef.current < target) {
        shownRef.current = Math.min(target, shownRef.current + revealStep(target - shownRef.current));
        setShown(shownRef.current);
      }
      raf = shownRef.current < textRef.current.length ? window.requestAnimationFrame(tick) : 0;
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [text, animate]);

  // Markdown limité à ~20 rendus/s ; le rendu suivant contient tout le texte révélé.
  const visible = text.slice(0, shown);
  const [md, setMd] = useState(visible);
  const lastMd = useRef(0);
  useEffect(() => {
    if (md === visible) return;
    const now = Date.now();
    const wait = MARKDOWN_THROTTLE_MS - (now - lastMd.current);
    if (!animate || wait <= 0 || shown >= text.length) {
      lastMd.current = now;
      setMd(visible);
      return;
    }
    const id = window.setTimeout(() => {
      lastMd.current = Date.now();
      setMd(textRef.current.slice(0, shownRef.current));
    }, wait);
    return () => window.clearTimeout(id);
  }, [visible, animate, md, shown, text.length]);

  return (
    <div class={cn('df-stream relative', className)} data-streaming={streaming ? 'true' : 'false'}>
      <Markdown text={md} class={MD_MESSAGE_CLASS} />
      {animate ? <span class="df-caret" aria-hidden /> : null}
    </div>
  );
}
