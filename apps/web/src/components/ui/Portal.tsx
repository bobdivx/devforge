import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';

/**
 * Monte le contenu sur `document.body`.
 * Un ancêtre avec `transform`, `translate` ou `filter` (animation de page, FadeIn)
 * fait de `position: fixed` un positionnement relatif à cet ancêtre, pas au viewport.
 */
export function Portal({ children }: { children: ComponentChildren }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
