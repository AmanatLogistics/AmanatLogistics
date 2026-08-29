import type { APIRoute } from 'astro';
import { isOrdersAdmin } from '../../../lib/orders/auth';
import { isSameOrigin } from '../../../lib/session';
import { isConfigured, updateOrder } from '../../../lib/orders/api';
import { daysBetween, formatDate, STEP_COUNT, today } from '../../../lib/tracker/shipments';

export const prerender = false;

/**
 * Mark an order received — the sheet-backed twin of /api/tracker/receive, and
 * deliberately the same contract, so the dashboard script drives both without
 * knowing which backend is behind it.
 *
 * One handler, two shapes of reply: JSON for the page's script, a 303 back to
 * the list for a plain form POST with JavaScript off.
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
    return new Response(null, {
      status: 303,
      headers: { Location: `/orders/admin?error=${status === 403 ? 'origin' : 'receive'}` },
    });
  };

  if (!isSameOrigin(request)) return fail(403, 'That request looked unsafe, so it was blocked.');
  if (!(await isOrdersAdmin(request))) return fail(401, 'Your session has expired. Please log in again.');
  if (!isConfigured()) return fail(503, 'Google Sheets is not connected.');

  const form = await request.formData();
  const id = String(form.get('id') ?? '').trim();
  if (!id) return fail(400, 'Unknown order.');
  const estimated = String(form.get('estimated') ?? '');

  const date = today();
  try {
    // Final stage plus the arrival date, in one write.
    await updateOrder(id, {
      stage: String(STEP_COUNT),
      status: 'Received',
      actual_delivery: date,
    });
  } catch (e) {
    console.error('Marking order received failed:', e);
    return fail(500, 'Could not update the sheet. Please try again.');
  }

  if (wantsJson) {
    const days = estimated ? daysBetween(estimated, date) : null;
    const unit = (n: number) => (n === 1 ? 'day' : 'days');
    const gapLabel =
      days === null ? '' : days === 0 ? 'on time' : days > 0 ? `${days} ${unit(days)} late` : `${-days} ${unit(-days)} early`;

    return new Response(
      JSON.stringify({ ok: true, id, current_step: STEP_COUNT, date, dateLabel: formatDate(date), gapLabel }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }

  return new Response(null, { status: 303, headers: { Location: '/orders/admin?saved=1' } });
};
