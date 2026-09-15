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
  /** Only if the sheet carries an estimated-delivery column; '' otherwise. */
  estimated_delivery: string;
  /** Stage 14's date — when it actually reached Delhi. */
  actual_delivery: string;
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
  /** Which version of orders-api.gs is actually deployed. 0 = too old to say. */
  version: number;
}

/**
 * The script version this site needs. Apps Script serves the version you last
 * deployed, so an older one keeps answering until a new deployment is made —
 * this is what lets the admin say so instead of just looking broken.
 */
export const REQUIRED_SCRIPT_VERSION = 4;

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

/**
 * Call the sheet the way listOrders does, but report what happened instead of
 * throwing.
 *
 * "Could not read the Google Sheet" covers four quite different faults — the
 * web app not deployed, its access not set to "Anyone", a token that does not
 * match, or a URL pointing at nothing — and the reason only ever reached the
 * Vercel logs. This runs the same request and hands back enough to tell which
 * one it is. Never returns the token or the full URL.
 */
export async function sheetSelfTest(): Promise<Record<string, unknown>> {
  const base = apiUrl();
  const token = env('SHEETS_API_TOKEN');

  if (!base || !token) {
    return {
      ok: false,
      reason: 'not configured',
      urlSet: Boolean(base),
      tokenSet: Boolean(token),
      fix: SHEETS_NOT_CONFIGURED,
    };
  }

  let host = '(unparseable)';
  let looksLikeAppsScript = false;
  try {
    const u = new URL(base);
    host = u.host;
    looksLikeAppsScript = u.host.endsWith('script.google.com') && u.pathname.includes('/exec');
  } catch {
    return { ok: false, reason: 'SHEETS_API_URL is not a valid URL', fix: 'Re-copy the web app URL from Apps Script (Deploy → Manage deployments).' };
  }

  const url = new URL(base);
  url.searchParams.set('token', token);
  url.searchParams.set('action', 'list');

  let response: Response;
  try {
    response = await fetch(url, { redirect: 'follow' });
  } catch (e) {
    return {
      ok: false,
      reason: 'could not reach the script at all',
      host,
      error: e instanceof Error ? e.message : String(e),
      fix: 'Check SHEETS_API_URL is the /exec web app URL, not the editor link.',
    };
  }

  const body = await response.text();
  const contentType = response.headers.get('content-type') ?? '';

  let data: any = null;
  let parsed = true;
  try {
    data = JSON.parse(body);
  } catch {
    parsed = false;
  }

  if (!parsed) {
    const signIn = /accounts\.google\.com|Sign in|ServiceLogin/i.test(body);
    return {
      ok: false,
      reason: signIn
        ? 'Google answered with a sign-in page, not the script'
        : `the script did not return JSON (HTTP ${response.status})`,
      host,
      looksLikeAppsScript,
      httpStatus: response.status,
      contentType,
      bodyStarts: body.slice(0, 180),
      fix: signIn
        ? 'In Apps Script: Deploy → Manage deployments → the pencil → "Who has access" must be Anyone (not "Anyone with a Google account"), then Deploy.'
        : 'The URL is reaching something that is not this web app. Re-copy it from Deploy → Manage deployments.',
    };
  }

  if (data?.error) {
    const unauth = String(data.error).toLowerCase().includes('unauth');
    return {
      ok: false,
      reason: `the script replied with an error: ${data.error}`,
      host,
      httpStatus: response.status,
      scriptVersion: Number(data.version) || 0,
      fix: unauth
        ? 'The token does not match. In Apps Script: Project Settings → Script Properties → the token property must equal SHEETS_API_TOKEN in Vercel, exactly.'
        : 'See the message above — it comes from orders-api.gs.',
    };
  }

  const version = Number(data?.version) || 0;
  return {
    ok: true,
    host,
    httpStatus: response.status,
    rowsReturned: Array.isArray(data?.orders) ? data.orders.length : 0,
    trackingColumn: data?.trackingColumn !== false,
    scriptVersion: version,
    scriptVersionRequired: REQUIRED_SCRIPT_VERSION,
    scriptUpToDate: version >= REQUIRED_SCRIPT_VERSION,
  };
}

export async function listOrders(): Promise<OrdersResult> {
  const data = await call({ action: 'list' });
  return {
    orders: Array.isArray(data.orders) ? data.orders.map(normalise) : [],
    trackingColumn: data.trackingColumn !== false,
    version: Number(data.version) || 0,
  };
}

/** One shipment by tracking number or ACCI invoice number. */
export async function findOrder(code: string): Promise<SheetOrder | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const data = await call({ action: 'find', code: trimmed });
  return data.order ? normalise(data.order) : null;
}

/**
 * One shipment by its sheet row, for the edit form. Carries the tracking-column
 * flag with it so the form can say whether an edited code can be saved.
 */
export async function findOrderById(
  id: string,
): Promise<{ order: SheetOrder | null; trackingColumn: boolean }> {
  const wanted = id.trim();
  const { orders, trackingColumn } = await listOrders();
  return {
    order: wanted ? (orders.find((o) => o.order_id === wanted) ?? null) : null,
    trackingColumn,
  };
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
    estimated_delivery: text(raw?.estimated_delivery),
    actual_delivery: text(raw?.actual_delivery),
    current_status: text(raw?.current_status),
    stage_dates: stageDates.slice(0, 14),
    stage: Math.min(14, Math.max(0, Number(raw?.stage) || 0)),
  };
}
