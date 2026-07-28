import preact from '@astrojs/preact';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

const spaBaseRaw = process.env.DEVFORGE_SPA_BASE ?? '/devforge';
const spaBase = spaBaseRaw.replace(/\/$/, '') || '/';

export default defineConfig({
    base: spaBase === '/' ? '/' : spaBase,
    integrations: [preact()],
    outDir: '../backend/public/devforge',
    output: 'static',
    trailingSlash: 'always',
    vite: {
        plugins: [tailwindcss()],
        define: {
            'import.meta.env.DEVFORGE_SPA_BASE': JSON.stringify(spaBase === '/' ? '/' : spaBase),
        },
    },
});
