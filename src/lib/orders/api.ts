/**
 * Orders section — the Google Sheets backend.
 *
 * Reads the SHIPMENTS sheet of the Amanat Shipment Control Tracker through a
 * Google Apps Script web app (google-apps-script/orders-api.gs). Every call
 * goes out from the Astro server, never the browser, so the shared token stays
 * server-side.
 *
 * Nothing here touches Postgres: the shipment tracker keeps its own database,
 * and this section keeps the sheet.
 */
import { env } from '../store';

export const SHEETS_NOT_CONFIGURED =
  'Google Sheets is not connected yet. Deploy google-apps-script/orders-api.gs as a web app, then set SHEETS_API_URL and SHEETS_API_TOKEN.';

/** One row of SHIPMENTS, as the Apps Script hands it over. */
export interface SheetOrder {
  /** Sheet row number — the record's id for editing. */
  row: number;
  order_id: string;
  invoice_number: string;
  tracking_number: string;
  invoice_date: string;
  commodity: string;
  cartons: string;
  gross_weight: string;
  kdr_plate: string;
  tas_plate: string;
  awb_no: string;
  flight_no: string;
  flight_date: string;
  /** The sheet's own status wording, when it has one. */
  current_status: string;
  /** Fourteen entries, 'YYYY-MM-DD' or ''. */
  stage_dates: string[];
  /** Highest stage with a date; 0 means booked only. */
  stage: number;
}

export interface OrdersResult {
  orders: SheetOrder[];
  /** False when the sheet has no Tracking No column to keep codes in. */
  trackingColumn: boolean;
}

export function apiUrl(): string | undefined {
  return env('SHEETS_API_URL');
}

export function isConfigured(): boolean {
  return Boolean(apiUrl() && env('SHEETS_API_TOKEN'));
}

/** Apps Script answers a 302 to googleusercontent, so redirects must be followed. */
async function call(params: Record<string, string>): Promise<any> {
  const base = apiUrl();
  const token = env('SHEETS_API_TOKEN');
  if (!base || !token) throw new Error(SHEETS_NOT_CONFIGURED);

  const url = new URL(base);
  url.searchParams.set('token', token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Sheets API returned ${response.status}.`);

  const body = await response.text();
  let data: any;
  try {
    data = JSON.parse(body);
  } catch {
    // A misconfigured deployment answers with Google's HTML sign-in page.
    throw new Error('Sheets API did not return JSON. Check the deployment is set to "Anyone".');
  }
  if (data?.error) throw new Error(String(data.error));
  return data;
}

export async function listOrders(): Promise<OrdersResult> {
  const data = await call({ action: 'list' });
  return {
    orders: Array.isArray(data.orders) ? data.orders.map(normalise) : [],
    trackingColumn: data.trackingColumn !== false,
  };
}

/** One shipment by tracking number or ACCI invoice number. */
export async function findOrder(code: string): Promise<SheetOrder | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const data = await call({ action: 'find', code: trimmed });
  return data.order ? normalise(data.order) : null;
}

/** One shipment by its sheet row, for the edit form. */
export async function findOrderById(id: string): Promise<SheetOrder | null> {
  const wanted = id.trim();
  if (!wanted) return null;
  const { orders } = await listOrders();
  return orders.find((o) => o.order_id === wanted) ?? null;
}

export async function updateOrder(id: string, fields: Record<string, string>): Promise<void> {
  const base = apiUrl();
  const token = env('SHEETS_API_TOKEN');
  if (!base || !token) throw new Error(SHEETS_NOT_CONFIGURED);

  const response = await fetch(base, {
    method: 'POST',
    redirect: 'follow',
    // text/plain keeps this a CORS "simple" request, which Apps Script accepts
    // without a preflight it would answer with a redirect.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token, action: 'update', id, fields }),
  });
  if (!response.ok) throw new Error(`Sheets API returned ${response.status}.`);

  const data = JSON.parse(await response.text());
  if (data?.error) throw new Error(String(data.error));
}

/** Fill in anything the sheet left out, so the pages never see undefined. */
function normalise(raw: any): SheetOrder {
  const text = (v: unknown) => (v == null ? '' : String(v));
  const stageDates: string[] = Array.isArray(raw?.stage_dates) ? raw.stage_dates.map(text) : [];
  while (stageDates.length < 14) stageDates.push('');

  return {
    row: Number(raw?.row) || 0,
    order_id: text(raw?.order_id),
    invoice_number: text(raw?.invoice_number),
    tracking_number: text(raw?.tracking_number),
    invoice_date: text(raw?.invoice_date),
    commodity: text(raw?.commodity),
    cartons: text(raw?.cartons),
    gross_weight: text(raw?.gross_weight),
    kdr_plate: text(raw?.kdr_plate),
    tas_plate: text(raw?.tas_plate),
    awb_no: text(raw?.awb_no),
    flight_no: text(raw?.flight_no),
    flight_date: text(raw?.flight_date),
    current_status: text(raw?.current_status),
    stage_dates: stageDates.slice(0, 14),
    stage: Math.min(14, Math.max(0, Number(raw?.stage) || 0)),
  };
}
