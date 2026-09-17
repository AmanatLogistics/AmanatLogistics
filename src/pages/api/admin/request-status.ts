import type { APIRoute } from 'astro';
import { isAdmin } from '../../../lib/auth';
import { isSameOrigin } from '../../../lib/session';
import { setStatus, STATUSES, type Status } from '../../../lib/quotes';

export const prerender = false;

const back = (query = '') =>
  new Response(null, { status: 303, headers: { Location: `/admin/requests${query}` } });

/** Move one enquiry along: new → contacted → quoted → closed. */
export const POST: APIRoute = async ({ request }) => {
  if (!isSameOrigin(request)) return back('?error=origin');
  if (!(await isAdmin(request))) return back('?error=auth');

  const form = await request.formData();
  const id = Number(form.get('id'));
  const status = String(form.get('status') ?? '');
  if (!id || !(STATUSES as readonly string[]).includes(status)) return back('?error=bad');

  try {
    await setStatus(id, status as Status);
  } catch (e) {
    console.error('Updating a quote request failed:', e);
    return back('?error=save');
  }
  return back('?updated=1');
};
