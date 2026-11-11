/**
 * Called once a day by Vercel's scheduler (vercel.json → crons). Sends the
 * backup when the last one is older than Settings → "Every … days".
 *
 * Only Vercel's scheduler can call it: it sends "Authorization: Bearer
 * <CRON_SECRET>", and without CRON_SECRET set nothing runs. The answer says
 * what happened, never any of the data.
 */
import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../../../lib/store';
import { runBackup } from '../../../lib/office/delivery';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function allowed(request: Request): boolean {
  const secret = env('CRON_SECRET');
  if (!secret || secret.length < 16) return false;
  const got = Buffer.from(request.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export const GET: APIRoute = async ({ request }) => {
  if (!allowed(request)) return json({ error: 'Forbidden' }, 403);
  try {
    const r = await runBackup({ force: false, trigger: 'schedule', userId: null });
    if ('skipped' in r) return json({ ok: true, skipped: r.skipped });
    const sent = (xs: { ok: boolean }[]) => xs.filter((x) => x.ok).length;
    return json({
      ok: true,
      email: `${sent(r.report.email)}/${r.report.email.length}`,
      whatsapp: `${sent(r.report.whatsapp)}/${r.report.whatsapp.length}`,
      reminder: r.report.reminder ? r.report.reminder.ok : null,
      notes: r.report.notes,
    });
  } catch (e) {
    console.error('Backup failed:', e);
    return json({ ok: false, error: 'The backup could not be built — see the function logs.' }, 500);
  }
};

// Vercel's newer "Schedules" call a path with POST unless told otherwise.
export const POST = GET;
