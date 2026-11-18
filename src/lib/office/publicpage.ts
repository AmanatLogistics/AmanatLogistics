/**
 * The shipment page the invoice's QR code opens (/t/<code>), for the shipper,
 * the receiver, or anyone holding the invoice. No login: the code in the
 * address is 128 random bits, so the page can only be reached from the QR
 * code or the link we give out, and an admin can make a new code (the old
 * one stops working) or turn the page off.
 *
 * Only what the invoice itself already says goes on it: status, route,
 * contents, shipper and receiver, weights, the billed lines and what is still
 * due. Never costs, partners, profit or internal notes.
 */
import { one, q } from './db';
import { shipmentFigures, type ShipmentFigures } from './ledger';
import { invoiceStatus, type InvoiceStatus } from './invoices';
import { TOKEN_RE, shipmentItems, type ItemLine } from './shipments';
import { SITE } from '../../consts';
import type { ServiceKey } from './services';
import type { ShipmentStatus } from './services';

export interface PublicShipment {
  ref: string;
  service: ServiceKey;
  status: ShipmentStatus;
  ship_date: string;
  origin: string | null;
  destination: string | null;
  goods: string | null;
  pieces: number | null;
  weight_kg: number | null;
  chargeable_kg: number | null;
  cbm: number | null;
  awb_no: string | null;
  tracking_no: string | null;
  updated_at: string;
  shipper: { name: string; phone: string | null; address: string | null } | null;
  consignee: { name: string | null; phone: string | null; address: string | null };
  items: ItemLine[];
  charges: { description: string; qty: number | null; unit: string | null; rate: number | null; amount: number; currency: string; usd: number }[];
  invoice: { number: string; issue_date: string; due_date: string | null; status: InvoiceStatus } | null;
  fig: ShipmentFigures;
}

/** The page's address. Printed invoices always point at the live site; a local copy at itself. */
export function publicShipmentUrl(token: string, requestUrl: URL): string {
  const base = import.meta.env.DEV ? requestUrl.origin : SITE.domain;
  return `${base}/t/${token}`;
}

export async function publicShipment(token: string, todayStr: string): Promise<PublicShipment | null> {
  if (!TOKEN_RE.test(token)) return null;
  const s = await one<{
    id: number; ref: string; service: ServiceKey; status: ShipmentStatus; ship_date: string; origin: string | null; destination: string | null;
    goods: string | null; pieces: number | null; weight_kg: number | null; chargeable_kg: number | null; cbm: number | null; awb_no: string | null;
    tracking_no: string | null; updated_at: string; bill_address: string | null; consignee_name: string | null; consignee_phone: string | null;
    consignee_address: string | null; c_name: string | null; c_phone: string | null; c_address: string | null; c_city: string | null; c_country: string | null;
    inv_number: string | null; inv_issue: string | null; inv_due: string | null;
  }>(
    `SELECT s.id, s.ref, s.service, s.status, s.ship_date, s.origin, s.destination, s.goods, s.pieces, s.weight_kg, s.chargeable_kg, s.cbm,
            s.awb_no, s.tracking_no, s.updated_at, s.bill_address, s.consignee_name, s.consignee_phone, s.consignee_address,
            p.name AS c_name, p.phone AS c_phone, p.address AS c_address, p.city AS c_city, p.country AS c_country,
            i.number AS inv_number, i.issue_date AS inv_issue, i.due_date AS inv_due
       FROM office_shipments s
       LEFT JOIN office_parties p ON p.id = s.client_id
       LEFT JOIN office_invoices i ON i.shipment_id = s.id
      WHERE s.public_token = $1`,
    [token],
  );
  if (!s) return null;
  const [items, charges, figs] = await Promise.all([
    shipmentItems(s.id),
    q<PublicShipment['charges'][number]>('SELECT description, qty, unit, rate, amount, currency, usd FROM office_charges WHERE shipment_id = $1 ORDER BY sort, id', [s.id]),
    shipmentFigures([s.id]),
  ]);
  const fig = figs.get(s.id) ?? { revenue: 0, cost: 0, profit: 0, received: 0, applied: 0, due: 0 };
  return {
    ref: s.ref,
    service: s.service,
    status: s.status,
    ship_date: s.ship_date,
    origin: s.origin,
    destination: s.destination,
    goods: s.goods,
    pieces: s.pieces,
    weight_kg: s.weight_kg,
    chargeable_kg: s.chargeable_kg,
    cbm: s.cbm,
    awb_no: s.awb_no,
    tracking_no: s.tracking_no,
    updated_at: s.updated_at,
    // The same address the invoice prints under the client's name.
    shipper: s.c_name
      ? { name: s.c_name, phone: s.c_phone, address: s.bill_address || s.c_address || [s.c_city, s.c_country].filter(Boolean).join(', ') || null }
      : null,
    consignee: { name: s.consignee_name, phone: s.consignee_phone, address: s.consignee_address },
    items,
    charges,
    invoice: s.inv_number ? { number: s.inv_number, issue_date: s.inv_issue!, due_date: s.inv_due, status: invoiceStatus(fig.revenue, fig.received, s.inv_due, todayStr) } : null,
    // Cost and profit are ours, not the customer's.
    fig: { ...fig, cost: 0, profit: 0 },
  };
}
