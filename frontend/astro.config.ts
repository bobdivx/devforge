import preact from '@astrojs/preact';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
    base: '/devforge',
    integrations: [preact()],
    outDir: '../backend/public/devforge',
    output: 'static',
    trailingSlash: 'always',
    vite: {
        plugins: [tailwindcss()],
    },
});
