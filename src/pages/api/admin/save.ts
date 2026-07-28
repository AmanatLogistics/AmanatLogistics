import type { APIRoute } from 'astro';
import { isAdmin } from '../../../lib/auth';
import { saveContent } from '../../../lib/store';

export const prerender = false;

// Only these top-level keys may be written from the admin UI.
const ALLOWED = new Set([
  'brand',
  'hero',
  'stats',
  'contact',
  'exports',
  'destinations',
  'gallery',
  'team',
  'platforms',
  'services',
  'why',
  'values',
  'about',
  'seo',
  'images',
  'pageHeaders',
  'freightModes',
  'shopping',
  'shoppingSteps',
]);

export const POST: APIRoute = async ({ request }) => {
  if (!(await isAdmin(request))) {
    return new Response(JSON.stringify({ error: 'Not authorized.' }), { status: 401 });
  }

  let patch: Record<string, unknown>;
  try {
    patch = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request.' }), { status: 400 });
  }

  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => ALLOWED.has(k)));
  if (!Object.keys(clean).length) {
    return new Response(JSON.stringify({ error: 'Nothing to save.' }), { status: 400 });
  }

  try {
    await saveContent(clean);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    console.error('Save failed:', e);
    const msg = e instanceof Error && e.message.startsWith('Storage not connected') ? e.message : 'Could not save. Try again.';
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
};
