// @ts-check
import { defineConfig } from 'astro/config';

import preact from '@astrojs/preact';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
// Front DevForge sur 8080 — 4321 souvent pris par les apps Astro déployées (ex. sonozz).
export default defineConfig({
  integrations: [preact()],
  server: {
    host: true,
    port: 8080,
    strictPort: true,
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      dedupe: ['preact', 'preact/hooks', 'preact/jsx-runtime'],
    },
    ssr: {
      // Bundler lucide avec la même Preact (évite une 2ᵉ copie via peer dep)
      noExternal: ['lucide-preact'],
    },
  },
});
