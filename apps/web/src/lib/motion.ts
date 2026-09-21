/**
 * Motion for Preact (Motion.dev via preact-in-motion).
 * Import once from any client island — registers the `animate` prop.
 */
import 'preact-in-motion';

import type { AnimateLifecycleProps, AnimateProp } from 'preact-in-motion';

export { AnimatePresence } from 'preact-in-motion';
export type { AnimateProp, AnimateLifecycleProps };

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Entrée douce (opacity + translateY). */
export function enterUp(delay = 0): AnimateLifecycleProps | undefined {
  if (prefersReducedMotion()) return undefined;
  return {
    initial: { opacity: '0', transform: 'translateY(18px)' },
    enter: {
      opacity: 1,
      transform: 'translateY(0px)',
      duration: 0.5,
      delay,
      ease: EASE_OUT,
    },
  };
}

/** Lift au survol + press — pour tuiles / cards. */
export function interactiveLift(): AnimateLifecycleProps | undefined {
  if (prefersReducedMotion()) return undefined;
  return {
    whileHover: {
      transform: 'translateY(-4px) scale(1.01)',
      duration: 0.22,
      ease: EASE_OUT,
    },
    whilePress: {
      transform: 'translateY(0px) scale(0.98)',
      duration: 0.12,
      ease: EASE_OUT,
    },
  };
}

/** Press scale — boutons / CTA. */
export function pressScale(): AnimateLifecycleProps | undefined {
  if (prefersReducedMotion()) return undefined;
  return {
    whileHover: {
      transform: 'scale(1.02)',
      duration: 0.18,
      ease: EASE_OUT,
    },
    whilePress: {
      transform: 'scale(0.97)',
      duration: 0.1,
      ease: EASE_OUT,
    },
  };
}

/** Mockup produit : entrée + hover depth. */
export function productShowcase(): AnimateLifecycleProps | undefined {
  if (prefersReducedMotion()) return undefined;
  return {
    initial: { opacity: '0', transform: 'translateY(28px) scale(0.98)' },
    enter: {
      opacity: 1,
      transform: 'translateY(0px) scale(1)',
      duration: 0.65,
      delay: 0.22,
      ease: EASE_OUT,
    },
    whileHover: {
      transform: 'translateY(-6px) scale(1.01)',
      duration: 0.35,
      ease: EASE_OUT,
    },
  };
}

/** Combine plusieurs presets (dernier gagne sur les conflits). */
export function motion(...parts: Array<AnimateProp | undefined | false>): AnimateProp | undefined {
  if (prefersReducedMotion()) return undefined;
  const out: AnimateLifecycleProps = {};
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    Object.assign(out, part);
  }
  return Object.keys(out).length ? out : undefined;
}
