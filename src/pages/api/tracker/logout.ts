import type { APIRoute } from 'astro';
import { clearTrackerCookie } from '../../../lib/tracker/auth';
import { isSameOrigin } from '../../../lib/session';

export const prerender = false;

/** POST only, so a logout can't be triggered by a stray link or prefetch. */
export const POST: APIRoute = async ({ request }) => {
  const headers: Record<string, string> = { Location: '/tracking/admin' };
  if (isSameOrigin(request)) headers['Set-Cookie'] = clearTrackerCookie();
  return new Response(null, { status: 303, headers });
};
