import type { APIRoute } from 'astro';
import { adminPassword, createSessionCookie } from '../../../lib/auth';
import { isSameOrigin } from '../../../lib/session';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  // Matches the tracker and orders logins, which already refuse a foreign origin.
  if (!isSameOrigin(request)) {
    return new Response(JSON.stringify({ error: 'That request looked unsafe, so it was blocked.' }), { status: 403 });
  }

  const expected = adminPassword();
  if (!expected) {
    return new Response(JSON.stringify({ error: 'Admin is not configured. Set ADMIN_PASSWORD.' }), { status: 500 });
  }

  let password = '';
  try {
    ({ password } = await request.json());
  } catch {
    /* fallthrough to reject */
  }

  if (password !== expected) {
    // Small delay blunts brute-force attempts.
    await new Promise((r) => setTimeout(r, 800));
    return new Response(JSON.stringify({ error: 'Wrong password.' }), { status: 401 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Set-Cookie': await createSessionCookie(), 'Content-Type': 'application/json' },
  });
};
