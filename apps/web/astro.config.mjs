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
  },
});
