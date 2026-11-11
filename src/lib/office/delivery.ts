/**
 * Sending the backup: every few days (Settings → "Backups & reminders") the
 * Excel workbook and the restore file go by email, the workbook goes to each
 * backup WhatsApp number, and the reminder number gets the list of clients
 * who still owe us.
 *
 *   Email     Resend, the same account as the website's quote form:
 *             RESEND_API_KEY, and MAIL_FROM from a verified domain.
 *   WhatsApp  The WhatsApp Business Cloud API (Meta): WHATSAPP_TOKEN and
 *             WHATSAPP_PHONE_NUMBER_ID, plus two approved message templates
 *             (WHATSAPP_BACKUP_TEMPLATE, WHATSAPP_REMINDER_TEMPLATE). A
 *             business may only start a WhatsApp conversation with an
 *             approved template, so both messages are templates.
 *   Schedule  Vercel calls /office/api/backup once a day (vercel.json) with
 *             CRON_SECRET; it sends when the last backup is old enough.
 */
import { Resend } from 'resend';
import { env } from '../store';
import { one, q } from './db';
import { getSettings, type OfficeSettings } from './settings';
import { logActivity } from './activity';
import { buildBackup, type Backup } from './backup';
import { usd, fmtDate } from './money';

export interface SendResult {
  to: string;
  ok: boolean;
  error?: string;
}

export interface BackupReport {
  at: string;
  trigger: 'schedule' | 'manual';
  email: SendResult[];
  whatsapp: SendResult[];
  reminder: SendResult | null;
  /** Something could not be sent at all (e.g. a service not set up). */
  notes: string[];
}

export interface BackupState {
  lastSentAt: string | null;
  lastAttemptAt: string | null;
  last: BackupReport | null;
}

/* ---------- recipients ---------- */

/** "+93 70 280 0277", "0702800277" → "93702800277". A lone leading 0 is Afghanistan. */
export function normalizePhone(v: string): string | null {
  let d = v.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (/^0\d{9}$/.test(d)) d = '93' + d.slice(1);
  d = d.replace(/\D/g, '');
  return /^\d{8,15}$/.test(d) ? d : null;
}

export const isEmail = (v: string) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(v);

/** "+93 70 009 8848" for showing a stored number. */
export function showPhone(d: string): string {
  return d.startsWith('93') && d.length === 11 ? `+93 ${d.slice(2, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : `+${d}`;
}

/* ---------- which services are set up ---------- */

export function channels() {
  return {
    email: Boolean(env('RESEND_API_KEY')),
    emailFrom: env('MAIL_FROM') || null,
    whatsapp: Boolean(env('WHATSAPP_TOKEN') && env('WHATSAPP_PHONE_NUMBER_ID')),
    schedule: Boolean(env('CRON_SECRET')),
    backupTemplate: env('WHATSAPP_BACKUP_TEMPLATE') || 'office_backup',
    reminderTemplate: env('WHATSAPP_REMINDER_TEMPLATE') || 'unpaid_reminder',
  };
}

/* ---------- state ---------- */

export async function backupState(): Promise<BackupState> {
  const row = await one<{ value: Partial<BackupState> }>("SELECT value FROM office_settings WHERE key = 'backup'");
  return { lastSentAt: null, lastAttemptAt: null, last: null, ...(row?.value ?? {}) };
}

/** When the next scheduled backup goes out (null: as soon as the schedule runs). */
export function nextDue(state: BackupState, s: OfficeSettings): Date | null {
  if (!state.lastSentAt) return null;
  return new Date(new Date(state.lastSentAt).getTime() + s.backupEveryDays * 86_400_000);
}

/**
 * Take the job, so two calls at the same moment do not send twice. A claim
 * older than ten minutes is from a run that died, and is taken over.
 */
async function claim(): Promise<boolean> {
  const r = await one<{ key: string }>(
    `INSERT INTO office_settings (key, value) VALUES ('backup', jsonb_build_object('claimedAt', now()))
     ON CONFLICT (key) DO UPDATE SET value = office_settings.value || jsonb_build_object('claimedAt', now())
      WHERE office_settings.value->>'claimedAt' IS NULL
         OR (office_settings.value->>'claimedAt')::timestamptz < now() - interval '10 minutes'
     RETURNING key`,
  );
  return Boolean(r);
}

async function release(patch: Partial<BackupState>): Promise<void> {
  await q(
    `UPDATE office_settings SET value = (value - 'claimedAt') || $1::jsonb WHERE key = 'backup'`,
    [JSON.stringify(patch)],
  );
}

/* ---------- email ---------- */

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function emailHtml(b: Backup, s: OfficeSettings): string {
  const top = b.debtors.slice(0, 40);
  const row = (k: string, v: string) => `<tr><td style="padding:6px 12px;color:#6c5f65">${escHtml(k)}</td><td style="padding:6px 12px;text-align:right;font-weight:700">${escHtml(v)}</td></tr>`;
  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#f4f1f2;padding:20px">
  <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #e6dde1;border-radius:10px;overflow:hidden">
    <div style="background:#7e2e47;color:#fff;padding:18px 22px"><div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.8">${escHtml(s.companyName)} — office backup</div><div style="font-size:20px;font-weight:700;margin-top:4px">${escHtml(fmtDate(b.date))}</div></div>
    <div style="padding:16px 22px;font-size:14px;color:#1f1419">
      <p style="margin:0 0 12px">Attached: <strong>the Excel file</strong> with every shipment, invoice, payment and expense, and <strong>the restore file</strong>. If the office ever loses its data, open Import → “Import everything at once” and choose the restore file.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${row('Shipments', String(b.counts.shipments))}${row('Payments', String(b.counts.payments))}${row('Clients owe us', usd(b.debtors.reduce((a, d) => a + d.owes, 0)))}${row('We owe partners', usd(b.totals.payable))}${row('We hold for clients', usd(b.totals.clientCredit))}${row('Net profit (all time)', usd(b.totals.netProfit))}
      </table>
      ${
        top.length
          ? `<h3 style="font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:#7e2e47;margin:18px 0 6px">Clients who still owe us</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px">${top.map((d) => `<tr><td style="padding:5px 12px;border-bottom:1px solid #f0e9ec">${escHtml(d.name)}${d.phone ? ` <span style="color:#6c5f65">${escHtml(d.phone)}</span>` : ''}</td><td style="padding:5px 12px;border-bottom:1px solid #f0e9ec;text-align:right;font-weight:700">${escHtml(usd(d.owes))}</td></tr>`).join('')}</table>${b.debtors.length > top.length ? `<p style="color:#6c5f65;font-size:13px">…and ${b.debtors.length - top.length} more in the Excel file (sheet “Unpaid clients”).</p>` : ''}`
          : '<p>No client owes us anything.</p>'
      }
    </div>
  </div>
</div>`;
}

async function sendEmails(b: Backup, s: OfficeSettings, files: { xlsxName: string; csvName: string }): Promise<SendResult[]> {
  const to = s.backupEmails.filter(isEmail);
  if (!to.length) return [];
  const key = env('RESEND_API_KEY');
  if (!key) return to.map((t) => ({ to: t, ok: false, error: 'Email is not set up (RESEND_API_KEY missing on Vercel).' }));
  const resend = new Resend(key);
  const from = env('MAIL_FROM') || 'Amanat Logistics <onboarding@resend.dev>';
  // One email each, so one bad address does not stop the others.
  const results: SendResult[] = [];
  for (const t of to) {
    try {
      const { error } = await resend.emails.send({
        from,
        to: [t],
        subject: `${s.companyName} — office backup ${fmtDate(b.date)}`,
        html: emailHtml(b, s),
        attachments: [
          { filename: files.xlsxName, content: b.xlsx },
          { filename: files.csvName, content: Buffer.from(b.restoreCsv, 'utf8') },
        ],
      });
      results.push(error ? { to: t, ok: false, error: error.message } : { to: t, ok: true });
    } catch (e) {
      results.push({ to: t, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}

/* ---------- WhatsApp (Cloud API) ---------- */

// WHATSAPP_GRAPH_URL only points the office at a test server instead of Meta's.
const graph = () => `${env('WHATSAPP_GRAPH_URL') || 'https://graph.facebook.com'}/${env('WHATSAPP_API_VERSION') || 'v23.0'}/${env('WHATSAPP_PHONE_NUMBER_ID')}`;
const auth = () => ({ Authorization: `Bearer ${env('WHATSAPP_TOKEN')}` });

async function graphError(r: Response): Promise<string> {
  const j = (await r.json().catch(() => null)) as { error?: { message?: string; error_data?: { details?: string } } } | null;
  return j?.error?.error_data?.details || j?.error?.message || `HTTP ${r.status}`;
}

/** A template text value: one line, no tabs, no runs of spaces, at most `max` characters. */
const oneLine = (s: string, max = 900) => {
  const t = s.replace(/[\r\n\t]+/g, ' · ').replace(/ {4,}/g, '   ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};

async function uploadMedia(file: Buffer, filename: string, mime: string): Promise<string> {
  const fd = new FormData();
  fd.append('messaging_product', 'whatsapp');
  fd.append('type', mime);
  fd.append('file', new Blob([new Uint8Array(file)], { type: mime }), filename);
  const r = await fetch(`${graph()}/media`, { method: 'POST', headers: auth(), body: fd });
  if (!r.ok) throw new Error(`Could not upload the file to WhatsApp: ${await graphError(r)}`);
  return ((await r.json()) as { id: string }).id;
}

async function sendTemplate(to: string, name: string, components: unknown[]): Promise<SendResult> {
  try {
    const r = await fetch(`${graph()}/messages`, {
      method: 'POST',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: { name, language: { code: env('WHATSAPP_TEMPLATE_LANG') || 'en' }, components },
      }),
    });
    return r.ok ? { to, ok: true } : { to, ok: false, error: await graphError(r) };
  } catch (e) {
    return { to, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** "Najib Amin $8,386.76 · Rahmat Nazar Ltd $23,656.35 · …", as many as fit. */
export function debtorLine(b: Backup, max = 700): string {
  const parts: string[] = [];
  let len = 0;
  for (const d of b.debtors) {
    const p = `${d.name} ${usd(d.owes)}`;
    if (len + p.length + 3 > max) {
      parts.push(`and ${b.debtors.length - parts.length} more (see the Excel file)`);
      break;
    }
    parts.push(p);
    len += p.length + 3;
  }
  return parts.join(' · ');
}

/* ---------- the run ---------- */

/**
 * Build the backup and send it. `force` sends even if the last one is recent
 * (the "Send backup now" button); the daily schedule passes false.
 */
export async function runBackup(opts: { force: boolean; trigger: 'schedule' | 'manual'; userId: number | null }): Promise<{ skipped: string } | { report: BackupReport }> {
  const s = await getSettings();
  const state = await backupState();
  if (!opts.force) {
    const due = nextDue(state, s);
    // Three hours early is still on time: the daily schedule fires at about the same hour.
    if (due && due.getTime() - Date.now() > 3 * 3_600_000) return { skipped: `Not due until ${due.toISOString()}.` };
  }
  if (!(await claim())) return { skipped: 'A backup is being sent right now.' };
  const at = new Date().toISOString();
  const notes: string[] = [];
  try {
    const b = await buildBackup();
    const xlsxName = `amanat-office-backup-${b.date}.xlsx`;
    const csvName = `amanat-office-restore-${b.date}.csv`;
    const email = await sendEmails(b, s, { xlsxName, csvName });
    if (!s.backupEmails.length) notes.push('No email address is set for backups.');

    let whatsapp: SendResult[] = [];
    let reminder: SendResult | null = null;
    const ch = channels();
    const waTo = s.backupWhatsapp;
    if ((waTo.length || s.reminderWhatsapp) && !ch.whatsapp) {
      notes.push('WhatsApp is not set up (WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID missing on Vercel).');
      whatsapp = waTo.map((t) => ({ to: t, ok: false, error: 'WhatsApp is not set up.' }));
      if (s.reminderWhatsapp) reminder = { to: s.reminderWhatsapp, ok: false, error: 'WhatsApp is not set up.' };
    } else if (ch.whatsapp) {
      if (waTo.length) {
        try {
          const media = await uploadMedia(b.xlsx, xlsxName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          const summary = oneLine(`${b.counts.shipments} shipments, ${b.counts.payments} payments; clients owe us ${usd(b.debtors.reduce((a, d) => a + d.owes, 0))}`);
          for (const t of waTo) {
            whatsapp.push(
              await sendTemplate(t, ch.backupTemplate, [
                { type: 'header', parameters: [{ type: 'document', document: { id: media, filename: xlsxName } }] },
                { type: 'body', parameters: [{ type: 'text', text: fmtDate(b.date) }, { type: 'text', text: summary }] },
              ]),
            );
          }
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          whatsapp = waTo.map((t) => ({ to: t, ok: false, error }));
        }
      }
      if (s.reminderWhatsapp) {
        const total = b.debtors.reduce((a, d) => a + d.owes, 0);
        reminder = await sendTemplate(s.reminderWhatsapp, ch.reminderTemplate, [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: String(b.debtors.length) },
              { type: 'text', text: usd(total) },
              { type: 'text', text: oneLine(b.debtors.length ? debtorLine(b) : 'Nobody owes us anything.') },
            ],
          },
        ]);
      }
    }

    const report: BackupReport = { at, trigger: opts.trigger, email, whatsapp, reminder, notes };
    const anyOk = [...email, ...whatsapp].some((r) => r.ok);
    await release({ lastAttemptAt: at, last: report, ...(anyOk ? { lastSentAt: at } : {}) });
    const count = (rs: SendResult[]) => `${rs.filter((r) => r.ok).length}/${rs.length}`;
    await logActivity(
      opts.userId,
      anyOk ? 'backup_sent' : 'backup_failed',
      'backup',
      null,
      `${opts.trigger === 'manual' ? 'Sent by hand' : 'Scheduled'}: email ${count(email)}, WhatsApp ${count(whatsapp)}, reminder ${reminder ? (reminder.ok ? 'sent' : 'not sent') : 'none'}`,
    );
    return { report };
  } catch (e) {
    await release({ lastAttemptAt: at }).catch(() => {});
    throw e;
  }
}
