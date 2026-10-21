/**
 * Office settings — the letterhead and terms printed on invoices, and the
 * numbering prefixes. Stored as one JSON row; defaults fill anything unset.
 */
import { one, q, type Runner } from './db';
import { nextNumber } from './activity';
import { CONTACT, SITE } from '../../consts';

export interface OfficeSettings {
  companyName: string;
  companyTagline: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  /** Printed under the totals on every invoice. */
  paymentInstructions: string;
  /** Printed at the foot of every invoice. */
  invoiceFooter: string;
  invoicePrefix: string;
  shipmentPrefix: string;
  /** Days from issue to due date. */
  dueDays: number;
}

export const DEFAULT_SETTINGS: OfficeSettings = {
  companyName: SITE.name,
  companyTagline: 'Freight, customs & logistics — Kandahar, Afghanistan',
  address: CONTACT.location,
  phone: CONTACT.phoneExport,
  email: CONTACT.email,
  website: 'amanatlogistics.com',
  paymentInstructions: 'Payment in cash, by hawala or by bank transfer. Please quote the invoice number.',
  invoiceFooter: 'Thank you for shipping with Amanat Logistics.',
  invoicePrefix: 'INV',
  shipmentPrefix: 'AML',
  dueDays: 15,
};

export async function getSettings(): Promise<OfficeSettings> {
  const row = await one<{ value: Partial<OfficeSettings> }>("SELECT value FROM office_settings WHERE key = 'office'");
  return { ...DEFAULT_SETTINGS, ...(row?.value ?? {}) };
}

export async function saveSettings(patch: Partial<OfficeSettings>): Promise<void> {
  const current = await getSettings();
  await q(
    `INSERT INTO office_settings (key, value) VALUES ('office', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify({ ...current, ...patch })],
  );
}

/**
 * AML-2026-0001 — per-year sequence, never reused. Skips any number already
 * taken (e.g. by imported old records that kept their own references).
 */
export async function nextShipmentRef(year: number, runner?: Runner): Promise<string> {
  const s = await getSettings();
  for (let i = 0; i < 1000; i++) {
    const n = await nextNumber(`shipment-${year}`, runner);
    const ref = `${s.shipmentPrefix}-${year}-${String(n).padStart(4, '0')}`;
    if (!(await one('SELECT 1 FROM office_shipments WHERE ref = $1', [ref], runner))) return ref;
  }
  throw new Error('Could not find a free shipment number.');
}

/** INV-2026-0001 — per-year sequence, never reused; skips numbers already taken. */
export async function nextInvoiceNumber(year: number, runner?: Runner): Promise<string> {
  const s = await getSettings();
  for (let i = 0; i < 1000; i++) {
    const n = await nextNumber(`invoice-${year}`, runner);
    const number = `${s.invoicePrefix}-${year}-${String(n).padStart(4, '0')}`;
    if (!(await one('SELECT 1 FROM office_invoices WHERE number = $1', [number], runner))) return number;
  }
  throw new Error('Could not find a free invoice number.');
}
