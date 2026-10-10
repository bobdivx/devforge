import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/preact';

// jsdom n'implémente pas matchMedia : défaut = pointeur fin, mouvement autorisé.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  cleanup();
});

// jsdom n'implémente pas Web Animations (Motion) : stub minimal, animation terminée immédiatement.
if (typeof Element !== 'undefined' && !Element.prototype.animate) {
  Element.prototype.animate = function animate() {
    const anim = {
      finished: Promise.resolve(),
      ready: Promise.resolve(),
      playState: 'finished',
      currentTime: 0,
      startTime: 0,
      playbackRate: 1,
      effect: null,
      onfinish: null,
      oncancel: null,
      cancel: () => undefined,
      finish: () => undefined,
      play: () => undefined,
      pause: () => undefined,
      reverse: () => undefined,
      commitStyles: () => undefined,
      persist: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    return anim as unknown as Animation;
  };
}
