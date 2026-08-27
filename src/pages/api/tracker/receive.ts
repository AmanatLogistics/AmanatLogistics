import type { APIRoute } from 'astro';
import { isTrackerAdmin } from '../../../lib/tracker/auth';
import { isSameOrigin } from '../../../lib/session';
import { isConfigured } from '../../../lib/tracker/db';
import { daysBetween, formatDate, markReceived, STEP_COUNT, today } from '../../../lib/tracker/shipments';

export const prerender = false;

/**
 * Mark a shipment received ("OK" on the dashboard).
 *
 * One handler, two shapes of reply: the dashboard's script sends
 * `Accept: application/json` and patches the row in place, while a plain form
 * POST (JavaScript off) gets a 303 back to the page it came from. That keeps a
 * single copy of the auth and validation rules for both.
 */
export const POST: APIRoute = async ({ request }) => {
  const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');

  const fail = (status: number, error: string) => {
    if (wantsJson) {
      return new Response(JSON.stringify({ error }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // Without JS there is nowhere to show a message but the page itself.
    return new Response(null, {
      status: 303,
      headers: { Location: `/tracking/admin?error=${status === 403 ? 'origin' : 'receive'}` },
    });
  };

  if (!isSameOrigin(request)) return fail(403, 'That request looked unsafe, so it was blocked.');
  if (!(await isTrackerAdmin(request))) return fail(401, 'Your session has expired. Please log in again.');
  if (!isConfigured()) return fail(503, 'Database not connected.');

  const form = await request.formData();
  const id = Number.parseInt(String(form.get('id') ?? ''), 10);
  if (!Number.isInteger(id) || id <= 0) return fail(400, 'Unknown shipment.');
  // Sent by the page so the row can show "4 days late" without a reload.
  const estimated = String(form.get('estimated') ?? '');

  try {
    await markReceived(id);
  } catch (e) {
    console.error('Marking shipment received failed:', e);
    return fail(500, 'Could not mark that shipment as received. Please try again.');
  }

  if (wantsJson) {
    // Labels are formatted here so the page has one source of date wording.
    const date = today();
    const days = estimated ? daysBetween(estimated, date) : null;
    const unit = (n: number) => (n === 1 ? 'day' : 'days');
    const gapLabel =
      days === null ? '' : days === 0 ? 'on time' : days > 0 ? `${days} ${unit(days)} late` : `${-days} ${unit(-days)} early`;

    return new Response(
      JSON.stringify({ ok: true, id, current_step: STEP_COUNT, date, dateLabel: formatDate(date), gapLabel }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Back where the button was pressed, so the filter in the URL survives.
  const referer = request.headers.get('referer');
  let location = '/tracking/admin?received=1';
  try {
    if (referer) {
      const url = new URL(referer);
      if (url.host === new URL(request.url).host && url.pathname === '/tracking/admin') {
        url.searchParams.set('received', '1');
        location = url.pathname + url.search;
      }
    }
  } catch {
    /* a malformed Referer just falls back to the plain dashboard */
  }
  return new Response(null, { status: 303, headers: { Location: location } });
};
