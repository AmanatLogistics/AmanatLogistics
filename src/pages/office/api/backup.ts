/**
 * Called once a day by Vercel's scheduler (vercel.json → crons). Sends the
 * backup when the last one is older than Settings → "Every … days".
 *
 * Safe to leave open: a call can only send a backup that is already due, to
 * the recipients saved in Settings, at most once every few hours, and the
 * answer says what happened, never any of the data. When CRON_SECRET is set
 * on Vercel, Vercel's scheduler sends it ("Authorization: Bearer …") and any
 * other caller is refused.
 */
import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../../../lib/store';
import { runBackup } from '../../../lib/office/delivery';

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

function allowed(request: Request): boolean {
  const secret = env('CRON_SECRET');
  if (!secret) return true;
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
    });
  } catch (e) {
    console.error('Backup failed:', e);
    return json({ ok: false, error: 'The backup could not be built — see the function logs.' }, 500);
  }
};

// Vercel's newer "Schedules" call a path with POST unless told otherwise.
export const POST = GET;
