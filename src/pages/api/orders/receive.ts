import type { APIRoute } from 'astro';
import { isOrdersAdmin } from '../../../lib/orders/auth';
import { isSameOrigin } from '../../../lib/session';
import { isConfigured, updateOrder } from '../../../lib/orders/api';
import { formatDate, today } from '../../../lib/tracker/shipments';
import { ORDER_STAGE_COUNT } from '../../../lib/orders/model';

export const prerender = false;

/**
 * Mark a shipment delivered to Delhi — stage 14, the last of the sheet's
 * fourteen. Writes that stage's date column and nothing else, so the sheet's
 * own status formula recomputes from it exactly as it would if the date were
 * typed in by hand.
 *
 * The sheet-backed twin of /api/tracker/receive, and deliberately the same
 * reply contract, so the dashboard script drives both without knowing which
 * backend is behind it.
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
  if (!id) return fail(400, 'Unknown shipment.');

  const date = today();
  try {
    await updateOrder(id, { [`stage_date_${ORDER_STAGE_COUNT}`]: date });
  } catch (e) {
    console.error('Marking shipment delivered failed:', e);
    return fail(500, 'Could not update the sheet. Please try again.');
  }

  if (wantsJson) {
    return new Response(
      JSON.stringify({
        ok: true,
        id,
        current_step: ORDER_STAGE_COUNT,
        date,
        dateLabel: formatDate(date),
        gapLabel: '',
        stageLabel: `${ORDER_STAGE_COUNT}. Delivered to Delhi · ${formatDate(date)}`,
        badgeLabel: 'Delivered',
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }

  return new Response(null, { status: 303, headers: { Location: '/orders/admin?delivered=1' } });
};
