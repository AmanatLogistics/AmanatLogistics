/**
 * Amanat Office — insights: the shared queries behind the dashboard, the
 * section pages, invoices and the reports.
 *
 * Rules (README.md):
 *  - every money figure comes from ledger.ts (shipmentFigures, partyBalances,
 *    pnl, monthlyPnl, accountBalances, cashFlow). This file only selects WHICH
 *    rows to ask about and adds the ledger's own per-row figures together.
 *  - three figures the ledger has no function for are worked out here, with
 *    exactly the ledger's rules and the same `usd` columns:
 *      · monthlyCashFlow()  — cashFlow() split by month (payments in / out,
 *                             expenses; transfers are internal and excluded).
 *      · accountFlows()     — per account, the money that moved in a period
 *                             (the period slice of accountBalances()'s sums).
 *      · receivablesAging() — splits each positive ledger balance into age
 *                             buckets; every row still totals the ledger balance.
 *  - SQL always uses bound parameters; ORDER BY comes from fixed text only.
 */
import { q, one, tx } from './db';
import { round2, fmtDate, fmtMoney, usd } from './money';
import {
  shipmentFigures,
  partyBalances,
  accountBalances,
  periodFromParams,
  type Period,
  type ShipmentFigures,
  type PartyBalance,
} from './ledger';
import { invoiceStatus, type InvoiceStatus } from './invoices';
import {
  SERVICES,
  SHIPMENT_STATUS,
  COST_CATEGORIES,
  EXPENSE_CATEGORIES,
  PARTY_KINDS,
  ACCOUNT_TYPES,
  isService,
  type ServiceKey,
  type ShipmentStatus,
} from './services';
import { logActivity } from './activity';

export const PER_PAGE = 50;
const ZERO: ShipmentFigures = { revenue: 0, cost: 0, profit: 0, received: 0, applied: 0, due: 0 };

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

/** A real calendar day as YYYY-MM-DD, or null. */
export function isoDate(v: string | null | undefined): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

/** A positive database id from a URL or form value, or null. */
export function idParam(v: unknown): number | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  if (!/^\d{1,9}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && n <= 2_147_483_647 ? n : null;
}

export function pageParam(p: URLSearchParams): number {
  const n = Number(p.get('page'));
  return Number.isInteger(n) && n > 1 && n < 100_000 ? n : 1;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** Profit as a share of revenue, or null when there was no revenue. */
export function margin(profit: number, revenue: number): number | null {
  if (!revenue) return null;
  return (profit / revenue) * 100;
}

/** "23.4%" — or "—" when there is nothing to divide by. */
export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const s = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  return `${n < 0 ? '−' : ''}${s}%`;
}

/** 'pos' / 'neg' / '' for a profit figure. */
export function tone(n: number): 'pos' | 'neg' | '' {
  return n > 0 ? 'pos' : n < 0 ? 'neg' : '';
}

/** The billing weight of a shipment: chargeable kg when known, else actual kg (as the ledger counts it). */
export function kgOf(s: { weight_kg: number | null; chargeable_kg: number | null }): number | null {
  return s.chargeable_kg ?? s.weight_kg;
}

export function costCategoryLabel(c: string): string {
  return Object.prototype.hasOwnProperty.call(COST_CATEGORIES, c) ? COST_CATEGORIES[c as keyof typeof COST_CATEGORIES] : c;
}
export function expenseCategoryLabel(c: string): string {
  return Object.prototype.hasOwnProperty.call(EXPENSE_CATEGORIES, c) ? EXPENSE_CATEGORIES[c as keyof typeof EXPENSE_CATEGORIES] : c;
}
export function partyKindLabel(k: string): string {
  return Object.prototype.hasOwnProperty.call(PARTY_KINDS, k) ? PARTY_KINDS[k as keyof typeof PARTY_KINDS] : k;
}
export function accountTypeLabel(t: string): string {
  return Object.prototype.hasOwnProperty.call(ACCOUNT_TYPES, t) ? ACCOUNT_TYPES[t as keyof typeof ACCOUNT_TYPES] : t;
}
export function statusLabel(s: string): string {
  return Object.prototype.hasOwnProperty.call(SHIPMENT_STATUS, s) ? SHIPMENT_STATUS[s as ShipmentStatus] : s;
}
export function serviceShort(s: string): string {
  return isService(s) ? SERVICES[s].short : s;
}

/** "Kandahar → Dubai", or whatever part is known. */
export function routeText(s: { origin: string | null; destination: string | null }): string {
  if (s.origin && s.destination) return `${s.origin} → ${s.destination}`;
  return s.origin || s.destination || '—';
}

/**
 * A rate with its currency, keeping up to 4 decimals ("$4.50", "$0.125",
 * "؋3,500") — fmtMoney() rounds to cents, which would misprint a per-kg rate.
 */
export function fmtRateMoney(rate: number, currency: string): string {
  const prefix = fmtMoney(0, currency).replace(/[\d.,]+$/, '');
  const whole = currency === 'AFN' || currency === 'UZS' || currency === 'PKR';
  const n = Math.abs(rate).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 4 });
  return `${rate < 0 ? '−' : ''}${prefix}${n}`;
}

/** How a charge line is counted, as printed after its quantity. */
export function unitText(unit: string | null, qty: number | null = null): string {
  switch (unit) {
    case 'kg':
      return 'kg';
    case 'cbm':
      return 'CBM';
    case 'pcs':
      return qty === 1 ? 'piece' : 'pieces';
    case 'fixed':
    case null:
    case '':
      return '';
    default:
      return unit;
  }
}

/**
 * ledger.ts periodFromParams(), but an impossible custom date (2026-13-45,
 * 2026-02-30) is dropped first — periodFromParams only checks the shape, and
 * Postgres would refuse the date and fail the whole page.
 */
export function periodFromQuery(params: URLSearchParams, todayStr: string): Period & { key: string; label: string } {
  const p = new URLSearchParams(params);
  for (const k of ['from', 'to']) {
    const v = p.get(k);
    if (v !== null && !isoDate(v)) p.delete(k);
  }
  return periodFromParams(p, todayStr);
}

/** ?period=…(&from=…&to=…) for links that should keep the chosen period. */
export function periodQuery(p: { key: string; from: string; to: string }): string {
  const u = new URLSearchParams({ period: p.key });
  if (p.key === 'custom') {
    u.set('from', p.from);
    u.set('to', p.to);
  }
  return u.toString();
}

/** "1 Oct 2026 – 31 Oct 2026" (or "All dates" for the all-time preset). */
export function periodRangeText(p: { key: string; from: string; to: string }): string {
  if (p.key === 'all') return 'Every record, whatever its date';
  return `${fmtDate(p.from)} – ${fmtDate(p.to)}`;
}

function lastDayOf(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The 12 calendar months ending with this month. */
export function last12Months(todayStr: string): Period {
  const y = +todayStr.slice(0, 4);
  const m = +todayStr.slice(5, 7);
  let fy = y;
  let fm = m - 11;
  if (fm < 1) {
    fm += 12;
    fy -= 1;
  }
  return { from: `${fy}-${String(fm).padStart(2, '0')}-01`, to: `${y}-${String(m).padStart(2, '0')}-${lastDayOf(y, m)}` };
}

/**
 * Drop empty months at the start of a monthly series (before anything
 * happened) and at the end beyond this month — so "all time" or "this year"
 * shows real months only. Empty months in the middle stay, so there are no gaps.
 */
export function trimMonths<T extends { month: string }>(rows: T[], isEmpty: (r: T) => boolean, todayStr: string): T[] {
  const thisMonth = todayStr.slice(0, 7);
  let start = 0;
  while (start < rows.length && isEmpty(rows[start])) start++;
  let end = rows.length - 1;
  while (end >= start && rows[end].month > thisMonth && isEmpty(rows[end])) end--;
  return rows.slice(start, end + 1);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-10 → "Oct 2026" */
export function monthLabel(month: string): string {
  return `${MONTHS[+month.slice(5, 7) - 1] ?? month} ${month.slice(0, 4)}`;
}

/** "Owes us $1,200" / "We owe them $300" — a ledger balance in words. */
export function balanceWords(balance: number, kind?: string | null): string {
  const b = round2(balance);
  if (b > 0) return `Owes us ${usd(b)}`;
  if (b < 0) return kind === 'client' ? `We hold ${usd(-b)} for them` : `We owe them ${usd(-b)}`;
  return 'Settled';
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/** A CSV download. Text that a spreadsheet would run as a formula is made harmless. */
export function csvResponse(filename: string, rows: unknown[][]): Response {
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    let s = String(v);
    // a plain number (e.g. "-1182.00") stays a number; other text that starts
    // like a formula gets a leading ' so a spreadsheet shows it as text
    if (!/^-?\d+(\.\d+)?$/.test(s) && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM first, so Excel reads Dari / Pashto names correctly.
  const body = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`,
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

/** Dollars for a CSV cell: 1234.5 → "1234.50". */
export const csvUsd = (n: number) => round2(n).toFixed(2);

/* ------------------------------------------------------------------ */
/* Invoices                                                            */
/* ------------------------------------------------------------------ */

/** What the invoice list can be filtered by. 'open' = anything not fully paid. */
export const INVOICE_FILTER_STATUS = {
  open: 'Not fully paid',
  overdue: 'Overdue',
  unpaid: 'Unpaid',
  partial: 'Part paid',
  paid: 'Paid',
  credit: 'Overpaid',
} as const;
export type InvoiceFilterStatus = keyof typeof INVOICE_FILTER_STATUS;
const OPEN: InvoiceStatus[] = ['unpaid', 'partial', 'overdue'];

export interface InvoiceFilters {
  status: InvoiceFilterStatus | null;
  client: number | null;
  service: ServiceKey | null;
  from: string | null;
  to: string | null;
  q: string | null;
}

export function invoiceFilters(p: URLSearchParams): InvoiceFilters {
  const status = p.get('status');
  const service = p.get('service');
  let from = isoDate(p.get('from'));
  let to = isoDate(p.get('to'));
  if (from && to && from > to) [from, to] = [to, from];
  return {
    status: status && Object.prototype.hasOwnProperty.call(INVOICE_FILTER_STATUS, status) ? (status as InvoiceFilterStatus) : null,
    client: idParam(p.get('client')),
    service: isService(service) ? service : null,
    from,
    to,
    q: (p.get('q') ?? '').trim().slice(0, 100) || null,
  };
}

export function invoiceFiltersQuery(f: InvoiceFilters, extra: Record<string, string | number> = {}): string {
  const u = new URLSearchParams();
  if (f.q) u.set('q', f.q);
  if (f.status) u.set('status', f.status);
  if (f.client) u.set('client', String(f.client));
  if (f.service) u.set('service', f.service);
  if (f.from) u.set('from', f.from);
  if (f.to) u.set('to', f.to);
  for (const [k, v] of Object.entries(extra)) u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function hasInvoiceFilters(f: InvoiceFilters): boolean {
  return Boolean(f.status || f.client || f.service || f.from || f.to || f.q);
}

function likeTerm(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export interface InvoiceListRow {
  id: number;
  number: string;
  issue_date: string;
  due_date: string | null;
  notes: string | null;
  shipment_id: number;
  ref: string;
  service: ServiceKey;
  ship_status: ShipmentStatus;
  client_id: number | null;
  client_name: string | null;
  fig: ShipmentFigures;
  status: InvoiceStatus;
  /** days past the due date (overdue invoices only) */
  days_overdue: number | null;
}

export interface InvoiceTotals {
  count: number;
  revenue: number;
  received: number;
  due: number;
}

export interface InvoiceList {
  rows: InvoiceListRow[];
  totals: InvoiceTotals;
  page: number;
  pages: number;
  perPage: number;
}

/**
 * Invoices matching the filters, newest first (or soonest due first with
 * sort 'due'). The payment status depends on ledger figures, so the status
 * filter is applied after the figures are fetched. `page` null → every row.
 * Totals cover every matching invoice, not just the page.
 */
export async function listInvoices(
  f: InvoiceFilters,
  page: number | null,
  todayStr: string,
  opts: { sort?: 'newest' | 'due'; limit?: number } = {},
): Promise<InvoiceList> {
  const w: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    w.push(sql.replace('?', `$${params.length}`));
  };
  if (f.client) add('s.client_id = ?', f.client);
  if (f.service) add('s.service = ?', f.service);
  if (f.from) add('i.issue_date >= ?::date', f.from);
  if (f.to) add('i.issue_date <= ?::date', f.to);
  if (f.q) {
    params.push(likeTerm(f.q));
    const n = `$${params.length}`;
    w.push(`(i.number ILIKE ${n} OR s.ref ILIKE ${n} OR p.name ILIKE ${n})`);
  }
  const order = opts.sort === 'due' ? 'i.due_date ASC NULLS LAST, i.issue_date ASC, i.id ASC' : 'i.issue_date DESC, i.id DESC';
  const base = await q<Omit<InvoiceListRow, 'fig' | 'status' | 'days_overdue'>>(
    `SELECT i.id, i.number, i.issue_date, i.due_date, i.notes, i.shipment_id,
            s.ref, s.service, s.status AS ship_status, s.client_id, p.name AS client_name
       FROM office_invoices i
       JOIN office_shipments s ON s.id = i.shipment_id
       LEFT JOIN office_parties p ON p.id = s.client_id
      ${w.length ? 'WHERE ' + w.join(' AND ') : ''}
      ORDER BY ${order}`,
    params,
  );
  const figs = await shipmentFigures(base.map((r) => r.shipment_id));
  let rows: InvoiceListRow[] = base.map((r) => {
    const fig = figs.get(r.shipment_id) ?? ZERO;
    const status = invoiceStatus(fig.revenue, fig.received, r.due_date, todayStr);
    return { ...r, fig, status, days_overdue: status === 'overdue' && r.due_date ? daysBetween(r.due_date, todayStr) : null };
  });
  if (f.status === 'open') rows = rows.filter((r) => OPEN.includes(r.status));
  else if (f.status) rows = rows.filter((r) => r.status === f.status);

  const totals: InvoiceTotals = { count: rows.length, revenue: 0, received: 0, due: 0 };
  for (const r of rows) {
    totals.revenue += r.fig.revenue;
    totals.received += r.fig.received;
    totals.due += r.fig.due;
  }
  totals.revenue = round2(totals.revenue);
  totals.received = round2(totals.received);
  totals.due = round2(totals.due);

  if (opts.limit) return { rows: rows.slice(0, opts.limit), totals, page: 1, pages: 1, perPage: opts.limit };
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const pg = page === null ? null : Math.min(Math.max(1, page), pages);
  return {
    rows: pg === null ? rows : rows.slice((pg - 1) * PER_PAGE, pg * PER_PAGE),
    totals,
    page: pg ?? 1,
    pages,
    perPage: PER_PAGE,
  };
}

export interface InvoiceDetail {
  id: number;
  number: string;
  issue_date: string;
  due_date: string | null;
  notes: string | null;
  created_at: string;
  shipment: {
    id: number;
    ref: string;
    service: ServiceKey;
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
    status: ShipmentStatus;
  };
  client: { id: number; name: string; phone: string | null; city: string | null; country: string | null } | null;
  charges: {
    id: number;
    description: string;
    qty: number | null;
    unit: string | null;
    rate: number | null;
    amount: number;
    currency: string;
    per_usd: number;
    usd: number;
  }[];
  /** one entry per currency used on the lines, in order of first use */
  byCurrency: { currency: string; amount: number; usd: number; rates: number[] }[];
  fig: ShipmentFigures;
  status: InvoiceStatus;
  days_overdue: number | null;
  payments: { id: number; pay_date: string; amount: number; currency: string; usd: number; method: string; reference: string | null; account_name: string | null }[];
}

export async function getInvoice(id: number, todayStr: string): Promise<InvoiceDetail | null> {
  const r = await one<any>(
    `SELECT i.id, i.number, i.issue_date, i.due_date, i.notes, i.created_at,
            s.id AS s_id, s.ref, s.service, s.ship_date, s.origin, s.destination, s.goods, s.pieces,
            s.weight_kg, s.chargeable_kg, s.cbm, s.awb_no, s.tracking_no, s.status,
            p.id AS c_id, p.name AS c_name, p.phone AS c_phone, p.city AS c_city, p.country AS c_country
       FROM office_invoices i
       JOIN office_shipments s ON s.id = i.shipment_id
       LEFT JOIN office_parties p ON p.id = s.client_id
      WHERE i.id = $1`,
    [id],
  );
  if (!r) return null;
  const charges = await q<InvoiceDetail['charges'][number]>(
    `SELECT id, description, qty, unit, rate, amount, currency, per_usd, usd
       FROM office_charges WHERE shipment_id = $1 ORDER BY sort, id`,
    [r.s_id],
  );
  const payments = await q<InvoiceDetail['payments'][number]>(
    `SELECT p.id, p.pay_date, p.amount, p.currency, p.usd, p.method, p.reference, a.name AS account_name
       FROM office_payments p LEFT JOIN office_accounts a ON a.id = p.account_id
      WHERE p.shipment_id = $1 AND p.direction = 'in'
      ORDER BY p.pay_date, p.id`,
    [r.s_id],
  );
  const byCurrency: InvoiceDetail['byCurrency'] = [];
  for (const c of charges) {
    let e = byCurrency.find((x) => x.currency === c.currency);
    if (!e) byCurrency.push((e = { currency: c.currency, amount: 0, usd: 0, rates: [] }));
    e.amount = round2(e.amount + c.amount);
    e.usd = round2(e.usd + c.usd);
    if (!e.rates.includes(c.per_usd)) e.rates.push(c.per_usd);
  }
  const fig = (await shipmentFigures([r.s_id])).get(r.s_id) ?? ZERO;
  const status = invoiceStatus(fig.revenue, fig.received, r.due_date, todayStr);
  return {
    id: r.id,
    number: r.number,
    issue_date: r.issue_date,
    due_date: r.due_date,
    notes: r.notes,
    created_at: r.created_at,
    shipment: {
      id: r.s_id,
      ref: r.ref,
      service: r.service,
      ship_date: r.ship_date,
      origin: r.origin,
      destination: r.destination,
      goods: r.goods,
      pieces: r.pieces,
      weight_kg: r.weight_kg,
      chargeable_kg: r.chargeable_kg,
      cbm: r.cbm,
      awb_no: r.awb_no,
      tracking_no: r.tracking_no,
      status: r.status,
    },
    client: r.c_id ? { id: r.c_id, name: r.c_name, phone: r.c_phone, city: r.c_city, country: r.c_country } : null,
    charges,
    byCurrency,
    fig,
    status,
    days_overdue: status === 'overdue' && r.due_date ? daysBetween(r.due_date, todayStr) : null,
    payments,
  };
}

/**
 * Change an invoice's due date and notes (admin). Its lines and amounts are the
 * shipment's charges and cannot be edited here. Returns what changed, or null
 * when nothing did.
 */
export async function updateInvoiceMeta(
  id: number,
  dueDate: string | null,
  notes: string | null,
  userId: number,
): Promise<{ number: string; summary: string } | null> {
  return tx(async (t) => {
    const cur = await one<{ number: string; due_date: string | null; notes: string | null }>(
      'SELECT number, due_date, notes FROM office_invoices WHERE id = $1 FOR UPDATE',
      [id],
      t,
    );
    if (!cur) throw new Error('Invoice not found.');
    const changes: string[] = [];
    if ((cur.due_date ?? null) !== dueDate) changes.push(`due date ${cur.due_date ? fmtDate(cur.due_date) : 'none'} → ${dueDate ? fmtDate(dueDate) : 'none'}`);
    if ((cur.notes ?? null) !== notes) changes.push(notes ? 'notes changed' : 'notes removed');
    if (!changes.length) return null;
    await q('UPDATE office_invoices SET due_date = $1::date, notes = $2 WHERE id = $3', [dueDate, notes, id], t);
    const summary = `${cur.number}: ${changes.join('; ')}`;
    await logActivity(userId, 'invoice_updated', 'invoice', id, summary, t);
    return { number: cur.number, summary };
  });
}

/** Clients for the invoice filter (everyone who has an invoice, plus a chosen one). */
export async function invoiceClients(): Promise<{ id: number; name: string; city: string | null }[]> {
  return q(
    `SELECT DISTINCT p.id, p.name, p.city
       FROM office_parties p JOIN office_shipments s ON s.client_id = p.id JOIN office_invoices i ON i.shipment_id = s.id
      ORDER BY p.name`,
  );
}

/* ------------------------------------------------------------------ */
/* Shipments (dashboard & section pages)                               */
/* ------------------------------------------------------------------ */

export interface ShipmentRow {
  id: number;
  ref: string;
  service: ServiceKey;
  ship_date: string;
  client_id: number | null;
  client_name: string | null;
  origin: string | null;
  destination: string | null;
  goods: string | null;
  weight_kg: number | null;
  chargeable_kg: number | null;
  cbm: number | null;
  status: ShipmentStatus;
  invoice_id: number | null;
  invoice_number: string | null;
  fig: ShipmentFigures;
}

export interface ShipmentTotals {
  count: number;
  kg: number;
  cbm: number;
  /** profit of only the shipments that have a weight / a volume, and how many lack one —
   *  so "profit per kg / CBM" is not inflated by shipments with no measure entered */
  kgProfit: number;
  cbmProfit: number;
  noKg: number;
  noCbm: number;
  revenue: number;
  received: number;
  due: number;
  cost: number;
  profit: number;
}

const SHIPMENT_ROW_SQL = `
  SELECT s.id, s.ref, s.service, s.ship_date, s.client_id, p.name AS client_name, s.origin, s.destination, s.goods,
         s.weight_kg, s.chargeable_kg, s.cbm, s.status, i.id AS invoice_id, i.number AS invoice_number
    FROM office_shipments s
    LEFT JOIN office_parties p ON p.id = s.client_id
    LEFT JOIN office_invoices i ON i.shipment_id = s.id`;

/**
 * Shipments of one section shipped in the period (the same rows pnl(period,
 * service) counts), newest first, with ledger figures. Totals cover them all.
 */
export async function sectionShipments(
  service: ServiceKey,
  period: Period,
  page: number | null,
): Promise<{ rows: ShipmentRow[]; totals: ShipmentTotals; page: number; pages: number; perPage: number }> {
  const all = await q<Omit<ShipmentRow, 'fig'>>(
    `${SHIPMENT_ROW_SQL}
      WHERE s.service = $1 AND s.ship_date BETWEEN $2 AND $3
      ORDER BY s.ship_date DESC, s.id DESC`,
    [service, period.from, period.to],
  );
  const figs = await shipmentFigures(all.map((r) => r.id));
  const totals: ShipmentTotals = { count: all.length, kg: 0, cbm: 0, kgProfit: 0, cbmProfit: 0, noKg: 0, noCbm: 0, revenue: 0, received: 0, due: 0, cost: 0, profit: 0 };
  const rows = all.map((r) => {
    const fig = figs.get(r.id) ?? ZERO;
    const kg = kgOf(r);
    if (kg) {
      totals.kg += kg;
      totals.kgProfit += fig.profit;
    } else totals.noKg++;
    if (r.cbm) {
      totals.cbm += r.cbm;
      totals.cbmProfit += fig.profit;
    } else totals.noCbm++;
    totals.revenue += fig.revenue;
    totals.received += fig.received;
    totals.due += fig.due;
    totals.cost += fig.cost;
    totals.profit += fig.profit;
    return { ...r, fig };
  });
  totals.kg = round2(totals.kg);
  totals.cbm = Math.round(totals.cbm * 1000) / 1000;
  for (const k of ['revenue', 'received', 'due', 'cost', 'profit', 'kgProfit', 'cbmProfit'] as const) totals[k] = round2(totals[k]);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const pg = page === null ? null : Math.min(Math.max(1, page), pages);
  return { rows: pg === null ? rows : rows.slice((pg - 1) * PER_PAGE, pg * PER_PAGE), totals, page: pg ?? 1, pages, perPage: PER_PAGE };
}

/** The latest shipments (by ship date, then entry order), with ledger figures. */
export async function recentShipments(limit = 10): Promise<ShipmentRow[]> {
  const rows = await q<Omit<ShipmentRow, 'fig'>>(`${SHIPMENT_ROW_SQL} ORDER BY s.ship_date DESC, s.id DESC LIMIT $1`, [limit]);
  const figs = await shipmentFigures(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, fig: figs.get(r.id) ?? ZERO }));
}

/** How many shipments in the period are at each status (every status listed, even at 0). */
export async function statusCounts(period: Period): Promise<{ status: ShipmentStatus; label: string; n: number }[]> {
  const rows = await q<{ status: ShipmentStatus; n: number }>(
    `SELECT status, COUNT(*) AS n FROM office_shipments WHERE ship_date BETWEEN $1 AND $2 GROUP BY status`,
    [period.from, period.to],
  );
  return (Object.keys(SHIPMENT_STATUS) as ShipmentStatus[]).map((status) => ({
    status,
    label: SHIPMENT_STATUS[status],
    n: rows.find((r) => r.status === status)?.n ?? 0,
  }));
}

/**
 * Everyone who appears as a payee on this section's cost lines (any date),
 * with what they have charged us on this section and their OVERALL ledger
 * balance (all sections). Most owed first.
 */
export async function sectionPartners(service: ServiceKey): Promise<(PartyBalance & { charged: number; lines: number })[]> {
  const used = await q<{ id: number; charged: number; lines: number }>(
    `SELECT c.payee_id AS id, SUM(c.usd) AS charged, COUNT(*) AS lines
       FROM office_costs c JOIN office_shipments s ON s.id = c.shipment_id
      WHERE s.service = $1 AND c.payee_id IS NOT NULL
      GROUP BY c.payee_id`,
    [service],
  );
  if (!used.length) return [];
  const balances = new Map((await partyBalances()).map((p) => [p.id, p]));
  return used
    .map((u) => {
      const p = balances.get(u.id);
      return p ? { ...p, charged: round2(u.charged), lines: u.lines } : null;
    })
    .filter((x): x is PartyBalance & { charged: number; lines: number } => x !== null)
    .sort((a, b) => a.balance - b.balance || a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ */
/* Balances                                                            */
/* ------------------------------------------------------------------ */

/**
 * The three groups of the "who owes whom" picture, straight from
 * partyBalances(). Their totals are exactly balanceTotals():
 *   owesUs      balance > 0, any kind         → receivable
 *   weOwe       balance < 0, not a client     → payable
 *   weHold      balance < 0, a client         → clientCredit
 */
export async function balanceGroups(): Promise<{ owesUs: PartyBalance[]; weOwe: PartyBalance[]; weHold: PartyBalance[] }> {
  const all = await partyBalances();
  const owesUs = all.filter((p) => p.balance > 0).sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
  const neg = all.filter((p) => p.balance < 0).sort((a, b) => a.balance - b.balance || a.name.localeCompare(b.name));
  return { owesUs, weOwe: neg.filter((p) => p.kind !== 'client'), weHold: neg.filter((p) => p.kind === 'client') };
}

export const AGING_BUCKETS = ['0–30 days', '31–60 days', '61–90 days', 'Over 90 days'] as const;

export interface AgingRow {
  party: PartyBalance;
  /** amounts still owed, by days since the bill's date: [0–30, 31–60, 61–90, 90+] */
  buckets: [number, number, number, number];
  /** owed but not from a bill of theirs (e.g. we paid them more than they charged us) */
  other: number;
  /** credit not matched to an open bill (paid on account, or overpaid on another bill), set against their oldest bills */
  onAccount: number;
  bills: number;
  oldest: string | null;
}

/**
 * Age every positive ledger balance. The basis is each of their shipments
 * with money still due (ledger due = billed − received for that shipment),
 * aged by its invoice date (or ship date if it has no invoice yet).
 *
 * The ledger balance can be lower than those dues — for example an overpaid
 * bill, or money we owe them for a cost. (Money they paid without choosing a
 * shipment is already set against their oldest bills in shipmentFigures.)
 * That credit is set against their OLDEST bills first, the way a shopkeeper's
 * book works. If the balance
 * is higher than their bills (it isn't a client's bill at all), the excess is
 * shown as "other". Either way each row adds up to the ledger balance exactly.
 */
export async function receivablesAging(todayStr: string, owesUs?: PartyBalance[]): Promise<{ rows: AgingRow[]; totals: { buckets: [number, number, number, number]; other: number; balance: number } }> {
  const parties = owesUs ?? (await balanceGroups()).owesUs;
  const ids = parties.map((p) => p.id);
  const bills = ids.length
    ? await q<{ id: number; client_id: number; bill_date: string }>(
        `SELECT s.id, s.client_id, COALESCE(i.issue_date, s.ship_date) AS bill_date
           FROM office_shipments s LEFT JOIN office_invoices i ON i.shipment_id = s.id
          WHERE s.client_id = ANY($1::int[])
          ORDER BY bill_date, s.id`,
        [ids],
      )
    : [];
  const figs = await shipmentFigures(bills.map((b) => b.id));
  const byClient = new Map<number, { bill_date: string; due: number }[]>();
  for (const b of bills) {
    const due = figs.get(b.id)?.due ?? 0;
    if (due <= 0) continue;
    if (!byClient.has(b.client_id)) byClient.set(b.client_id, []);
    byClient.get(b.client_id)!.push({ bill_date: b.bill_date, due });
  }
  const totals = { buckets: [0, 0, 0, 0] as [number, number, number, number], other: 0, balance: 0 };
  const rows: AgingRow[] = parties.map((party) => {
    const open = byClient.get(party.id) ?? [];
    const sumOpen = round2(open.reduce((a, b) => a + b.due, 0));
    let credit = round2(Math.max(0, sumOpen - party.balance));
    const other = round2(Math.max(0, party.balance - sumOpen));
    const buckets: [number, number, number, number] = [0, 0, 0, 0];
    let counted = 0;
    let oldest: string | null = null;
    // oldest first, so credit is used up against the oldest bills
    for (const b of open) {
      let left = b.due;
      if (credit > 0) {
        const use = Math.min(credit, left);
        left = round2(left - use);
        credit = round2(credit - use);
      }
      if (left <= 0) continue;
      const days = Math.max(0, daysBetween(b.bill_date, todayStr));
      const i = days <= 30 ? 0 : days <= 60 ? 1 : days <= 90 ? 2 : 3;
      buckets[i] = round2(buckets[i] + left);
      counted++;
      if (!oldest) oldest = b.bill_date;
    }
    for (let i = 0; i < 4; i++) totals.buckets[i] = round2(totals.buckets[i] + buckets[i]);
    totals.other = round2(totals.other + other);
    totals.balance = round2(totals.balance + party.balance);
    return { party, buckets, other, onAccount: round2(Math.max(0, sumOpen - party.balance)), bills: counted, oldest };
  });
  return { rows, totals };
}

/* ------------------------------------------------------------------ */
/* Cash flow                                                           */
/* ------------------------------------------------------------------ */

/** cashFlow() month by month: money received, paid out and spent on the office. */
export async function monthlyCashFlow(period: Period): Promise<{ month: string; received: number; paid: number; expenses: number; net: number }[]> {
  const rows = await q<{ month: string; received: number; paid: number; expenses: number }>(
    `SELECT month,
            COALESCE(SUM(CASE WHEN kind = 'in' THEN usd END), 0) AS received,
            COALESCE(SUM(CASE WHEN kind = 'out' THEN usd END), 0) AS paid,
            COALESCE(SUM(CASE WHEN kind = 'exp' THEN usd END), 0) AS expenses
       FROM (
         SELECT to_char(pay_date, 'YYYY-MM') AS month, direction AS kind, usd FROM office_payments WHERE pay_date BETWEEN $1 AND $2
         UNION ALL
         SELECT to_char(exp_date, 'YYYY-MM'), 'exp', usd FROM office_expenses WHERE exp_date BETWEEN $1 AND $2
       ) x GROUP BY month`,
    [period.from, period.to],
  );
  const months: string[] = [];
  const [fy, fm] = period.from.slice(0, 7).split('-').map(Number);
  const [ty, tm] = period.to.slice(0, 7).split('-').map(Number);
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? (y++, (m = 1)) : m++) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return months.map((month) => {
    const r = rows.find((x) => x.month === month);
    const received = round2(r?.received ?? 0);
    const paid = round2(r?.paid ?? 0);
    const expenses = round2(r?.expenses ?? 0);
    return { month, received, paid, expenses, net: round2(received - paid - expenses) };
  });
}

export interface AccountFlow {
  id: number;
  name: string;
  type: string;
  currency: string;
  active: boolean;
  /** in the account's own currency, within the period */
  received: number;
  paid: number;
  expenses: number;
  transfersIn: number;
  transfersOut: number;
  net: number;
  /** the same in US dollars (each record's own usd) */
  net_usd: number;
  received_usd: number;
  paid_usd: number;
  expenses_usd: number;
  transfersIn_usd: number;
  transfersOut_usd: number;
  /** today's balance (ledger accountBalances), own currency and ≈ USD */
  balance: number;
  balance_usd: number;
  /** any money moved in the period */
  moved: boolean;
}

/**
 * For each account: what came in and went out during the period, in its own
 * currency (the same rows accountBalances() adds up), plus its balance today.
 */
export async function accountFlows(period: Period): Promise<AccountFlow[]> {
  const rows = await q<any>(
    `SELECT a.id,
            COALESCE(pi.v, 0) AS received, COALESCE(pi.u, 0) AS received_usd,
            COALESCE(po.v, 0) AS paid, COALESCE(po.u, 0) AS paid_usd,
            COALESCE(ex.v, 0) AS expenses, COALESCE(ex.u, 0) AS expenses_usd,
            COALESCE(ti.v, 0) AS tin, COALESCE(ti.u, 0) AS tin_usd,
            COALESCE(tro.v, 0) AS tout, COALESCE(tro.u, 0) AS tout_usd
       FROM office_accounts a
       LEFT JOIN (SELECT account_id, SUM(amount) AS v, SUM(usd) AS u FROM office_payments WHERE direction = 'in'  AND pay_date BETWEEN $1 AND $2 GROUP BY account_id) pi ON pi.account_id = a.id
       LEFT JOIN (SELECT account_id, SUM(amount) AS v, SUM(usd) AS u FROM office_payments WHERE direction = 'out' AND pay_date BETWEEN $1 AND $2 GROUP BY account_id) po ON po.account_id = a.id
       LEFT JOIN (SELECT account_id, SUM(amount) AS v, SUM(usd) AS u FROM office_expenses WHERE exp_date BETWEEN $1 AND $2 GROUP BY account_id) ex ON ex.account_id = a.id
       LEFT JOIN (SELECT to_account AS id, SUM(amount_in) AS v, SUM(usd_in) AS u FROM office_transfers WHERE tr_date BETWEEN $1 AND $2 GROUP BY to_account) ti ON ti.id = a.id
       LEFT JOIN (SELECT from_account AS id, SUM(amount_out) AS v, SUM(usd_out) AS u FROM office_transfers WHERE tr_date BETWEEN $1 AND $2 GROUP BY from_account) tro ON tro.id = a.id`,
    [period.from, period.to],
  );
  const flows = new Map(rows.map((r) => [r.id as number, r]));
  return (await accountBalances()).map((a) => {
    const r = flows.get(a.id) ?? {};
    const received = round2(r.received ?? 0);
    const paid = round2(r.paid ?? 0);
    const expenses = round2(r.expenses ?? 0);
    const transfersIn = round2(r.tin ?? 0);
    const transfersOut = round2(r.tout ?? 0);
    const u = (k: string) => round2(r[k] ?? 0);
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      currency: a.currency,
      active: a.active,
      received,
      paid,
      expenses,
      transfersIn,
      transfersOut,
      net: round2(received - paid - expenses + transfersIn - transfersOut),
      received_usd: u('received_usd'),
      paid_usd: u('paid_usd'),
      expenses_usd: u('expenses_usd'),
      transfersIn_usd: u('tin_usd'),
      transfersOut_usd: u('tout_usd'),
      net_usd: round2(u('received_usd') - u('paid_usd') - u('expenses_usd') + u('tin_usd') - u('tout_usd')),
      balance: a.balance,
      balance_usd: a.balance_usd,
      moved: received !== 0 || paid !== 0 || expenses !== 0 || transfersIn !== 0 || transfersOut !== 0,
    };
  });
}

/** Transfers between our own accounts in the period: how much moved and what the moves cost (fees). */
export async function transferSummary(period: Period): Promise<{ n: number; moved_usd: number; fees: number }> {
  const r = await one<{ n: number; moved: number; fees: number }>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(usd_out), 0) AS moved, COALESCE(SUM(usd_out - usd_in), 0) AS fees
       FROM office_transfers WHERE tr_date BETWEEN $1 AND $2`,
    [period.from, period.to],
  );
  return { n: r?.n ?? 0, moved_usd: round2(r?.moved ?? 0), fees: round2(r?.fees ?? 0) };
}
