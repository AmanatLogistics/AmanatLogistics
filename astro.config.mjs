// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

// Astro 7 — mostly static marketing site with one on-demand API route
// (src/pages/api/contact.ts opts into server rendering via `export const prerender = false`).
export default defineConfig({
  site: 'https://amanatlogistics.com',
  // Long enough for a large import of old records into the office system.
  adapter: vercel({ maxDuration: 60 }),
  // Prefetch internal links so app-like (View Transitions) navigation is instant.
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'viewport',
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
