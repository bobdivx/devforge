import { useEffect, useRef, useState } from 'preact/hooks';

/**
 * Hauteur (px) masquée par le clavier virtuel.
 *
 * Android Chrome (avec `interactive-widget=resizes-content`) redimensionne déjà le
 * layout : innerHeight suit et l'inset reste 0. iOS Safari ne redimensionne que le
 * visualViewport : la différence donne la hauteur du clavier.
 */
export function computeInset(innerHeight: number, vvHeight: number, vvOffsetTop: number, scale = 1): number {
  // Zoom au pincement : le visualViewport rétrécit sans clavier.
  if (scale > 1.01) return 0;
  const raw = innerHeight - vvHeight - vvOffsetTop;
  // Petites variations (barre d'adresse, arrondis) : on ignore.
  return raw > 40 ? Math.round(raw) : 0;
}

/**
 * Partie d'un élément (bas en coordonnées du layout viewport) cachée sous le clavier.
 * Sert à remonter le composer juste au-dessus du clavier, sans le faire flotter trop haut
 * quand le panneau ne descend pas jusqu'en bas de l'écran.
 */
export function computeOverlap(rectBottom: number, vvHeight: number, vvOffsetTop: number): number {
  const hidden = rectBottom - (vvOffsetTop + vvHeight);
  return hidden > 0 ? Math.round(hidden) : 0;
}

function readInset(): number {
  if (typeof window === 'undefined') return 0;
  const vv = window.visualViewport;
  if (!vv) return 0;
  return computeInset(window.innerHeight, vv.height, vv.offsetTop, vv.scale);
}

/** px masqués par le clavier ; écoute visualViewport resize + scroll, throttle rAF. */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        setInset(readInset());
      });
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}

/**
 * Hauteur (px) d'un élément cachée sous le clavier. Renvoie 0 sans clavier.
 * Relit la position de l'élément à chaque resize/scroll du visualViewport (iOS fait
 * défiler la page au focus), throttle rAF. `onChange` est appelé après mise à jour.
 */
export function useKeyboardOverlap(
  ref: { current: HTMLElement | null },
  onChange?: (overlap: number) => void,
): number {
  const [overlap, setOverlap] = useState(0);
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return;
    let frame = 0;
    let last = -1;
    const measure = () => {
      frame = 0;
      const inset = computeInset(window.innerHeight, vv.height, vv.offsetTop, vv.scale);
      let next = 0;
      const el = ref.current;
      if (inset > 0 && el) {
        const rect = el.getBoundingClientRect();
        // Garder au moins ~180 px pour le fil + le composer.
        next = Math.min(computeOverlap(rect.bottom, vv.height, vv.offsetTop), Math.max(0, rect.height - 180));
      }
      if (next !== last) {
        last = next;
        setOverlap(next);
        cb.current?.(next);
      }
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    schedule();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    window.addEventListener('focusin', schedule);
    window.addEventListener('focusout', schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      window.removeEventListener('focusin', schedule);
      window.removeEventListener('focusout', schedule);
    };
  }, [ref]);
  return overlap;
}
