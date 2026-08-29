/**
 * Orders section — the Google Sheets backend.
 *
 * The sheet is the only database here; a Google Apps Script web app
 * (google-apps-script/orders-api.gs) is the API in front of it. Every call goes
 * out from the Astro server, never the browser, so the shared token stays on
 * the server side.
 *
 * Nothing here touches Postgres: the existing shipment tracker keeps its own
 * database, and this section keeps the sheet.
 */
import { env } from '../store';

export const SHEETS_NOT_CONFIGURED =
  'Google Sheets is not connected yet. Deploy google-apps-script/orders-api.gs as a web app, then set SHEETS_API_URL and SHEETS_API_TOKEN.';

export interface SheetOrder {
  row: number;
  order_id: string;
  invoice_number: string;
  tracking_number: string;
  customer_name: string;
  phone: string;
  whatsapp_number: string;
  product: string;
  quantity: string;
  weight: string;
  origin: string;
  destination: string;
  shipping_method: string;
  order_date: string;
  estimated_delivery: string;
  actual_delivery: string;
  stage: number;
  status: string;
  notes: string;
  stage_dates: string[];
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

/** Every order in the sheet, newest rows last (sheet order). */
export async function listOrders(): Promise<SheetOrder[]> {
  const data = await call({ action: 'list' });
  return Array.isArray(data.orders) ? data.orders.map(normalise) : [];
}

/** One order, by tracking number or invoice number — the tracker's own concept. */
export async function findOrder(code: string): Promise<SheetOrder | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const data = await call({ action: 'find', code: trimmed });
  return data.order ? normalise(data.order) : null;
}

/**
 * One order by its sheet id. The Apps Script has no by-id endpoint on purpose:
 * the list is a single read either way, and one fewer branch is one fewer
 * thing to keep in step.
 */
export async function findOrderById(id: string): Promise<SheetOrder | null> {
  const wanted = id.trim();
  if (!wanted) return null;
  const orders = await listOrders();
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
  while (stageDates.length < 8) stageDates.push('');

  return {
    row: Number(raw?.row) || 0,
    order_id: text(raw?.order_id),
    invoice_number: text(raw?.invoice_number),
    tracking_number: text(raw?.tracking_number),
    customer_name: text(raw?.customer_name),
    phone: text(raw?.phone),
    whatsapp_number: text(raw?.whatsapp_number),
    product: text(raw?.product),
    quantity: text(raw?.quantity),
    weight: text(raw?.weight),
    origin: text(raw?.origin),
    destination: text(raw?.destination),
    shipping_method: text(raw?.shipping_method),
    order_date: text(raw?.order_date),
    estimated_delivery: text(raw?.estimated_delivery),
    actual_delivery: text(raw?.actual_delivery),
    stage: Math.min(8, Math.max(1, Number(raw?.stage) || 1)),
    status: text(raw?.status),
    notes: text(raw?.notes),
    stage_dates: stageDates.slice(0, 8),
  };
}
