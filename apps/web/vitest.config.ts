import { defineConfig } from 'vitest/config';

// Tests unitaires du front (Preact + jsdom). Indépendant de la config Astro.
export default defineConfig({
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'preact' },
  },
  resolve: {
    dedupe: ['preact', 'preact/hooks', 'preact/jsx-runtime'],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
});
