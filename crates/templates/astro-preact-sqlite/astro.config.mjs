import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',
  adapter: node({
    mode: 'standalone'
  }),
  integrations: [preact()],
  server: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT || '3000')
  }
});
