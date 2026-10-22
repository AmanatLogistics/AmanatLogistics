/**
 * Invoices are created automatically: the moment a shipment has at least one
 * charge, it gets an invoice number. The invoice's lines ARE the shipment's
 * charges (office_charges), so editing a charge updates the invoice and the
 * two can never disagree. Payment status comes from the ledger.
 */
import { one, q, type Runner } from './db';
import { nextInvoiceNumber, getSettings } from './settings';
import { logActivity } from './activity';

export interface InvoiceRow {
  id: number;
  number: string;
  shipment_id: number;
  issue_date: string;
  due_date: string | null;
  notes: string | null;
}

/** Give a shipment its invoice if it has charges and none yet. Returns the invoice or null. */
export async function ensureInvoice(shipmentId: number, userId: number | null, runner?: Runner): Promise<InvoiceRow | null> {
  const existing = await one<InvoiceRow>('SELECT * FROM office_invoices WHERE shipment_id = $1', [shipmentId], runner);
  if (existing) return existing;
  const s = await one<{ ship_date: string; charges: number }>(
    `SELECT s.ship_date, (SELECT COUNT(*) FROM office_charges c WHERE c.shipment_id = s.id) AS charges
       FROM office_shipments s WHERE s.id = $1`,
    [shipmentId],
    runner,
  );
  if (!s || s.charges === 0) return null;
  const settings = await getSettings(runner);
  const year = Number(s.ship_date.slice(0, 4));
  const number = await nextInvoiceNumber(year, runner);
  const inv = await one<InvoiceRow>(
    `INSERT INTO office_invoices (number, shipment_id, issue_date, due_date)
     VALUES ($1, $2, $3::date, $3::date + $4::int)
     ON CONFLICT (shipment_id) DO NOTHING
     RETURNING *`,
    [number, shipmentId, s.ship_date, settings.dueDays],
    runner,
  );
  if (inv) await logActivity(userId, 'invoice_created', 'invoice', inv.id, number, runner);
  return inv ?? (await one<InvoiceRow>('SELECT * FROM office_invoices WHERE shipment_id = $1', [shipmentId], runner));
}

export type InvoiceStatus = 'paid' | 'partial' | 'unpaid' | 'overdue' | 'credit';

/**
 * A remainder smaller than this, either way, counts as settled. A client who
 * pays a dollar bill in afghanis leaves a few cents of exchange rounding
 * behind; that is not an unpaid invoice and must not sit in the overdue list.
 * (Balances still show the exact cents.)
 */
export const SETTLED_WITHIN_USD = 1;

/** Status from the amount billed, the amount received and the due date. */
export function invoiceStatus(revenue: number, received: number, dueDate: string | null, todayStr: string): InvoiceStatus {
  const due = Math.round((revenue - received) * 100) / 100;
  if (revenue > 0 && Math.abs(due) < SETTLED_WITHIN_USD) return 'paid';
  if (due < 0) return 'credit';
  if (dueDate && dueDate < todayStr && due > 0) return 'overdue';
  if (received > 0) return 'partial';
  return 'unpaid';
}

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  paid: 'Paid',
  partial: 'Part paid',
  unpaid: 'Unpaid',
  overdue: 'Overdue',
  credit: 'Overpaid',
};

export async function invoiceForShipment(shipmentId: number): Promise<InvoiceRow | null> {
  return one<InvoiceRow>('SELECT * FROM office_invoices WHERE shipment_id = $1', [shipmentId]);
}

export async function listInvoiceIds(): Promise<number[]> {
  return (await q<{ id: number }>('SELECT id FROM office_invoices ORDER BY issue_date DESC, id DESC')).map((r) => r.id);
}
