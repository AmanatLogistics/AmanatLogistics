import type { APIRoute } from 'astro';
import { clearCookie, currentUser, sameOrigin } from '../../lib/office/auth';
import { logActivity } from '../../lib/office/activity';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (sameOrigin(request)) {
    const user = await currentUser(request).catch(() => null);
    if (user) await logActivity(user.id, 'logout', 'user', user.id, null).catch(() => {});
  }
  return new Response(null, { status: 303, headers: { Location: '/office/login', 'Set-Cookie': clearCookie() } });
};
