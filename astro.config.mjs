// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

// Astro 7 — mostly static marketing site with one on-demand API route
// (src/pages/api/contact.ts opts into server rendering via `export const prerender = false`).
export default defineConfig({
  site: 'https://amanatlogistics.com',
  adapter: vercel(),
  vite: {
    plugins: [tailwindcss()],
  },
});
