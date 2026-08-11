import type { APIRoute } from 'astro';
import { createTrackerCookie, trackerPassword } from '../../../lib/tracker/auth';
import { isSameOrigin } from '../../../lib/session';

export const prerender = false;

const back = (query: string, cookie?: string) =>
  new Response(null, {
    status: 303, // 303 so the browser follows with GET after the POST
    headers: {
      Location: `/tracking/admin${query}`,
      ...(cookie ? { 'Set-Cookie': cookie } : {}),
    },
  });

/**
 * Tracker admin login. Takes a normal form POST and redirects, so the panel
 * works with JavaScript disabled.
 */
export const POST: APIRoute = async ({ request }) => {
  if (!isSameOrigin(request)) return back('?error=origin');

  const expected = trackerPassword();
  if (!expected) return back('?error=unconfigured');

  const form = await request.formData();
  const password = String(form.get('password') ?? '');

  if (password !== expected) {
    // Same small delay the website admin uses to blunt brute-force attempts.
    await new Promise((r) => setTimeout(r, 800));
    return back('?error=1');
  }

  return back('', await createTrackerCookie());
};
