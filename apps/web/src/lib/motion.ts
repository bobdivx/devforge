/**
 * Motion for Preact (Motion.dev via preact-in-motion).
 * Import once from any client island — registers the `animate` prop.
 */
import 'preact-in-motion';

import type { AnimateLifecycleProps, AnimateProp } from 'preact-in-motion';

/**
 * Motion appelle Animation.commitStyles() dans stop() dès qu’un élément est
 * encore connecté. Pendant une view transition Astro, l’élément est connecté
 * mais plus « rendered » : le navigateur lève InvalidStateError, la promesse
 * reste non gérée, et le diff Preact qui suivait peut casser (insertBefore).
 * On avale uniquement ce cas ; cancel() dans stop() s’exécute ensuite.
 */
if (typeof Animation !== 'undefined') {
  const proto = Animation.prototype as Animation & {
    __dfCommitStyles?: boolean;
    commitStyles: () => void;
  };
  const nativeCommit = proto.commitStyles;
  if (nativeCommit && !proto.__dfCommitStyles) {
    proto.commitStyles = function commitStyles() {
      try {
        nativeCommit.call(this);
      } catch (err) {
        if (!(err instanceof DOMException) || err.name !== 'InvalidStateError') throw err;
      }
    };
    proto.__dfCommitStyles = true;
  }
}

export { AnimatePresence } from 'preact-in-motion';
export type { AnimateProp, AnimateLifecycleProps };

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Entrée bien visible (opacity + translateY). */
export function enterUp(delay = 0): AnimateLifecycleProps | undefined {
  if (prefersReducedMotion()) return undefined;
  return {
    initial: { opacity: '0', transform: 'translateY(28px)' },
    enter: {
      opacity: 1,
      transform: 'translateY(0px)',
      duration: 0.55,
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
      transform: 'translateY(-8px) scale(1.02)',
      duration: 0.25,
      ease: EASE_OUT,
    },
    whilePress: {
      transform: 'translateY(-2px) scale(0.97)',
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
      transform: 'scale(1.04)',
      duration: 0.2,
      ease: EASE_OUT,
    },
    whilePress: {
      transform: 'scale(0.96)',
      duration: 0.1,
      ease: EASE_OUT,
    },
  };
}

/** Mockup produit : entrée + hover depth. */
export function productShowcase(): AnimateLifecycleProps | undefined {
  if (prefersReducedMotion()) return undefined;
  return {
    initial: { opacity: '0', transform: 'translateY(36px) scale(0.97)' },
    enter: {
      opacity: 1,
      transform: 'translateY(0px) scale(1)',
      duration: 0.7,
      delay: 0.18,
      ease: EASE_OUT,
    },
    whileHover: {
      transform: 'translateY(-10px) scale(1.015)',
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
