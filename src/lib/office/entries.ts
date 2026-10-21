/**
 * Amanat Office — money entries: payments in and out, office expenses, cash
 * boxes & accounts, and transfers between our own accounts.
 *
 * Shared SQL for the money pages (lists with filters, single-record getters,
 * option lists for the forms, form validation, inserts/updates) and the
 * running ledger of one account.
 *
 * Rules (see README.md):
 *  - every money row stores amount + currency + per_usd + usd (= toUsd()).
 *  - a payment / expense / transfer uses its ACCOUNT's currency, taken from
 *    the account here on the server — the form is never trusted for it.
 *  - balances come from ledger.ts. The only figures worked out here are:
 *      · the running balance of one account (accountLedger) — the same sum as
 *        ledger.ts accountBalances(), line by line, and the page checks the
 *        two agree;
 *      · per-shipment "charged by / paid to" a payee (payeeShipments) — the
 *        same office_costs (payee) and office_payments (out) rows the ledger's
 *        party balance uses, just grouped by shipment.
 *  - list totals are plain sums of the `usd` column of the rows listed.
 */
import { q, one, type Runner } from './db';
import { round2, toUsd, today, fmtMoney, usd as fmtUsd, fmtDate, METHODS, type Method } from './money';
import { shipmentFigures, partyBalance, type PartyBalance } from './ledger';
import { PARTY_KINDS, ACCOUNT_TYPES, EXPENSE_CATEGORIES } from './services';
import { str, parseNum, date as fdDate, oneOf } from './form';

export const PAGE_SIZE = 50;
/** Largest amount accepted (NUMERIC(14,2) holds up to 10^12). */
const MAX_AMOUNT = 100_000_000_000;

export type Direction = 'in' | 'out';
export const DIRECTION_LABEL: Record<Direction, string> = { in: 'Money received', out: 'Money paid out' };

export type FormResult<T> = { ok: true; value: T } | { ok: false; error: string };

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

export function dirFrom(v: unknown): Direction {
  return v === 'out' ? 'out' : 'in';
}

/** A positive database id from a query/form value, or null. */
export function idParam(v: unknown): number | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  if (!/^\d{1,9}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

/** 'YYYY-MM-DD' that is a real date, or null. */
export function dateParam(v: string | null | undefined): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

export function pageParam(params: URLSearchParams): number {
  const n = Number(params.get('page'));
  return Number.isInteger(n) && n > 1 && n < 100_000 ? n : 1;
}

export function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** The current URL with some query values changed (null/'' removes one). Flash messages are dropped. */
export function withParams(url: URL, set: Record<string, string | number | null | undefined>): string {
  const u = new URL(url.pathname + url.search, 'http://x');
  u.searchParams.delete('ok');
  u.searchParams.delete('err');
  for (const [k, v] of Object.entries(set)) {
    if (v === null || v === undefined || v === '') u.searchParams.delete(k);
    else u.searchParams.set(k, String(v));
  }
  const s = u.searchParams.toString();
  return u.pathname + (s ? `?${s}` : '');
}

/** ILIKE pattern for a search box, with % and _ taken literally. */
function likePattern(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** "Owes us $1,200" / "We owe them $300" — a balance in words (ledger sign rule). */
export function balanceWords(balance: number, kind?: string | null): { text: string; tone: '' | 'pos' | 'neg' } {
  const b = round2(balance);
  if (b > 0) return { text: `Owes us ${fmtUsd(b)}`, tone: '' };
  if (b < 0) {
    return { text: kind === 'client' ? `We owe them ${fmtUsd(-b)} (paid in advance)` : `We owe them ${fmtUsd(-b)}`, tone: 'neg' };
  }
  return { text: 'All settled — nobody owes anything', tone: 'pos' };
}

/** "؋70,000 ($1,000.00)" — or just "$1,000.00" for dollars. */
export function moneyWithUsd(amount: number, currency: string, usdValue: number): string {
  return currency === 'USD' ? fmtMoney(amount, 'USD') : `${fmtMoney(amount, currency)} (${fmtUsd(usdValue)})`;
}

/** A plain rate: 70, 3.6725, 12,700. */
export function fmtRate(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 6 });
}

/** Rate as it goes back into an input box (no thousands separators). */
export function rateInput(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return String(Number(Number(n).toFixed(6)));
}

/** A CSV download. Text cells that start like a spreadsheet formula are made harmless. */
export function csvResponse(filename: string, header: string[], rows: unknown[][]): Response {
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  return new Response(body, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`,
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

/** The posted form as plain strings, so a form that failed can be shown again as typed. */
export function formValues(fd: FormData, names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const v = fd.get(n);
    out[n] = typeof v === 'string' ? v : '';
  }
  return out;
}

/** Problem with an entry date, or null. Money that moved can't be in the future. */
export function entryDateProblem(d: string | null): string | null {
  if (!d) return 'Enter the date (day, month and year).';
  if (d < '2000-01-01') return 'That date is too far in the past — check the year.';
  if (d > addDays(today(), 1)) return 'That date is in the future — enter the day the money actually moved.';
  return null;
}

/** Read an amount: > 0, rounded to cents. */
function readAmount(fd: FormData, name: string, label: string): { value: number } | { error: string } {
  const raw = str(fd, name, 40);
  if (raw === null) return { error: `Enter the ${label}.` };
  const n = parseNum(raw);
  if (n === null) return { error: `The ${label} "${raw}" is not a number.` };
  const v = round2(n);
  if (v <= 0) return { error: `The ${label} must be more than zero.` };
  if (v > MAX_AMOUNT) return { error: `The ${label} is too large — check it.` };
  return { value: v };
}

/**
 * Read a "units per 1 US dollar" rate for `currency`. Dollars are always 1.
 * A rate less than half or more than double today's usual rate is refused —
 * that is almost always the wrong currency's rate (e.g. 70 typed for dollars).
 */
function readRate(fd: FormData, name: string, currency: string, usual: number): { value: number } | { error: string } {
  if (currency === 'USD') return { value: 1 };
  const raw = str(fd, name, 40);
  if (raw === null) return { error: `Enter the rate: how many ${currency} make one US dollar.` };
  const n = parseNum(raw);
  if (n === null || n <= 0) return { error: `The rate "${raw}" is not right — it must be how many ${currency} make one US dollar (usually about ${fmtRate(usual)}).` };
  const v = Number(n.toFixed(6));
  if (usual > 0 && (v < usual / 2 || v > usual * 2)) {
    return {
      error: `The rate ${fmtRate(v)} looks wrong for ${currency} — the usual rate is about ${fmtRate(usual)} ${currency} per US dollar. Check it (if the usual rate itself is out of date, an admin can change it in Settings).`,
    };
  }
  return { value: v };
}

/** Default payment method for an account type (cash box → cash, bank → bank transfer…). */
export function methodForAccountType(type: string | null | undefined): Method {
  if (type === 'bank' || type === 'sarafi' || type === 'hawala') return type;
  return 'cash';
}

/** The last 24 months, newest first, for a month picker. */
export function monthOptions(todayStr: string, count = 24): { value: string; label: string }[] {
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  let [y, m] = todayStr.split('-').map(Number);
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ value: `${y}-${String(m).padStart(2, '0')}`, label: `${names[m - 1]} ${y}` });
    if (--m === 0) {
      m = 12;
      y--;
    }
  }
  return out;
}

function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}

/* ------------------------------------------------------------------ */
/* Option lists for forms and filters                                  */
/* ------------------------------------------------------------------ */

export interface AccountOption {
  id: number;
  name: string;
  type: string;
  currency: string;
  active: boolean;
  opening_balance: number;
  opening_date: string | null;
  notes: string | null;
  /** today's usual rate for the account's currency */
  per_usd: number;
  created_at: string;
}

const ACCOUNT_SELECT = `SELECT a.id, a.name, a.type, a.currency, a.active, a.opening_balance, a.opening_date, a.notes, a.created_at, c.per_usd
                          FROM office_accounts a JOIN office_currencies c ON c.code = a.currency`;

/** Active accounts (plus `includeId`, e.g. the account an old payment used), for a form. */
export async function accountOptions(includeId?: number | null): Promise<AccountOption[]> {
  return q<AccountOption>(`${ACCOUNT_SELECT} WHERE a.active OR a.id = $1 ORDER BY a.active DESC, a.name`, [includeId ?? 0]);
}

/** Every account, closed ones last — for filters. */
export async function listAccounts(): Promise<AccountOption[]> {
  return q<AccountOption>(`${ACCOUNT_SELECT} ORDER BY a.active DESC, a.name`);
}

export async function getAccount(id: number, runner?: Runner): Promise<AccountOption | null> {
  return one<AccountOption>(`${ACCOUNT_SELECT} WHERE a.id = $1`, [id], runner);
}

export function accountLabel(a: Pick<AccountOption, 'name' | 'currency' | 'active'>): string {
  return `${a.name} — ${a.currency}${a.active ? '' : ' (closed)'}`;
}

export interface PartyOption {
  id: number;
  name: string;
  kind: string;
  active: boolean;
}

/** Active parties (plus `includeId`), or every party with `all`. */
export async function partyOptions(opts: { includeId?: number | null; all?: boolean } = {}): Promise<PartyOption[]> {
  if (opts.all) return q<PartyOption>('SELECT id, name, kind, active FROM office_parties ORDER BY lower(name), id');
  return q<PartyOption>(
    'SELECT id, name, kind, active FROM office_parties WHERE active OR id = $1 ORDER BY lower(name), id',
    [opts.includeId ?? 0],
  );
}

export async function getParty(id: number, runner?: Runner): Promise<PartyOption | null> {
  return one<PartyOption>('SELECT id, name, kind, active FROM office_parties WHERE id = $1', [id], runner);
}

export function partyKindLabel(kind: string): string {
  return (PARTY_KINDS as Record<string, string>)[kind] ?? kind;
}

/**
 * Parties in <optgroup>s: clients first for money received, agents & partners
 * first for money paid out; for expenses staff and suppliers first.
 */
export function groupParties(list: PartyOption[], order: Direction | 'expense'): { label: string; parties: PartyOption[] }[] {
  if (order === 'expense') {
    const kinds = ['staff', 'supplier', 'other', 'agent', 'carrier', 'airline', 'sarafi', 'client'];
    return kinds
      .map((k) => ({ label: partyKindLabel(k), parties: list.filter((p) => p.kind === k) }))
      .filter((g) => g.parties.length);
  }
  const clients = { label: 'Clients', parties: list.filter((p) => p.kind === 'client') };
  const others = { label: 'Agents & partners', parties: list.filter((p) => p.kind !== 'client') };
  return (order === 'in' ? [clients, others] : [others, clients]).filter((g) => g.parties.length);
}

/* ------------------------------------------------------------------ */
/* Shipments, for linking a payment                                    */
/* ------------------------------------------------------------------ */

export interface ShipmentBasic {
  id: number;
  ref: string;
  client_id: number | null;
  client_name: string | null;
  ship_date: string;
  destination: string | null;
  status: string;
}

export async function getShipmentBasic(id: number, runner?: Runner): Promise<ShipmentBasic | null> {
  return one<ShipmentBasic>(
    `SELECT s.id, s.ref, s.client_id, p.name AS client_name, s.ship_date, s.destination, s.status
       FROM office_shipments s LEFT JOIN office_parties p ON p.id = s.client_id WHERE s.id = $1`,
    [id],
    runner,
  );
}

export interface OpenShipment {
  id: number;
  ref: string;
  ship_date: string;
  /** from ledger.ts shipmentFigures */
  revenue: number;
  received: number;
  due: number;
}

/** A client's shipments that still have money due (ledger figures), oldest first. */
export async function clientOpenShipments(partyId: number, includeId?: number | null): Promise<OpenShipment[]> {
  const ships = await q<{ id: number; ref: string; ship_date: string }>(
    'SELECT id, ref, ship_date FROM office_shipments WHERE client_id = $1 ORDER BY ship_date, id',
    [partyId],
  );
  if (!ships.length) return [];
  const figs = await shipmentFigures(ships.map((s) => s.id));
  return ships
    .map((s) => {
      const f = figs.get(s.id) ?? { revenue: 0, received: 0, due: 0 };
      return { ...s, revenue: f.revenue, received: f.received, due: f.due };
    })
    .filter((s) => s.due > 0 || s.id === includeId);
}

export interface PayeeShipment {
  id: number;
  ref: string;
  ship_date: string;
  /** their cost lines on this shipment (what they charged us) */
  owed: number;
  /** payments out to them linked to this shipment */
  paid: number;
  unpaid: number;
}

/**
 * Shipments where this party is the payee of a cost line, with what they
 * charged and what we have paid them against each. Same rows as the ledger's
 * owed_to_them / paid_to_them, grouped by shipment. Unpaid ones first.
 */
export async function payeeShipments(partyId: number, opts: { unpaidOnly?: boolean; limit?: number } = {}): Promise<PayeeShipment[]> {
  const rows = await q<Omit<PayeeShipment, 'unpaid'>>(
    `SELECT s.id, s.ref, s.ship_date, c.owed, COALESCE(p.paid, 0) AS paid
       FROM (SELECT shipment_id, SUM(usd) AS owed FROM office_costs WHERE payee_id = $1 GROUP BY shipment_id) c
       JOIN office_shipments s ON s.id = c.shipment_id
       LEFT JOIN (SELECT shipment_id, SUM(usd) AS paid FROM office_payments
                   WHERE direction = 'out' AND party_id = $1 AND shipment_id IS NOT NULL GROUP BY shipment_id) p
              ON p.shipment_id = s.id
      ORDER BY (c.owed - COALESCE(p.paid, 0) > 0) DESC, s.ship_date DESC, s.id DESC
      LIMIT $2`,
    [partyId, opts.limit ?? 200],
  );
  const out = rows.map((r) => ({ ...r, unpaid: round2(r.owed - r.paid) }));
  return opts.unpaidOnly ? out.filter((r) => r.unpaid > 0) : out;
}

/**
 * What the payment form shows beside itself once a party is chosen: their
 * balance (ledger), their shipments with money due (ledger), and shipments
 * where they have unpaid charges.
 */
export async function paymentPanel(partyId: number | null): Promise<{
  party: PartyBalance;
  words: { text: string; tone: '' | 'pos' | 'neg' };
  open: OpenShipment[];
  openDue: number;
  payee: PayeeShipment[];
  payeeUnpaid: number;
} | null> {
  if (!partyId) return null;
  const party = await partyBalance(partyId);
  if (!party) return null;
  const open = await clientOpenShipments(partyId);
  const payee = await payeeShipments(partyId, { unpaidOnly: true, limit: 50 });
  return {
    party,
    words: balanceWords(party.balance, party.kind),
    open,
    openDue: round2(open.reduce((a, s) => a + s.due, 0)),
    payee,
    payeeUnpaid: round2(payee.reduce((a, s) => a + s.unpaid, 0)),
  };
}

export interface ShipmentOption {
  id: number;
  ref: string;
  label: string;
}
export interface ShipmentOptionGroup {
  label: string;
  options: ShipmentOption[];
}

async function recentShipments(limit: number, excludeIds: number[] = []): Promise<{ id: number; ref: string; ship_date: string; client_name: string | null }[]> {
  return q(
    `SELECT s.id, s.ref, s.ship_date, p.name AS client_name
       FROM office_shipments s LEFT JOIN office_parties p ON p.id = s.client_id
      WHERE NOT (s.id = ANY($2::int[]))
      ORDER BY s.ship_date DESC, s.id DESC LIMIT $1`,
    [limit, excludeIds],
  );
}

/**
 * Shipments a payment can be linked to:
 *   in  + party → that client's shipments with money due
 *   out + party → shipments where they have charges, then other recent ones
 *   no party    → recent shipments
 * `includeId` (the shipment already chosen) is always in the list.
 */
export async function paymentShipmentOptions(dir: Direction, partyId: number | null, includeId: number | null): Promise<ShipmentOptionGroup[]> {
  const groups: ShipmentOptionGroup[] = [];
  const seen = new Set<number>();
  const push = (g: ShipmentOptionGroup) => {
    g.options = g.options.filter((o) => !seen.has(o.id));
    g.options.forEach((o) => seen.add(o.id));
    if (g.options.length) groups.push(g);
  };
  if (partyId && dir === 'in') {
    const open = await clientOpenShipments(partyId, includeId);
    push({
      label: 'Their shipments with money due',
      options: open.map((s) => ({ id: s.id, ref: s.ref, label: `${s.ref} · ${fmtDate(s.ship_date)} · ${s.due > 0 ? `due ${fmtUsd(s.due)}` : 'fully paid'}` })),
    });
  } else if (partyId && dir === 'out') {
    const mine = await payeeShipments(partyId, { limit: 100 });
    push({
      label: 'Shipments where they have charges',
      options: mine.map((s) => ({ id: s.id, ref: s.ref, label: `${s.ref} · ${fmtDate(s.ship_date)} · ${s.unpaid > 0 ? `unpaid ${fmtUsd(s.unpaid)}` : 'paid'}` })),
    });
    const recent = await recentShipments(40, [...seen]);
    push({
      label: 'Other recent shipments',
      options: recent.map((s) => ({ id: s.id, ref: s.ref, label: `${s.ref} · ${fmtDate(s.ship_date)}${s.client_name ? ` · ${s.client_name}` : ''}` })),
    });
  } else {
    const recent = await recentShipments(60);
    push({
      label: 'Recent shipments',
      options: recent.map((s) => ({ id: s.id, ref: s.ref, label: `${s.ref} · ${fmtDate(s.ship_date)}${s.client_name ? ` · ${s.client_name}` : ''}` })),
    });
  }
  if (includeId && !seen.has(includeId)) {
    const s = await getShipmentBasic(includeId);
    if (s) push({ label: 'Chosen shipment', options: [{ id: s.id, ref: s.ref, label: `${s.ref} · ${fmtDate(s.ship_date)}${s.client_name ? ` · ${s.client_name}` : ''}` }] });
  }
  return groups;
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

export interface PaymentRow {
  id: number;
  direction: Direction;
  pay_date: string;
  party_id: number;
  party_name: string;
  party_kind: string;
  account_id: number;
  account_name: string;
  account_type: string;
  account_active: boolean;
  shipment_id: number | null;
  shipment_ref: string | null;
  amount: number;
  currency: string;
  per_usd: number;
  usd: number;
  method: Method;
  reference: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
}

const PAYMENT_FROM = `
    FROM office_payments p
    JOIN office_parties pa ON pa.id = p.party_id
    JOIN office_accounts a ON a.id = p.account_id
    LEFT JOIN office_shipments s ON s.id = p.shipment_id
    LEFT JOIN office_users u ON u.id = p.created_by`;
const PAYMENT_COLS = `p.id, p.direction, p.pay_date, p.party_id, pa.name AS party_name, pa.kind AS party_kind,
    p.account_id, a.name AS account_name, a.type AS account_type, a.active AS account_active,
    p.shipment_id, s.ref AS shipment_ref, p.amount, p.currency, p.per_usd, p.usd, p.method,
    p.reference, p.notes, u.name AS created_by_name, p.created_at`;

export interface PaymentFilters {
  dir: Direction;
  from: string | null;
  to: string | null;
  party: number | null;
  account: number | null;
  method: Method | null;
  shipment: number | null;
  q: string | null;
}

export function paymentFilters(params: URLSearchParams): PaymentFilters {
  const m = params.get('method');
  const search = (params.get('q') ?? '').trim().slice(0, 80);
  let from = dateParam(params.get('from'));
  let to = dateParam(params.get('to'));
  if (from && to && from > to) [from, to] = [to, from];
  return {
    dir: dirFrom(params.get('dir')),
    from,
    to,
    party: idParam(params.get('party')),
    account: idParam(params.get('account')),
    method: m && m in METHODS ? (m as Method) : null,
    shipment: idParam(params.get('shipment')),
    q: search || null,
  };
}

function paymentWhere(f: PaymentFilters): { sql: string; params: unknown[] } {
  const params: unknown[] = [f.dir];
  const w: string[] = ['p.direction = $1'];
  const add = (cond: string, v: unknown) => {
    params.push(v);
    w.push(cond.replace('?', `$${params.length}`));
  };
  if (f.from) add('p.pay_date >= ?', f.from);
  if (f.to) add('p.pay_date <= ?', f.to);
  if (f.party) add('p.party_id = ?', f.party);
  if (f.account) add('p.account_id = ?', f.account);
  if (f.method) add('p.method = ?', f.method);
  if (f.shipment) add('p.shipment_id = ?', f.shipment);
  if (f.q) {
    params.push(likePattern(f.q));
    const n = `$${params.length}`;
    w.push(`(p.reference ILIKE ${n} OR p.notes ILIKE ${n} OR s.ref ILIKE ${n} OR s.awb_no ILIKE ${n})`);
  }
  return { sql: `WHERE ${w.join(' AND ')}`, params };
}

export interface ListResult<T> {
  rows: T[];
  count: number;
  page: number;
  pages: number;
}

export async function listPayments(
  f: PaymentFilters,
  page: number,
): Promise<ListResult<PaymentRow> & { totalUsd: number; byCurrency: { currency: string; amount: number }[] }> {
  const { sql, params } = paymentWhere(f);
  const tot = await one<{ n: number; usd: number }>(`SELECT COUNT(*) AS n, COALESCE(SUM(p.usd), 0) AS usd ${PAYMENT_FROM} ${sql}`, params);
  const count = tot?.n ?? 0;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const p = Math.min(page, pages);
  const rows = await q<PaymentRow>(
    `SELECT ${PAYMENT_COLS} ${PAYMENT_FROM} ${sql} ORDER BY p.pay_date DESC, p.id DESC LIMIT ${PAGE_SIZE} OFFSET $${params.length + 1}`,
    [...params, (p - 1) * PAGE_SIZE],
  );
  const byCurrency = await q<{ currency: string; amount: number }>(
    `SELECT p.currency, SUM(p.amount) AS amount ${PAYMENT_FROM} ${sql} GROUP BY p.currency ORDER BY (p.currency = 'USD') DESC, p.currency`,
    params,
  );
  return { rows, count, page: p, pages, totalUsd: round2(tot?.usd ?? 0), byCurrency };
}

/** Every payment matching the filters (for CSV), newest first. */
export async function exportPayments(f: PaymentFilters): Promise<PaymentRow[]> {
  const { sql, params } = paymentWhere(f);
  return q<PaymentRow>(`SELECT ${PAYMENT_COLS} ${PAYMENT_FROM} ${sql} ORDER BY p.pay_date DESC, p.id DESC LIMIT 100000`, params);
}

export async function getPayment(id: number, runner?: Runner): Promise<PaymentRow | null> {
  return one<PaymentRow>(`SELECT ${PAYMENT_COLS} ${PAYMENT_FROM} WHERE p.id = $1`, [id], runner);
}

/** The account this person used last for this direction — to pre-select it. */
export async function lastUsedAccount(userId: number, table: 'payment' | 'expense', dir?: Direction): Promise<number | null> {
  const r =
    table === 'payment'
      ? await one<{ account_id: number }>(
          `SELECT p.account_id FROM office_payments p JOIN office_accounts a ON a.id = p.account_id
            WHERE p.created_by = $1 AND p.direction = $2 AND a.active ORDER BY p.id DESC LIMIT 1`,
          [userId, dir ?? 'in'],
        )
      : await one<{ account_id: number }>(
          `SELECT e.account_id FROM office_expenses e JOIN office_accounts a ON a.id = e.account_id
            WHERE e.created_by = $1 AND a.active ORDER BY e.id DESC LIMIT 1`,
          [userId],
        );
  return r?.account_id ?? null;
}

export const PAYMENT_FIELDS = ['dir', 'pay_date', 'party', 'new_name', 'new_kind', 'account', 'amount', 'per_usd', 'method', 'reference', 'shipment', 'notes', 'from_shipment'];

export interface PaymentInput {
  direction: Direction;
  pay_date: string;
  /** existing party, or null when `new_party` is set */
  party_id: number | null;
  new_party: { name: string; kind: string } | null;
  party_name: string;
  account_id: number;
  account_name: string;
  currency: string;
  amount: number;
  per_usd: number;
  usd: number;
  method: Method;
  reference: string | null;
  shipment_id: number | null;
  shipment_ref: string | null;
  notes: string | null;
}

/**
 * Validate a posted payment form. `existing` (when editing) lets the payment
 * keep a party or account that has since been closed.
 */
export async function readPaymentForm(fd: FormData, existing?: PaymentRow | null): Promise<FormResult<PaymentInput>> {
  const direction = oneOf(fd, 'dir', ['in', 'out'] as const);
  if (!direction) return { ok: false, error: 'Choose whether the money was received or paid out.' };

  const pay_date = fdDate(fd, 'pay_date');
  const dp = entryDateProblem(pay_date);
  if (dp) return { ok: false, error: dp };

  // Who: an existing name, or a new one added in the same save.
  const partyId = idParam(fd.get('party'));
  const newName = str(fd, 'new_name', 120);
  let party_id: number | null = null;
  let new_party: PaymentInput['new_party'] = null;
  let party_name = '';
  if (partyId && newName) {
    return { ok: false, error: `Choose a name from the list OR type a new name — not both. (You chose one and also typed "${newName}".)` };
  }
  if (partyId) {
    const p = await getParty(partyId);
    if (!p) return { ok: false, error: 'That person or company was not found — choose again.' };
    if (!p.active && p.id !== existing?.party_id) return { ok: false, error: `${p.name} is marked inactive. Choose someone else, or make them active again on their page.` };
    party_id = p.id;
    party_name = p.name;
  } else if (newName) {
    if (newName.length < 2) return { ok: false, error: 'The new name is too short.' };
    const kind = oneOf(fd, 'new_kind', PARTY_KINDS);
    if (!kind) return { ok: false, error: `Say what "${newName}" is (client, agent, truck owner…).` };
    const dup = await one<{ id: number; name: string }>('SELECT id, name FROM office_parties WHERE lower(name) = lower($1) LIMIT 1', [newName]);
    if (dup) return { ok: false, error: `There is already someone called "${dup.name}" — choose them from the list instead of adding them again.` };
    new_party = { name: newName, kind };
    party_name = newName;
  } else {
    return { ok: false, error: direction === 'in' ? 'Choose who paid us (or type a new name).' : 'Choose who we paid (or type a new name).' };
  }

  // Where: the account decides the currency.
  const accountId = idParam(fd.get('account'));
  const account = accountId ? await getAccount(accountId) : null;
  if (!account) return { ok: false, error: direction === 'in' ? 'Choose the account the money went into.' : 'Choose the account the money came out of.' };
  if (!account.active && account.id !== existing?.account_id) return { ok: false, error: `The account "${account.name}" is closed. Choose another account.` };
  const currency = account.currency;

  const amt = readAmount(fd, 'amount', 'amount');
  if ('error' in amt) return { ok: false, error: amt.error };
  const rate = readRate(fd, 'per_usd', currency, account.per_usd);
  if ('error' in rate) return { ok: false, error: rate.error };
  const usdValue = toUsd(amt.value, rate.value);
  if (usdValue <= 0) return { ok: false, error: 'That amount is less than one US cent — check the amount and the rate.' };

  const method = oneOf(fd, 'method', METHODS);
  if (!method) return { ok: false, error: 'Choose how the money moved (cash, hawala, bank…).' };

  // Optional link to a shipment.
  let shipment_id: number | null = null;
  let shipment_ref: string | null = null;
  const sid = idParam(fd.get('shipment'));
  if (sid) {
    const s = await getShipmentBasic(sid);
    if (!s) return { ok: false, error: 'That shipment was not found — choose again or leave it empty.' };
    if (direction === 'in') {
      if (new_party) return { ok: false, error: `A new name has no shipments yet, so it can't be linked to ${s.ref}. Leave "Link to shipment" empty, or choose ${s.client_name ?? 'the shipment\'s client'} from the list.` };
      if (s.client_id !== party_id) {
        return { ok: false, error: `Shipment ${s.ref} belongs to ${s.client_name ?? 'no client'}, not ${party_name}. Choose one of ${party_name}'s shipments or leave it empty.` };
      }
    }
    shipment_id = s.id;
    shipment_ref = s.ref;
  }

  return {
    ok: true,
    value: {
      direction,
      pay_date: pay_date!,
      party_id,
      new_party,
      party_name,
      account_id: account.id,
      account_name: account.name,
      currency,
      amount: amt.value,
      per_usd: rate.value,
      usd: usdValue,
      method,
      reference: str(fd, 'reference', 120),
      shipment_id,
      shipment_ref,
      notes: str(fd, 'notes', 1000),
    },
  };
}

/** Add a party typed into a money form (name + kind only; details go on their page). */
export async function insertParty(name: string, kind: string, userId: number, t: Runner): Promise<number> {
  const r = await one<{ id: number }>(
    'INSERT INTO office_parties (name, kind, created_by) VALUES ($1, $2, $3) RETURNING id',
    [name, kind, userId],
    t,
  );
  return r!.id;
}

export async function insertPayment(v: PaymentInput & { party_id: number }, userId: number, t: Runner): Promise<number> {
  const r = await one<{ id: number }>(
    `INSERT INTO office_payments (direction, pay_date, party_id, account_id, shipment_id, amount, currency, per_usd, usd, method, reference, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [v.direction, v.pay_date, v.party_id, v.account_id, v.shipment_id, v.amount, v.currency, v.per_usd, v.usd, v.method, v.reference, v.notes, userId],
    t,
  );
  return r!.id;
}

export async function updatePayment(id: number, v: PaymentInput & { party_id: number }, t: Runner): Promise<void> {
  await q(
    `UPDATE office_payments SET direction = $1, pay_date = $2, party_id = $3, account_id = $4, shipment_id = $5,
            amount = $6, currency = $7, per_usd = $8, usd = $9, method = $10, reference = $11, notes = $12
      WHERE id = $13`,
    [v.direction, v.pay_date, v.party_id, v.account_id, v.shipment_id, v.amount, v.currency, v.per_usd, v.usd, v.method, v.reference, v.notes, id],
    t,
  );
}

/** One line for the activity log. */
export function paymentSummary(v: Pick<PaymentInput, 'direction' | 'amount' | 'currency' | 'usd' | 'party_name' | 'account_name' | 'method' | 'reference' | 'shipment_ref' | 'pay_date'>): string {
  const money = moneyWithUsd(v.amount, v.currency, v.usd);
  const what = v.direction === 'in' ? `Received ${money} from ${v.party_name} into ${v.account_name}` : `Paid ${money} to ${v.party_name} from ${v.account_name}`;
  return `${what} · ${METHODS[v.method]} · ${v.pay_date}${v.reference ? ` · ref ${v.reference}` : ''}${v.shipment_ref ? ` · for ${v.shipment_ref}` : ''}`;
}

/** What changed on an edit, for the activity log. */
export function paymentChanges(old: PaymentRow, v: PaymentInput): string {
  const ch: string[] = [];
  if (old.direction !== v.direction) ch.push(`direction ${old.direction} → ${v.direction}`);
  if (old.pay_date !== v.pay_date) ch.push(`date ${old.pay_date} → ${v.pay_date}`);
  if (old.party_name !== v.party_name) ch.push(`party ${old.party_name} → ${v.party_name}`);
  if (old.account_id !== v.account_id) ch.push(`account ${old.account_name} → ${v.account_name}`);
  if (old.amount !== v.amount || old.currency !== v.currency) ch.push(`amount ${fmtMoney(old.amount, old.currency)} → ${fmtMoney(v.amount, v.currency)}`);
  if (old.per_usd !== v.per_usd) ch.push(`rate ${fmtRate(old.per_usd)} → ${fmtRate(v.per_usd)}`);
  if (old.usd !== v.usd) ch.push(`USD ${fmtUsd(old.usd)} → ${fmtUsd(v.usd)}`);
  if (old.method !== v.method) ch.push(`method ${old.method} → ${v.method}`);
  if ((old.reference ?? '') !== (v.reference ?? '')) ch.push(`reference "${old.reference ?? ''}" → "${v.reference ?? ''}"`);
  if ((old.shipment_id ?? 0) !== (v.shipment_id ?? 0)) ch.push(`shipment ${old.shipment_ref ?? 'none'} → ${v.shipment_ref ?? 'none'}`);
  if ((old.notes ?? '') !== (v.notes ?? '')) ch.push('notes changed');
  return `Payment #${old.id}: ${ch.length ? ch.join('; ') : 'saved with no changes'}`;
}

/* ------------------------------------------------------------------ */
/* Office expenses                                                     */
/* ------------------------------------------------------------------ */

export interface ExpenseRow {
  id: number;
  exp_date: string;
  category: string;
  description: string | null;
  payee_id: number | null;
  payee_name: string | null;
  account_id: number;
  account_name: string;
  account_type: string;
  account_active: boolean;
  amount: number;
  currency: string;
  per_usd: number;
  usd: number;
  method: Method;
  reference: string | null;
  created_by_name: string | null;
  created_at: string;
}

const EXPENSE_FROM = `
    FROM office_expenses e
    JOIN office_accounts a ON a.id = e.account_id
    LEFT JOIN office_parties pa ON pa.id = e.payee_id
    LEFT JOIN office_users u ON u.id = e.created_by`;
const EXPENSE_COLS = `e.id, e.exp_date, e.category, e.description, e.payee_id, pa.name AS payee_name,
    e.account_id, a.name AS account_name, a.type AS account_type, a.active AS account_active,
    e.amount, e.currency, e.per_usd, e.usd, e.method, e.reference, u.name AS created_by_name, e.created_at`;

export function expenseCategoryLabel(c: string): string {
  return (EXPENSE_CATEGORIES as Record<string, string>)[c] ?? c;
}

export interface ExpenseFilters {
  from: string;
  to: string;
  /** what the period is, in words */
  label: string;
  /** selected month 'YYYY-MM', 'all', or '' for a custom date range */
  month: string;
  custom: boolean;
  category: string | null;
  account: number | null;
  q: string | null;
}

/**
 * ?month=YYYY-MM (default: this month) or ?month=all, or a custom range with
 * ?from=…&to=… (either end may be left open).
 */
export function expenseFilters(params: URLSearchParams, todayStr: string): ExpenseFilters {
  const cat = params.get('category');
  const category = cat && cat in EXPENSE_CATEGORIES ? cat : null;
  const account = idParam(params.get('account'));
  const search = (params.get('q') ?? '').trim().slice(0, 80) || null;
  const base = { category, account, q: search };
  let from = dateParam(params.get('from'));
  let to = dateParam(params.get('to'));
  if (from || to) {
    if (from && to && from > to) [from, to] = [to, from];
    const label = from && to ? `${fmtDate(from)} – ${fmtDate(to)}` : from ? `From ${fmtDate(from)}` : `Up to ${fmtDate(to)}`;
    return { ...base, from: from ?? '2000-01-01', to: to ?? '2999-12-31', label, month: '', custom: true };
  }
  const m = params.get('month');
  if (m === 'all') return { ...base, from: '2000-01-01', to: '2999-12-31', label: 'All dates', month: 'all', custom: false };
  const ym = m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : todayStr.slice(0, 7);
  const r = monthRange(ym);
  const opt = monthOptions(ym + '-01', 1)[0];
  return { ...base, ...r, label: opt.label, month: ym, custom: false };
}

function expenseWhere(f: ExpenseFilters): { sql: string; params: unknown[] } {
  const params: unknown[] = [f.from, f.to];
  const w = ['e.exp_date BETWEEN $1 AND $2'];
  if (f.category) {
    params.push(f.category);
    w.push(`e.category = $${params.length}`);
  }
  if (f.account) {
    params.push(f.account);
    w.push(`e.account_id = $${params.length}`);
  }
  if (f.q) {
    params.push(likePattern(f.q));
    const n = `$${params.length}`;
    w.push(`(e.description ILIKE ${n} OR e.reference ILIKE ${n} OR pa.name ILIKE ${n})`);
  }
  return { sql: `WHERE ${w.join(' AND ')}`, params };
}

export async function listExpenses(f: ExpenseFilters, page: number): Promise<ListResult<ExpenseRow> & { totalUsd: number }> {
  const { sql, params } = expenseWhere(f);
  const tot = await one<{ n: number; usd: number }>(`SELECT COUNT(*) AS n, COALESCE(SUM(e.usd), 0) AS usd ${EXPENSE_FROM} ${sql}`, params);
  const count = tot?.n ?? 0;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const p = Math.min(page, pages);
  const rows = await q<ExpenseRow>(
    `SELECT ${EXPENSE_COLS} ${EXPENSE_FROM} ${sql} ORDER BY e.exp_date DESC, e.id DESC LIMIT ${PAGE_SIZE} OFFSET $${params.length + 1}`,
    [...params, (p - 1) * PAGE_SIZE],
  );
  return { rows, count, page: p, pages, totalUsd: round2(tot?.usd ?? 0) };
}

/** Expense totals by category for the filtered period, biggest first. */
export async function expenseCategoryTotals(f: ExpenseFilters): Promise<{ category: string; n: number; usd: number }[]> {
  const { sql, params } = expenseWhere(f);
  return q(`SELECT e.category, COUNT(*) AS n, SUM(e.usd) AS usd ${EXPENSE_FROM} ${sql} GROUP BY e.category ORDER BY usd DESC, e.category`, params);
}

export async function exportExpenses(f: ExpenseFilters): Promise<ExpenseRow[]> {
  const { sql, params } = expenseWhere(f);
  return q<ExpenseRow>(`SELECT ${EXPENSE_COLS} ${EXPENSE_FROM} ${sql} ORDER BY e.exp_date DESC, e.id DESC LIMIT 100000`, params);
}

export async function getExpense(id: number, runner?: Runner): Promise<ExpenseRow | null> {
  return one<ExpenseRow>(`SELECT ${EXPENSE_COLS} ${EXPENSE_FROM} WHERE e.id = $1`, [id], runner);
}

export const EXPENSE_FIELDS = ['exp_date', 'category', 'description', 'payee', 'account', 'amount', 'per_usd', 'method', 'reference'];

export interface ExpenseInput {
  exp_date: string;
  category: string;
  description: string | null;
  payee_id: number | null;
  payee_name: string | null;
  account_id: number;
  account_name: string;
  currency: string;
  amount: number;
  per_usd: number;
  usd: number;
  method: Method;
  reference: string | null;
}

export async function readExpenseForm(fd: FormData, existing?: ExpenseRow | null): Promise<FormResult<ExpenseInput>> {
  const exp_date = fdDate(fd, 'exp_date');
  const dp = entryDateProblem(exp_date);
  if (dp) return { ok: false, error: dp };
  const category = oneOf(fd, 'category', EXPENSE_CATEGORIES);
  if (!category) return { ok: false, error: 'Choose what the expense was for (rent, salaries…).' };
  const description = str(fd, 'description', 300);
  if (category === 'other' && !description) return { ok: false, error: 'For "Other", write a short description of what was paid for.' };

  let payee_id: number | null = null;
  let payee_name: string | null = null;
  const pid = idParam(fd.get('payee'));
  if (pid) {
    const p = await getParty(pid);
    if (!p) return { ok: false, error: 'That payee was not found — choose again or leave it empty.' };
    if (!p.active && p.id !== existing?.payee_id) return { ok: false, error: `${p.name} is marked inactive — choose someone else or leave it empty.` };
    payee_id = p.id;
    payee_name = p.name;
  }

  const accountId = idParam(fd.get('account'));
  const account = accountId ? await getAccount(accountId) : null;
  if (!account) return { ok: false, error: 'Choose the account the money was paid from.' };
  if (!account.active && account.id !== existing?.account_id) return { ok: false, error: `The account "${account.name}" is closed. Choose another account.` };
  const amt = readAmount(fd, 'amount', 'amount');
  if ('error' in amt) return { ok: false, error: amt.error };
  const rate = readRate(fd, 'per_usd', account.currency, account.per_usd);
  if ('error' in rate) return { ok: false, error: rate.error };
  const usdValue = toUsd(amt.value, rate.value);
  if (usdValue <= 0) return { ok: false, error: 'That amount is less than one US cent — check the amount and the rate.' };
  const method = oneOf(fd, 'method', METHODS);
  if (!method) return { ok: false, error: 'Choose how it was paid (cash, hawala, bank…).' };

  return {
    ok: true,
    value: {
      exp_date: exp_date!,
      category,
      description,
      payee_id,
      payee_name,
      account_id: account.id,
      account_name: account.name,
      currency: account.currency,
      amount: amt.value,
      per_usd: rate.value,
      usd: usdValue,
      method,
      reference: str(fd, 'reference', 120),
    },
  };
}

export async function insertExpense(v: ExpenseInput, userId: number, t: Runner): Promise<number> {
  const r = await one<{ id: number }>(
    `INSERT INTO office_expenses (exp_date, category, description, payee_id, account_id, amount, currency, per_usd, usd, method, reference, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [v.exp_date, v.category, v.description, v.payee_id, v.account_id, v.amount, v.currency, v.per_usd, v.usd, v.method, v.reference, userId],
    t,
  );
  return r!.id;
}

export async function updateExpense(id: number, v: ExpenseInput, t: Runner): Promise<void> {
  await q(
    `UPDATE office_expenses SET exp_date = $1, category = $2, description = $3, payee_id = $4, account_id = $5,
            amount = $6, currency = $7, per_usd = $8, usd = $9, method = $10, reference = $11
      WHERE id = $12`,
    [v.exp_date, v.category, v.description, v.payee_id, v.account_id, v.amount, v.currency, v.per_usd, v.usd, v.method, v.reference, id],
    t,
  );
}

export function expenseSummary(v: Pick<ExpenseInput, 'category' | 'description' | 'amount' | 'currency' | 'usd' | 'account_name' | 'exp_date' | 'payee_name'>): string {
  return `${expenseCategoryLabel(v.category)}${v.description ? ` — ${v.description}` : ''}: ${moneyWithUsd(v.amount, v.currency, v.usd)} from ${v.account_name} · ${v.exp_date}${v.payee_name ? ` · to ${v.payee_name}` : ''}`;
}

export function expenseChanges(old: ExpenseRow, v: ExpenseInput): string {
  const ch: string[] = [];
  if (old.exp_date !== v.exp_date) ch.push(`date ${old.exp_date} → ${v.exp_date}`);
  if (old.category !== v.category) ch.push(`category ${old.category} → ${v.category}`);
  if ((old.description ?? '') !== (v.description ?? '')) ch.push(`description "${old.description ?? ''}" → "${v.description ?? ''}"`);
  if ((old.payee_id ?? 0) !== (v.payee_id ?? 0)) ch.push(`payee ${old.payee_name ?? 'none'} → ${v.payee_name ?? 'none'}`);
  if (old.account_id !== v.account_id) ch.push(`account ${old.account_name} → ${v.account_name}`);
  if (old.amount !== v.amount || old.currency !== v.currency) ch.push(`amount ${fmtMoney(old.amount, old.currency)} → ${fmtMoney(v.amount, v.currency)}`);
  if (old.per_usd !== v.per_usd) ch.push(`rate ${fmtRate(old.per_usd)} → ${fmtRate(v.per_usd)}`);
  if (old.usd !== v.usd) ch.push(`USD ${fmtUsd(old.usd)} → ${fmtUsd(v.usd)}`);
  if (old.method !== v.method) ch.push(`method ${old.method} → ${v.method}`);
  if ((old.reference ?? '') !== (v.reference ?? '')) ch.push(`reference "${old.reference ?? ''}" → "${v.reference ?? ''}"`);
  return `Expense #${old.id}: ${ch.length ? ch.join('; ') : 'saved with no changes'}`;
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

export function accountTypeLabel(t: string): string {
  return (ACCOUNT_TYPES as Record<string, string>)[t] ?? t;
}

export const ACCOUNT_FIELDS = ['name', 'type', 'currency', 'opening_balance', 'opening_date', 'notes'];

export interface AccountInput {
  name: string;
  type: string;
  currency: string;
  opening_balance: number;
  opening_date: string | null;
  notes: string | null;
}

/** Validate the add/edit account form. `existing` = the account being edited. */
export async function readAccountForm(fd: FormData, existing?: AccountOption | null): Promise<FormResult<AccountInput>> {
  const name = str(fd, 'name', 80);
  if (!name || name.length < 2) return { ok: false, error: 'Give the account a name, e.g. "Kandahar cash box (AFN)".' };
  const dup = await one<{ name: string }>('SELECT name FROM office_accounts WHERE lower(name) = lower($1) AND id <> $2', [name, existing?.id ?? 0]);
  if (dup) return { ok: false, error: `There is already an account called "${dup.name}". Use a different name.` };
  const type = oneOf(fd, 'type', ACCOUNT_TYPES);
  if (!type) return { ok: false, error: 'Choose what kind of account it is.' };
  const currency = (str(fd, 'currency', 3) ?? '').toUpperCase();
  const cur = currency ? await one<{ code: string }>('SELECT code FROM office_currencies WHERE code = $1', [currency]) : null;
  if (!cur) return { ok: false, error: 'Choose the currency the account holds.' };
  const rawOpening = str(fd, 'opening_balance', 40);
  let opening_balance = 0;
  if (rawOpening !== null) {
    const n = parseNum(rawOpening);
    if (n === null) return { ok: false, error: `The opening balance "${rawOpening}" is not a number.` };
    opening_balance = round2(n);
    if (Math.abs(opening_balance) > MAX_AMOUNT) return { ok: false, error: 'The opening balance is too large — check it.' };
  }
  const rawDate = str(fd, 'opening_date', 10);
  const opening_date = rawDate ? fdDate(fd, 'opening_date') : null;
  if (rawDate && !opening_date) return { ok: false, error: 'The opening date is not a real date.' };
  if (opening_date && opening_date > addDays(today(), 1)) return { ok: false, error: 'The opening date is in the future.' };
  return { ok: true, value: { name, type, currency, opening_balance, opening_date, notes: str(fd, 'notes', 1000) } };
}

/** How many records use an account — an account in use can't be deleted or change currency. */
export async function accountUsage(id: number, runner?: Runner): Promise<{ payments: number; expenses: number; transfers: number; total: number }> {
  const r = await one<{ payments: number; expenses: number; transfers: number }>(
    `SELECT (SELECT COUNT(*) FROM office_payments WHERE account_id = $1) AS payments,
            (SELECT COUNT(*) FROM office_expenses WHERE account_id = $1) AS expenses,
            (SELECT COUNT(*) FROM office_transfers WHERE from_account = $1 OR to_account = $1) AS transfers`,
    [id],
    runner,
  );
  const v = r ?? { payments: 0, expenses: 0, transfers: 0 };
  return { ...v, total: v.payments + v.expenses + v.transfers };
}

export type AccountLineKind = 'payment_in' | 'payment_out' | 'expense' | 'transfer_in' | 'transfer_out';

export interface AccountLine {
  date: string;
  kind: AccountLineKind;
  id: number;
  href: string;
  /** "Received from Haji Karim", "Expense — Office rent", "Transfer to Bank AFN" */
  title: string;
  /** smaller second line: shipment, description, method */
  detail: string | null;
  reference: string | null;
  party_id: number | null;
  shipment_id: number | null;
  shipment_ref: string | null;
  money_in: number;
  money_out: number;
  /** running balance after this line, in the account's currency */
  balance: number;
}

/**
 * Every movement of one account, oldest first, with a running balance in the
 * account's own currency — the same rows and sum as ledger.ts
 * accountBalances(): opening + payments in − payments out − expenses
 * + transfers in − transfers out. With from/to, earlier movements fold into a
 * "brought forward" opening and later ones are left out.
 */
export async function accountLedger(
  accountId: number,
  from?: string | null,
  to?: string | null,
): Promise<{ opening: number; broughtForward: boolean; lines: AccountLine[]; closing: number; totalIn: number; totalOut: number; allTimeClosing: number } | null> {
  const acc = await one<{ opening_balance: number }>('SELECT opening_balance FROM office_accounts WHERE id = $1', [accountId]);
  if (!acc) return null;
  const rows = await q<{
    date: string;
    kind: AccountLineKind;
    id: number;
    party_id: number | null;
    party_name: string | null;
    shipment_id: number | null;
    shipment_ref: string | null;
    category: string | null;
    description: string | null;
    other_account: string | null;
    method: string | null;
    reference: string | null;
    money_in: number;
    money_out: number;
  }>(
    `SELECT * FROM (
       SELECT p.pay_date AS date,
              CASE WHEN p.direction = 'in' THEN 'payment_in' ELSE 'payment_out' END AS kind,
              p.id, p.party_id, pa.name AS party_name, p.shipment_id, s.ref AS shipment_ref,
              NULL::text AS category, p.notes AS description, NULL::text AS other_account, p.method, p.reference,
              CASE WHEN p.direction = 'in'  THEN p.amount ELSE 0 END AS money_in,
              CASE WHEN p.direction = 'out' THEN p.amount ELSE 0 END AS money_out,
              p.created_at
         FROM office_payments p
         JOIN office_parties pa ON pa.id = p.party_id
         LEFT JOIN office_shipments s ON s.id = p.shipment_id
        WHERE p.account_id = $1
       UNION ALL
       SELECT e.exp_date, 'expense', e.id, e.payee_id, pa.name, NULL::int, NULL::text,
              e.category, e.description, NULL::text, e.method, e.reference,
              0, e.amount, e.created_at
         FROM office_expenses e LEFT JOIN office_parties pa ON pa.id = e.payee_id
        WHERE e.account_id = $1
       UNION ALL
       SELECT t.tr_date, 'transfer_in', t.id, NULL::int, NULL::text, NULL::int, NULL::text,
              NULL::text, t.notes, fa.name, NULL::text, t.reference,
              t.amount_in, 0, t.created_at
         FROM office_transfers t JOIN office_accounts fa ON fa.id = t.from_account
        WHERE t.to_account = $1
       UNION ALL
       SELECT t.tr_date, 'transfer_out', t.id, NULL::int, NULL::text, NULL::int, NULL::text,
              NULL::text, t.notes, ta.name, NULL::text, t.reference,
              0, t.amount_out, t.created_at
         FROM office_transfers t JOIN office_accounts ta ON ta.id = t.to_account
        WHERE t.from_account = $1
     ) x
     ORDER BY date, created_at, id, kind`,
    [accountId],
  );

  let running = round2(acc.opening_balance);
  let opening = running;
  let totalIn = 0;
  let totalOut = 0;
  const lines: AccountLine[] = [];
  for (const r of rows) {
    running = round2(running + r.money_in - r.money_out);
    if (from && r.date < from) {
      opening = running;
      continue;
    }
    if (to && r.date > to) continue;
    totalIn = round2(totalIn + r.money_in);
    totalOut = round2(totalOut + r.money_out);
    let title: string;
    let detail: string | null = null;
    let href: string;
    const method = r.method ? (METHODS as Record<string, string>)[r.method] ?? r.method : null;
    switch (r.kind) {
      case 'payment_in':
      case 'payment_out':
        title = `${r.kind === 'payment_in' ? 'Received from' : 'Paid to'} ${r.party_name}`;
        detail = [method, r.description].filter(Boolean).join(' · ') || null;
        href = `/office/payments/${r.id}`;
        break;
      case 'expense':
        title = `Expense — ${expenseCategoryLabel(r.category ?? '')}`;
        detail = [r.description, r.party_name ? `to ${r.party_name}` : null, method].filter(Boolean).join(' · ') || null;
        href = `/office/expenses/${r.id}`;
        break;
      case 'transfer_in':
        title = `Transfer from ${r.other_account}`;
        detail = r.description;
        href = `/office/transfers/${r.id}`;
        break;
      default:
        title = `Transfer to ${r.other_account}`;
        detail = r.description;
        href = `/office/transfers/${r.id}`;
    }
    lines.push({
      date: r.date,
      kind: r.kind,
      id: r.id,
      href,
      title,
      detail,
      reference: r.reference,
      party_id: r.party_id,
      shipment_id: r.shipment_id,
      shipment_ref: r.shipment_ref,
      money_in: r.money_in,
      money_out: r.money_out,
      balance: running,
    });
  }
  const closing = lines.length ? lines[lines.length - 1].balance : opening;
  return { opening, broughtForward: !!from, lines, closing, totalIn, totalOut, allTimeClosing: running };
}

/* ------------------------------------------------------------------ */
/* Transfers                                                           */
/* ------------------------------------------------------------------ */

export interface TransferRow {
  id: number;
  tr_date: string;
  from_account: number;
  from_name: string;
  from_currency: string;
  to_account: number;
  to_name: string;
  to_currency: string;
  amount_out: number;
  per_usd_out: number;
  usd_out: number;
  amount_in: number;
  per_usd_in: number;
  usd_in: number;
  /** usd_out − usd_in: what the move cost us in dollars (the ledger's transfer fee) */
  fee: number;
  reference: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
}

const TRANSFER_FROM = `
    FROM office_transfers t
    JOIN office_accounts fa ON fa.id = t.from_account
    JOIN office_accounts ta ON ta.id = t.to_account
    LEFT JOIN office_users u ON u.id = t.created_by`;
const TRANSFER_COLS = `t.id, t.tr_date, t.from_account, fa.name AS from_name, fa.currency AS from_currency,
    t.to_account, ta.name AS to_name, ta.currency AS to_currency,
    t.amount_out, t.per_usd_out, t.usd_out, t.amount_in, t.per_usd_in, t.usd_in,
    (t.usd_out - t.usd_in) AS fee, t.reference, t.notes, u.name AS created_by_name, t.created_at`;

export interface TransferFilters {
  from: string | null;
  to: string | null;
  account: number | null;
  q: string | null;
}

export function transferFilters(params: URLSearchParams): TransferFilters {
  let from = dateParam(params.get('from'));
  let to = dateParam(params.get('to'));
  if (from && to && from > to) [from, to] = [to, from];
  return { from, to, account: idParam(params.get('account')), q: (params.get('q') ?? '').trim().slice(0, 80) || null };
}

function transferWhere(f: TransferFilters): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const w: string[] = [];
  if (f.from) {
    params.push(f.from);
    w.push(`t.tr_date >= $${params.length}`);
  }
  if (f.to) {
    params.push(f.to);
    w.push(`t.tr_date <= $${params.length}`);
  }
  if (f.account) {
    params.push(f.account);
    w.push(`(t.from_account = $${params.length} OR t.to_account = $${params.length})`);
  }
  if (f.q) {
    params.push(likePattern(f.q));
    w.push(`(t.reference ILIKE $${params.length} OR t.notes ILIKE $${params.length})`);
  }
  return { sql: w.length ? `WHERE ${w.join(' AND ')}` : '', params };
}

function fixFee<T extends { fee: number }>(r: T): T {
  return { ...r, fee: round2(r.fee) };
}

export async function listTransfers(f: TransferFilters, page: number): Promise<ListResult<TransferRow> & { totalFee: number }> {
  const { sql, params } = transferWhere(f);
  const tot = await one<{ n: number; fee: number }>(`SELECT COUNT(*) AS n, COALESCE(SUM(t.usd_out - t.usd_in), 0) AS fee ${TRANSFER_FROM} ${sql}`, params);
  const count = tot?.n ?? 0;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const p = Math.min(page, pages);
  const rows = await q<TransferRow>(
    `SELECT ${TRANSFER_COLS} ${TRANSFER_FROM} ${sql} ORDER BY t.tr_date DESC, t.id DESC LIMIT ${PAGE_SIZE} OFFSET $${params.length + 1}`,
    [...params, (p - 1) * PAGE_SIZE],
  );
  return { rows: rows.map(fixFee), count, page: p, pages, totalFee: round2(tot?.fee ?? 0) };
}

export async function exportTransfers(f: TransferFilters): Promise<TransferRow[]> {
  const { sql, params } = transferWhere(f);
  return (await q<TransferRow>(`SELECT ${TRANSFER_COLS} ${TRANSFER_FROM} ${sql} ORDER BY t.tr_date DESC, t.id DESC LIMIT 100000`, params)).map(fixFee);
}

export async function getTransfer(id: number, runner?: Runner): Promise<TransferRow | null> {
  const r = await one<TransferRow>(`SELECT ${TRANSFER_COLS} ${TRANSFER_FROM} WHERE t.id = $1`, [id], runner);
  return r ? fixFee(r) : null;
}

export const TRANSFER_FIELDS = ['tr_date', 'from_account', 'to_account', 'amount_out', 'per_usd_out', 'amount_in', 'per_usd_in', 'reference', 'notes'];

export interface TransferInput {
  tr_date: string;
  from_account: number;
  from_name: string;
  from_currency: string;
  to_account: number;
  to_name: string;
  to_currency: string;
  amount_out: number;
  per_usd_out: number;
  usd_out: number;
  amount_in: number;
  per_usd_in: number;
  usd_in: number;
  reference: string | null;
  notes: string | null;
}

export async function readTransferForm(fd: FormData): Promise<FormResult<TransferInput>> {
  const tr_date = fdDate(fd, 'tr_date');
  const dp = entryDateProblem(tr_date);
  if (dp) return { ok: false, error: dp };
  const fromId = idParam(fd.get('from_account'));
  const toId = idParam(fd.get('to_account'));
  const fromAcc = fromId ? await getAccount(fromId) : null;
  const toAcc = toId ? await getAccount(toId) : null;
  if (!fromAcc) return { ok: false, error: 'Choose the account the money left from.' };
  if (!toAcc) return { ok: false, error: 'Choose the account the money arrived in.' };
  if (fromAcc.id === toAcc.id) return { ok: false, error: 'The two accounts must be different.' };
  if (!fromAcc.active) return { ok: false, error: `The account "${fromAcc.name}" is closed.` };
  if (!toAcc.active) return { ok: false, error: `The account "${toAcc.name}" is closed.` };

  const out = readAmount(fd, 'amount_out', 'amount sent');
  if ('error' in out) return { ok: false, error: out.error };
  const rOut = readRate(fd, 'per_usd_out', fromAcc.currency, fromAcc.per_usd);
  if ('error' in rOut) return { ok: false, error: rOut.error };
  const inn = readAmount(fd, 'amount_in', 'amount that arrived');
  if ('error' in inn) return { ok: false, error: inn.error };
  const same = fromAcc.currency === toAcc.currency;
  // Same currency: one rate for both sides, so the dollar fee is only what was lost on the way.
  const rIn = same ? rOut : readRate(fd, 'per_usd_in', toAcc.currency, toAcc.per_usd);
  if ('error' in rIn) return { ok: false, error: rIn.error };
  if (same && inn.value > out.value) {
    return { ok: false, error: `More arrived (${fmtMoney(inn.value, toAcc.currency)}) than was sent (${fmtMoney(out.value, fromAcc.currency)}). Check the two amounts.` };
  }
  const usd_out = toUsd(out.value, rOut.value);
  const usd_in = toUsd(inn.value, rIn.value);
  if (usd_out <= 0 || usd_in <= 0) return { ok: false, error: 'An amount is less than one US cent — check the amounts and rates.' };
  if (usd_in < usd_out / 2) {
    return { ok: false, error: `Only ${fmtUsd(usd_in)} arrived out of ${fmtUsd(usd_out)} sent — more than half lost. Check the amounts and rates.` };
  }
  if (usd_in > usd_out * 1.1) {
    return { ok: false, error: `In dollars, more arrived (${fmtUsd(usd_in)}) than was sent (${fmtUsd(usd_out)}). Check the amounts and rates.` };
  }
  return {
    ok: true,
    value: {
      tr_date: tr_date!,
      from_account: fromAcc.id,
      from_name: fromAcc.name,
      from_currency: fromAcc.currency,
      to_account: toAcc.id,
      to_name: toAcc.name,
      to_currency: toAcc.currency,
      amount_out: out.value,
      per_usd_out: rOut.value,
      usd_out,
      amount_in: inn.value,
      per_usd_in: rIn.value,
      usd_in,
      reference: str(fd, 'reference', 120),
      notes: str(fd, 'notes', 1000),
    },
  };
}

export async function insertTransfer(v: TransferInput, userId: number, t: Runner): Promise<number> {
  const r = await one<{ id: number }>(
    `INSERT INTO office_transfers (tr_date, from_account, to_account, amount_out, per_usd_out, usd_out, amount_in, per_usd_in, usd_in, reference, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [v.tr_date, v.from_account, v.to_account, v.amount_out, v.per_usd_out, v.usd_out, v.amount_in, v.per_usd_in, v.usd_in, v.reference, v.notes, userId],
    t,
  );
  return r!.id;
}

export function transferSummary(v: Pick<TransferInput, 'amount_out' | 'from_currency' | 'usd_out' | 'from_name' | 'amount_in' | 'to_currency' | 'usd_in' | 'to_name' | 'tr_date' | 'reference'>): string {
  const fee = round2(v.usd_out - v.usd_in);
  return `${moneyWithUsd(v.amount_out, v.from_currency, v.usd_out)} from ${v.from_name} → ${moneyWithUsd(v.amount_in, v.to_currency, v.usd_in)} into ${v.to_name} · fee ${fmtUsd(fee)} · ${v.tr_date}${v.reference ? ` · ref ${v.reference}` : ''}`;
}
