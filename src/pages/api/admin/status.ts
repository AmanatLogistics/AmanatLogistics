import type { APIRoute } from 'astro';
import { isAdmin } from '../../../lib/auth';
import { storageSelfTest } from '../../../lib/store';

export const prerender = false;

/**
 * Admin-only diagnostics: shows what the LIVE server can actually see.
 * Never returns secret values — only whether each one is present.
 */
export const GET: APIRoute = async ({ request }) => {
  if (!(await isAdmin(request))) {
    return new Response(JSON.stringify({ error: 'Not authorized.' }), { status: 401 });
  }

  const e = process.env ?? {};
  // ?test=1 actually writes to storage and reads it back, so a save that is
  // failing says why instead of only reporting what is configured — the
  // difference that took a suspended store a long time to find. Off by
  // default, because it is a real write.
  const url = new URL(request.url);
  const selfTest = url.searchParams.get('test') === '1' ? await storageSelfTest() : undefined;

  const dbUrl = Boolean(e.DATABASE_URL || e.POSTGRES_URL);

  return new Response(
    JSON.stringify(
      {
        runningOnVercel: Boolean(e.VERCEL),
        environment: e.VERCEL_ENV ?? 'local',
        deployedCommit: (e.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || 'n/a',
        storage: {
          backend: dbUrl ? 'Neon Postgres' : e.VERCEL ? 'none' : 'local files',
          databaseConnected: dbUrl,
          // Names only, never values.
          databaseVariableNames: Object.keys(e).filter((k) => /^(DATABASE|POSTGRES)_URL$/.test(k)),
          savingWillWork: dbUrl || !e.VERCEL,
          // Only present when called with ?test=1.
          ...(selfTest ? { writeTest: selfTest } : {}),
        },
        otherSettings: {
          adminPasswordSet: Boolean(e.ADMIN_PASSWORD),
          resendKeySet: Boolean(e.RESEND_API_KEY),
          trackerPasswordSet: Boolean(e.TRACKER_ADMIN_PASSWORD),
          ordersPasswordSet: Boolean(e.ORDERS_ADMIN_PASSWORD),
          sheetsApiSet: Boolean(e.SHEETS_API_URL && e.SHEETS_API_TOKEN),
        },
      },
      null,
      2,
    ),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};
