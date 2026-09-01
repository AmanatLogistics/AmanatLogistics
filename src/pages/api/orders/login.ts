import type { APIRoute } from 'astro';
import { createOrdersCookie, ordersPassword } from '../../../lib/orders/auth';
import { isSameOrigin } from '../../../lib/session';

export const prerender = false;

const back = (query: string, cookie?: string) =>
  new Response(null, {
    status: 303, // 303 so the browser follows with GET after the POST
    headers: {
      Location: `/tracking/orders/admin${query}`,
      ...(cookie ? { 'Set-Cookie': cookie } : {}),
    },
  });

/** Mirrors the tracker admin's login, down to the delay on a wrong password. */
export const POST: APIRoute = async ({ request }) => {
  if (!isSameOrigin(request)) return back('?error=origin');

  const expected = ordersPassword();
  if (!expected) return back('?error=unconfigured');

  const form = await request.formData();
  if (String(form.get('password') ?? '') !== expected) {
    await new Promise((r) => setTimeout(r, 800));
    return back('?error=1');
  }

  return back('', await createOrdersCookie());
};
