import type { APIRoute } from 'astro';
import { isAdmin } from '../../../lib/auth';
import { isSameOrigin } from '../../../lib/session';
import { deleteRequest } from '../../../lib/quotes';

export const prerender = false;

const back = (query = '') =>
  new Response(null, { status: 303, headers: { Location: `/admin/requests${query}` } });

/** Remove one enquiry for good. The page asks for confirmation first. */
export const POST: APIRoute = async ({ request }) => {
  if (!isSameOrigin(request)) return back('?error=origin');
  if (!(await isAdmin(request))) return back('?error=auth');

  const id = Number((await request.formData()).get('id'));
  if (!id) return back('?error=bad');

  try {
    await deleteRequest(id);
  } catch (e) {
    console.error('Deleting a quote request failed:', e);
    return back('?error=save');
  }
  return back('?deleted=1');
};
