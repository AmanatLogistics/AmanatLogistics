import type { APIRoute } from 'astro';
import { isOrdersAdmin } from '../../../lib/orders/auth';
import { sheetSelfTest } from '../../../lib/orders/api';

export const prerender = false;

/**
 * Orders admin diagnostics: actually calls the Google Sheet and says what came
 * back, rather than leaving "Could not read the Google Sheet" to cover four
 * different faults. Admin-only, and it never returns the token or the full URL.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!(await isOrdersAdmin(request))) {
    return new Response(JSON.stringify({ error: 'Not authorized.' }), { status: 401 });
  }

  const e = process.env ?? {};
  const report = {
    environment: e.VERCEL_ENV ?? 'local',
    deployedCommit: (e.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || 'n/a',
    settings: {
      sheetsUrlSet: Boolean(e.SHEETS_API_URL),
      sheetsTokenSet: Boolean(e.SHEETS_API_TOKEN),
    },
    sheet: await sheetSelfTest(),
  };

  return new Response(JSON.stringify(report, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
