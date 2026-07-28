import type { APIRoute } from 'astro';
import { Resend } from 'resend';
import { env, getContent } from '../../lib/store';

// On-demand (server) route.
export const prerender = false;

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const POST: APIRoute = async ({ request }) => {
  let data: Record<string, string>;
  try {
    data = await request.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }

  // Honeypot: bots fill hidden fields; humans never see it.
  if (data.website) return json({ ok: true });

  const name = (data.name || '').trim();
  const email = (data.email || '').trim();

  if (!name || !email) {
    return json({ error: 'Please provide at least your name and email.' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Please enter a valid email address.' }, 400);
  }

  const apiKey = env('RESEND_API_KEY');
  if (!apiKey) {
    console.error('RESEND_API_KEY is not set.');
    return json({ error: 'Email service not configured yet. Please email info@amanatlogistics.com directly.' }, 500);
  }

  const resend = new Resend(apiKey);

  // Until your domain is verified in Resend, MAIL_FROM falls back to Resend's
  // sandbox sender (which only delivers to the Resend account owner).
  const from = env('MAIL_FROM') || 'Amanat Logistics <onboarding@resend.dev>';
  const to = env('MAIL_TO') || (await getContent()).contact.email || 'info@amanatlogistics.com';

  const fields: Array<[string, string]> = [
    ['Name', name],
    ['Company / Organization', data.company || '—'],
    ['Email', email],
    ['Phone', data.phone || '—'],
    ['Service', data.service || '—'],
    ['Departure', data.departure || '—'],
    ['Destination Country', data.destination || '—'],
    ['Product & Est. Weight', data.product || '—'],
    ['Message', data.message || '—'],
  ];

  const rows = fields
    .map(
      ([k, v]) =>
        `<tr><td style="padding:8px 14px;border-bottom:1px solid #E2D8C6;font-weight:600;color:#5A5147;white-space:nowrap;vertical-align:top;">${k}</td><td style="padding:8px 14px;border-bottom:1px solid #E2D8C6;color:#2B2621;">${escapeHtml(v)}</td></tr>`,
    )
    .join('');

  const internalHtml = `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#F6F1E8;padding:24px;">
      <div style="max-width:620px;margin:0 auto;background:#FDFBF6;border:1px solid #E2D8C6;border-radius:12px;overflow:hidden;">
        <div style="background:#3D2233;padding:22px 24px;">
          <div style="color:#D6B676;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;">New Quote Request</div>
          <div style="color:#F8F3E9;font-size:20px;font-weight:700;margin-top:4px;">Amanat Logistics — Website</div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">${rows}</table>
        <div style="padding:16px 24px;color:#8C6D3F;font-size:12px;">Reply directly to this email to respond to ${escapeHtml(name)}.</div>
      </div>
    </div>`;

  const customerHtml = `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#F6F1E8;padding:24px;">
      <div style="max-width:560px;margin:0 auto;background:#FDFBF6;border:1px solid #E2D8C6;border-radius:12px;padding:32px;">
        <div style="color:#8C6D3F;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;">Amanat Logistics</div>
        <h1 style="font-size:22px;color:#3D2233;margin:8px 0 16px;">Thank you, ${escapeHtml(name)}.</h1>
        <p style="font-size:15px;line-height:1.65;color:#5A5147;margin:0 0 14px;">
          We've received your request and will reply within one business day with routing, pricing, and timelines.
        </p>
        <p style="font-size:15px;line-height:1.65;color:#5A5147;margin:0 0 20px;">
          For anything urgent, call us:<br/>
          Export &amp; Freight — +93 70 009 8848<br/>
          Personal Shopping — +93 70 684 0090
        </p>
        <p style="font-size:13px;color:#8C6D3F;margin:0;">Premium figs &amp; dry fruits, from Kandahar to the world.</p>
      </div>
    </div>`;

  try {
    const { error } = await resend.emails.send({
      from,
      to: [to],
      replyTo: email,
      subject: `New quote request — ${name}${data.service ? ` (${data.service})` : ''}`,
      html: internalHtml,
    });

    if (error) {
      console.error('Resend error:', error);
      return json({ error: 'Could not send right now. Please email info@amanatlogistics.com directly.' }, 502);
    }

    // Auto-reply to the customer (best-effort — never blocks the main send).
    try {
      await resend.emails.send({
        from,
        to: [email],
        subject: 'We received your request — Amanat Logistics',
        html: customerHtml,
      });
    } catch (e) {
      console.error('Auto-reply failed (non-fatal):', e);
    }

    return json({ ok: true });
  } catch (e) {
    console.error('Send failed:', e);
    return json({ error: 'Could not send right now. Please email info@amanatlogistics.com directly.' }, 502);
  }
};
