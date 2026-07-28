import type { APIRoute } from 'astro';
import { isAdmin } from '../../../lib/auth';
import { blobToken } from '../../../lib/store';

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
  const blobLike = Object.keys(e).filter((k) => /BLOB/i.test(k));

  return new Response(
    JSON.stringify(
      {
        runningOnVercel: Boolean(e.VERCEL),
        environment: e.VERCEL_ENV ?? 'local',
        deployedCommit: (e.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || 'n/a',
        storage: {
          blobStoreConnected: Boolean(e.BLOB_STORE_ID),
          blobTokenFound: Boolean(blobToken()),
          // On Vercel the SDK signs requests with OIDC when no static token exists.
          authMode: blobToken() ? 'static token' : e.BLOB_STORE_ID ? 'OIDC (automatic)' : 'none',
          blobVariableNames: blobLike, // names only, never values
          savingWillWork: Boolean(blobToken() || e.BLOB_STORE_ID) || !e.VERCEL,
        },
        otherSettings: {
          adminPasswordSet: Boolean(e.ADMIN_PASSWORD),
          resendKeySet: Boolean(e.RESEND_API_KEY),
        },
      },
      null,
      2,
    ),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
};
