/**
 * Shipments — the heart of the office system.
 *
 * One shipment = one consignment for one client. What the client is billed
 * lives in office_charges (revenue; these lines ARE the invoice), and what it
 * costs us lives in office_costs (each line with the partner we owe it to).
 *
 * This file holds the SQL the shipment pages share: the filtered list, one
 * shipment with its lines, the option lists for the form, reading + checking
 * the posted form, and the writes (save / replace lines, status, delete).
 *
 * Every money figure shown for a shipment (billed, cost, profit, received,
 * due) comes from ledger.ts → shipmentFigures(); nothing here adds up money
 * on its own except the per-line `usd` written at save time (money.ts toUsd)
 * and sums of those ledger figures for a totals row.
 */
import { q, one, tx, type Runner } from './db';
import { logActivity } from './activity';
import { nextShipmentRef } from './settings';
import { ensureInvoice, invoiceStatus, type InvoiceStatus } from './invoices';
import { shipmentFigures, type ShipmentFigures } from './ledger';
import { round2, toUsd, usd, fmtNum, rateMap } from './money';
import { parseNum, rows as formRows } from './form';
import {
  SERVICES,
  SHIPMENT_STATUS,
  COST_CATEGORIES,
  PARTY_KINDS,
  isService,
  type ServiceKey,
  type ShipmentStatus,
  type CostCategory,
  type PartyKind,
} from './services';

/** A problem the person can fix (shown on the form), as opposed to a crash. */
export class ShipmentError extends Error {}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** How a charge line is counted. */
export const CHARGE_UNITS = {
  kg: 'per kg',
  cbm: 'per CBM',
  pcs: 'per piece',
  fixed: 'fixed sum',
} as const;
export type ChargeUnit = keyof typeof CHARGE_UNITS;

/** Where a new shipment of each kind usually goes from and to. */
export const ROUTE_DEFAULTS: Record<ServiceKey, { origin: string; destination: string }> = {
  ups: { origin: 'Kandahar', destination: 'Dubai' },
  china: { origin: 'China', destination: 'Kandahar' },
  tashkent: { origin: 'Kandahar', destination: 'Tashkent' },
  kabul_air: { origin: 'Kandahar', destination: 'Kabul' },
  other: { origin: 'Kandahar', destination: '' },
};

/** Kinds a payee (someone we pay for a shipment) can be — everyone but clients. */
export const PAYEE_KINDS = (Object.keys(PARTY_KINDS) as PartyKind[]).filter((k) => k !== 'client');

/** A sensible kind for a new payee typed on a cost line of this category. */
const CATEGORY_KIND: Record<CostCategory, PartyKind> = {
  truck: 'carrier',
  documents: 'agent',
  loading: 'agent',
  airline: 'airline',
  airport_partner: 'agent',
  kabul_rent: 'agent',
  kabul_agent: 'agent',
  china_agent: 'agent',
  customs: 'agent',
  agent_fee: 'agent',
  other: 'other',
};
export function defaultPayeeKind(category: string): PartyKind {
  return CATEGORY_KIND[category as CostCategory] ?? 'other';
}

/** JSON for the form's script: category → default payee kind. */
export const CATEGORY_KIND_JSON = JSON.stringify(CATEGORY_KIND);

const PER_PAGE = 50;
const MAX_INT = 2_147_483_647;

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export interface Shipment {
  id: number;
  ref: string;
  service: ServiceKey;
  client_id: number | null;
  client_name: string | null;
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
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  /** updated_at in microseconds — sent with the edit form to catch two people editing at once */
  version: string;
  invoice_id: number | null;
  invoice_number: string | null;
  invoice_due_date: string | null;
}

export interface ChargeLine {
  id: number;
  description: string;
  qty: number | null;
  unit: string | null;
  rate: number | null;
  amount: number;
  currency: string;
  per_usd: number;
  usd: number;
  sort: number;
}

export interface CostLine {
  id: number;
  category: string;
  payee_id: number | null;
  payee_name: string | null;
  payee_kind: string | null;
  description: string | null;
  qty: number | null;
  rate: number | null;
  amount: number;
  currency: string;
  per_usd: number;
  usd: number;
  sort: number;
}

const SHIPMENT_SELECT = `
  SELECT s.id, s.ref, s.service, s.client_id, p.name AS client_name, s.ship_date, s.origin, s.destination,
         s.goods, s.pieces, s.weight_kg, s.chargeable_kg, s.cbm, s.awb_no, s.tracking_no, s.status, s.notes,
         u.name AS created_by_name, s.created_at, s.updated_at,
         (extract(epoch FROM s.updated_at) * 1000000)::bigint::text AS version,
         i.id AS invoice_id, i.number AS invoice_number, i.due_date AS invoice_due_date
    FROM office_shipments s
    LEFT JOIN office_parties p ON p.id = s.client_id
    LEFT JOIN office_users u ON u.id = s.created_by
    LEFT JOIN office_invoices i ON i.shipment_id = s.id`;

/** A route param like "12" → 12, or null for anything that is not a sane id. */
export function parseId(v: string | undefined | null): number | null {
  if (!v || !/^\d{1,10}$/.test(v)) return null;
  const n = Number(v);
  return n > 0 && n <= MAX_INT ? n : null;
}

export async function getShipment(id: number): Promise<{ shipment: Shipment; charges: ChargeLine[]; costs: CostLine[] } | null> {
  const shipment = await one<Shipment>(`${SHIPMENT_SELECT} WHERE s.id = $1`, [id]);
  if (!shipment) return null;
  const charges = await q<ChargeLine>(
    `SELECT id, description, qty, unit, rate, amount, currency, per_usd, usd, sort
       FROM office_charges WHERE shipment_id = $1 ORDER BY sort, id`,
    [id],
  );
  const costs = await q<CostLine>(
    `SELECT c.id, c.category, c.payee_id, p.name AS payee_name, p.kind AS payee_kind, c.description,
            c.qty, c.rate, c.amount, c.currency, c.per_usd, c.usd, c.sort
       FROM office_costs c LEFT JOIN office_parties p ON p.id = c.payee_id
      WHERE c.shipment_id = $1 ORDER BY c.sort, c.id`,
    [id],
  );
  return { shipment, charges, costs };
}

export interface LinkedPayment {
  id: number;
  direction: 'in' | 'out';
  pay_date: string;
  party_id: number;
  party_name: string;
  party_kind: string;
  account_name: string;
  amount: number;
  currency: string;
  per_usd: number;
  usd: number;
  method: string;
  reference: string | null;
}

/** Payments (in and out) linked to this shipment, oldest first. */
export async function linkedPayments(shipmentId: number): Promise<LinkedPayment[]> {
  return q<LinkedPayment>(
    `SELECT pm.id, pm.direction, pm.pay_date, pm.party_id, pt.name AS party_name, pt.kind AS party_kind,
            a.name AS account_name, pm.amount, pm.currency, pm.per_usd, pm.usd, pm.method, pm.reference
       FROM office_payments pm
       JOIN office_parties pt ON pt.id = pm.party_id
       JOIN office_accounts a ON a.id = pm.account_id
      WHERE pm.shipment_id = $1
      ORDER BY pm.pay_date, pm.id`,
    [shipmentId],
  );
}

/* ---------- option lists for the form ---------- */

export interface PartyOption {
  id: number;
  name: string;
  kind: string;
  city: string | null;
  active: boolean;
}

/** Clients for the form's select: active ones, plus any ids passed (the current client). */
export async function clientOptions(includeIds: number[] = []): Promise<PartyOption[]> {
  return q<PartyOption>(
    `SELECT id, name, kind, city, active FROM office_parties
      WHERE kind = 'client' AND (active OR id = ANY($1::int[]))
      ORDER BY lower(name), id`,
    [includeIds],
  );
}

/** Every client, active or not — for the list filter. */
export async function allClients(): Promise<PartyOption[]> {
  return q<PartyOption>(`SELECT id, name, kind, city, active FROM office_parties WHERE kind = 'client' ORDER BY lower(name), id`);
}

export interface PayeeGroup {
  kind: string;
  label: string;
  parties: PartyOption[];
}

/** Non-client parties grouped by kind (agents, carriers, airlines…), for the cost lines' payee select. */
export async function payeeGroups(includeIds: number[] = []): Promise<PayeeGroup[]> {
  const rows = await q<PartyOption>(
    `SELECT id, name, kind, city, active FROM office_parties
      WHERE kind <> 'client' AND (active OR id = ANY($1::int[]))
      ORDER BY lower(name), id`,
    [includeIds],
  );
  return PAYEE_KINDS.map((k) => ({ kind: k, label: PARTY_KINDS[k], parties: rows.filter((r) => r.kind === k) })).filter(
    (g) => g.parties.length > 0,
  );
}

/* ------------------------------------------------------------------ */
/* The list                                                            */
/* ------------------------------------------------------------------ */

export interface ShipmentFilters {
  service: ServiceKey | null;
  status: ShipmentStatus | null;
  client: number | null;
  from: string | null;
  to: string | null;
  q: string | null;
}

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export function filtersFromParams(p: URLSearchParams): ShipmentFilters {
  const service = p.get('service');
  const status = p.get('status');
  const from = p.get('from');
  const to = p.get('to');
  const text = (p.get('q') ?? '').trim().slice(0, 100);
  return {
    service: isService(service) ? service : null,
    status: status && status in SHIPMENT_STATUS ? (status as ShipmentStatus) : null,
    client: parseId(p.get('client')),
    from: isDate(from) ? from : null,
    to: isDate(to) ? to : null,
    q: text || null,
  };
}

/** The filters back as a query string (for paging links and the CSV link). */
export function filtersQuery(f: ShipmentFilters, extra: Record<string, string | number> = {}): string {
  const u = new URLSearchParams();
  if (f.q) u.set('q', f.q);
  if (f.service) u.set('service', f.service);
  if (f.status) u.set('status', f.status);
  if (f.client) u.set('client', String(f.client));
  if (f.from) u.set('from', f.from);
  if (f.to) u.set('to', f.to);
  for (const [k, v] of Object.entries(extra)) u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export function hasFilters(f: ShipmentFilters): boolean {
  return Boolean(f.service || f.status || f.client || f.from || f.to || f.q);
}

/** Escape LIKE wildcards so a search for "50%" means the text "50%". */
function likeTerm(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function whereFor(f: ShipmentFilters): { sql: string; params: unknown[] } {
  const w: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    w.push(sql.replace('?', `$${params.length}`));
  };
  if (f.service) add('s.service = ?', f.service);
  if (f.status) add('s.status = ?', f.status);
  if (f.client) add('s.client_id = ?', f.client);
  if (f.from) add('s.ship_date >= ?::date', f.from);
  if (f.to) add('s.ship_date <= ?::date', f.to);
  if (f.q) {
    params.push(likeTerm(f.q));
    const n = `$${params.length}`;
    w.push(
      `(s.ref ILIKE ${n} OR s.awb_no ILIKE ${n} OR s.tracking_no ILIKE ${n} OR s.goods ILIKE ${n} OR p.name ILIKE ${n} OR i.number ILIKE ${n})`,
    );
  }
  return { sql: w.length ? `WHERE ${w.join(' AND ')}` : '', params };
}

export interface ListRow extends Shipment {
  fig: ShipmentFigures;
  invoice_status: InvoiceStatus | null;
}

export interface ListTotals {
  count: number;
  kg: number;
  cbm: number;
  revenue: number;
  received: number;
  due: number;
  cost: number;
  profit: number;
}

export interface ShipmentList {
  rows: ListRow[];
  totals: ListTotals;
  page: number;
  pages: number;
  perPage: number;
}

const ZERO: ShipmentFigures = { revenue: 0, cost: 0, profit: 0, received: 0, due: 0 };

/**
 * Shipments matching the filters, newest first. `page` null → every row (CSV).
 * Totals cover the whole filtered set, not just the page, and are the sum of
 * the ledger's own per-shipment figures.
 */
export async function listShipments(f: ShipmentFilters, page: number | null, todayStr: string): Promise<ShipmentList> {
  const { sql: where, params } = whereFor(f);
  const from = `FROM office_shipments s
    LEFT JOIN office_parties p ON p.id = s.client_id
    LEFT JOIN office_invoices i ON i.shipment_id = s.id`;
  const agg = await one<{ n: number; kg: number; cbm: number; ids: number[] }>(
    `SELECT COUNT(*) AS n,
            COALESCE(SUM(COALESCE(s.chargeable_kg, s.weight_kg)), 0) AS kg,
            COALESCE(SUM(s.cbm), 0) AS cbm,
            COALESCE(array_agg(s.id), '{}') AS ids
       ${from} ${where}`,
    params,
  );
  const count = agg?.n ?? 0;
  const pages = Math.max(1, Math.ceil(count / PER_PAGE));
  const pg = page === null ? null : Math.min(Math.max(1, page), pages);
  const pageParams = [...params];
  let limit = '';
  if (pg !== null) {
    pageParams.push(PER_PAGE, (pg - 1) * PER_PAGE);
    limit = `LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`;
  }
  const rows = await q<Shipment>(
    `SELECT s.id, s.ref, s.service, s.client_id, p.name AS client_name, s.ship_date, s.origin, s.destination,
            s.goods, s.pieces, s.weight_kg, s.chargeable_kg, s.cbm, s.awb_no, s.tracking_no, s.status, s.notes,
            NULL::text AS created_by_name, s.created_at, s.updated_at, ''::text AS version,
            i.id AS invoice_id, i.number AS invoice_number, i.due_date AS invoice_due_date
       ${from} ${where}
      ORDER BY s.ship_date DESC, s.id DESC ${limit}`,
    pageParams,
  );
  const figs = await shipmentFigures(agg?.ids ?? []);
  const totals: ListTotals = { count, kg: round2(agg?.kg ?? 0), cbm: Math.round((agg?.cbm ?? 0) * 1000) / 1000, revenue: 0, received: 0, due: 0, cost: 0, profit: 0 };
  for (const fig of figs.values()) {
    totals.revenue += fig.revenue;
    totals.received += fig.received;
    totals.due += fig.due;
    totals.cost += fig.cost;
    totals.profit += fig.profit;
  }
  for (const k of ['revenue', 'received', 'due', 'cost', 'profit'] as const) totals[k] = round2(totals[k]);
  return {
    rows: rows.map((r) => {
      const fig = figs.get(r.id) ?? ZERO;
      return {
        ...r,
        fig,
        invoice_status: r.invoice_id ? invoiceStatus(fig.revenue, fig.received, r.invoice_due_date, todayStr) : null,
      };
    }),
    totals,
    page: pg ?? 1,
    pages,
    perPage: PER_PAGE,
  };
}

/** One CSV cell. Text that a spreadsheet would run as a formula is prefixed with '. */
function csvCell(v: unknown, isText = true): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (isText && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The filtered list as CSV (admin only — it has cost and profit). */
export function shipmentsCsv(list: ShipmentList): string {
  const head = [
    'Ref', 'Ship date', 'Section', 'Client', 'From', 'To', 'Goods', 'Pieces', 'Weight kg', 'Chargeable kg', 'CBM',
    'AWB no', 'Tracking no', 'Status', 'Billed USD', 'Received USD', 'Due USD', 'Cost USD', 'Profit USD',
    'Invoice', 'Invoice status',
  ];
  const lines = [head.join(',')];
  for (const r of list.rows) {
    lines.push(
      [
        csvCell(r.ref),
        csvCell(r.ship_date),
        csvCell(SERVICES[r.service]?.short ?? r.service),
        csvCell(r.client_name),
        csvCell(r.origin),
        csvCell(r.destination),
        csvCell(r.goods),
        csvCell(r.pieces, false),
        csvCell(r.weight_kg, false),
        csvCell(r.chargeable_kg, false),
        csvCell(r.cbm, false),
        csvCell(r.awb_no),
        csvCell(r.tracking_no),
        csvCell(SHIPMENT_STATUS[r.status] ?? r.status),
        csvCell(r.fig.revenue.toFixed(2), false),
        csvCell(r.fig.received.toFixed(2), false),
        csvCell(r.fig.due.toFixed(2), false),
        csvCell(r.fig.cost.toFixed(2), false),
        csvCell(r.fig.profit.toFixed(2), false),
        csvCell(r.invoice_number),
        csvCell(r.invoice_status),
      ].join(','),
    );
  }
  const t = list.totals;
  lines.push(
    [
      csvCell(`Total (${t.count} shipments)`), '', '', '', '', '', '', '', '', csvCell(t.kg, false), csvCell(t.cbm, false), '', '', '',
      t.revenue.toFixed(2), t.received.toFixed(2), t.due.toFixed(2), t.cost.toFixed(2), t.profit.toFixed(2), '', '',
    ].join(','),
  );
  // BOM so Excel reads Dari / Pashto names correctly.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/* ------------------------------------------------------------------ */
/* The form: what it holds (as typed), templates, reading a post       */
/* ------------------------------------------------------------------ */

/** The shipment fields exactly as typed — strings, so a form with a mistake re-shows what was entered. */
export interface ShipmentForm {
  service: string;
  ship_date: string;
  client_id: string;
  new_client: string;
  new_client_phone: string;
  origin: string;
  destination: string;
  goods: string;
  pieces: string;
  weight_kg: string;
  chargeable_kg: string;
  cbm: string;
  awb_no: string;
  tracking_no: string;
  status: string;
  notes: string;
  version: string;
}

/** One charge or cost line as typed. Charges use description…per_usd; costs also category and payee. */
export interface LineForm {
  description: string;
  qty: string;
  unit: string;
  rate: string;
  amount: string;
  currency: string;
  per_usd: string;
  category: string;
  payee_id: string;
  new_payee: string;
  new_payee_kind: string;
  /** what the quantity follows on the form: 'kg', 'cbm', 'pcs' or '' (typed by hand) */
  per: string;
}

export interface FormState {
  form: ShipmentForm;
  charges: LineForm[];
  costs: LineForm[];
}

const FORM_KEYS: (keyof ShipmentForm)[] = [
  'service', 'ship_date', 'client_id', 'new_client', 'new_client_phone', 'origin', 'destination', 'goods', 'pieces',
  'weight_kg', 'chargeable_kg', 'cbm', 'awb_no', 'tracking_no', 'status', 'notes', 'version',
];
const LINE_KEYS: (keyof LineForm)[] = [
  'description', 'qty', 'unit', 'rate', 'amount', 'currency', 'per_usd', 'category', 'payee_id', 'new_payee', 'new_payee_kind', 'per',
];

export function blankLine(kind: 'charge' | 'cost', rates: Record<string, number>): LineForm {
  return {
    description: '',
    qty: '',
    unit: kind === 'charge' ? 'fixed' : '',
    rate: '',
    amount: '',
    currency: 'USD',
    per_usd: String(rates.USD ?? 1),
    category: kind === 'cost' ? 'other' : '',
    payee_id: '',
    new_payee: '',
    new_payee_kind: kind === 'cost' ? 'other' : '',
    per: '',
  };
}

/** An empty form for a new shipment of this kind, dated today. */
export function newForm(service: ServiceKey, todayStr: string, clientId: number | null, rates: Record<string, number>): FormState {
  const def = SERVICES[service];
  const r = ROUTE_DEFAULTS[service];
  const form: ShipmentForm = {
    service,
    ship_date: todayStr,
    client_id: clientId ? String(clientId) : '',
    new_client: '',
    new_client_phone: '',
    origin: r.origin,
    destination: r.destination,
    goods: '',
    pieces: '',
    weight_kg: '',
    chargeable_kg: '',
    cbm: '',
    awb_no: '',
    tracking_no: '',
    status: 'booked',
    notes: '',
    version: '',
  };
  const qtyFor = (per: string) => (per === 'fixed' ? '1' : '');
  const charges = def.chargeTemplate.map((t) => ({
    ...blankLine('charge', rates),
    description: t.description,
    unit: t.per,
    qty: qtyFor(t.per),
    per: t.per === 'fixed' ? '' : t.per,
  }));
  const costs = def.costTemplate.map((t) => ({
    ...blankLine('cost', rates),
    category: t.category,
    description: t.description,
    qty: qtyFor(t.per),
    per: t.per === 'fixed' ? '' : t.per,
    new_payee_kind: defaultPayeeKind(t.category),
  }));
  return { form, charges, costs };
}

const numStr = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

/** The edit form, filled from a saved shipment. */
export function formFromShipment(s: Shipment, charges: ChargeLine[], costs: CostLine[]): FormState {
  const kgSrc = s.chargeable_kg ?? s.weight_kg;
  const follows = (qty: number | null): string => {
    if (qty === null) return '';
    if (kgSrc !== null && qty === kgSrc) return 'kg';
    if (s.cbm !== null && qty === s.cbm) return 'cbm';
    if (s.pieces !== null && qty === s.pieces) return 'pcs';
    return '';
  };
  return {
    form: {
      service: s.service,
      ship_date: s.ship_date,
      client_id: s.client_id ? String(s.client_id) : '',
      new_client: '',
      new_client_phone: '',
      origin: s.origin ?? '',
      destination: s.destination ?? '',
      goods: s.goods ?? '',
      pieces: numStr(s.pieces),
      weight_kg: numStr(s.weight_kg),
      chargeable_kg: numStr(s.chargeable_kg),
      cbm: numStr(s.cbm),
      awb_no: s.awb_no ?? '',
      tracking_no: s.tracking_no ?? '',
      status: s.status,
      notes: s.notes ?? '',
      version: s.version,
    },
    charges: charges.map((c) => ({
      description: c.description,
      qty: numStr(c.qty),
      unit: c.unit ?? 'fixed',
      rate: numStr(c.rate),
      amount: c.amount.toFixed(2),
      currency: c.currency,
      per_usd: numStr(c.per_usd),
      category: '',
      payee_id: '',
      new_payee: '',
      new_payee_kind: '',
      per: c.unit === 'kg' || c.unit === 'cbm' || c.unit === 'pcs' ? c.unit : '',
    })),
    costs: costs.map((c) => ({
      description: c.description ?? '',
      qty: numStr(c.qty),
      unit: '',
      rate: numStr(c.rate),
      amount: c.amount.toFixed(2),
      currency: c.currency,
      per_usd: numStr(c.per_usd),
      category: c.category,
      payee_id: c.payee_id ? String(c.payee_id) : '',
      new_payee: '',
      new_payee_kind: defaultPayeeKind(c.category),
      per: follows(c.qty),
    })),
  };
}

/** A line nobody typed anything into (currency and rate selects always have a value, so they do not count). */
function isBlankLine(l: LineForm): boolean {
  return !l.description && !l.qty && !l.rate && !l.amount && !(l.payee_id && l.payee_id !== '') && !l.new_payee;
}

/** Read the posted form as typed. */
export function readForm(fd: FormData): FormState {
  const s = (name: string, max: number) => {
    const v = fd.get(name);
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
  };
  const form = {} as ShipmentForm;
  for (const k of FORM_KEYS) form[k] = s(k, k === 'notes' ? 2000 : k === 'goods' ? 500 : 200);
  const line = (r: Record<string, string>): LineForm => {
    const l = {} as LineForm;
    for (const k of LINE_KEYS) l[k] = (r[k] ?? '').slice(0, k === 'description' ? 300 : 120);
    return l;
  };
  const charges = formRows(fd, 'charge').map(line).filter((l) => !isBlankLine(l));
  const costs = formRows(fd, 'cost').map(line).filter((l) => !isBlankLine(l));
  return { form, charges, costs };
}

/* ------------------------------------------------------------------ */
/* Checking a posted form                                              */
/* ------------------------------------------------------------------ */

type PartyRef = { id: number } | { name: string; kind: PartyKind; phone: string | null };

export interface ParsedLine {
  description: string | null;
  qty: number | null;
  unit: string | null;
  rate: number | null;
  amount: number;
  currency: string;
  per_usd: number;
  usd: number;
  category: string;
  payee: PartyRef | null;
}

export interface ParsedShipment {
  service: ServiceKey;
  ship_date: string;
  client: PartyRef;
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
  notes: string | null;
  version: string | null;
  charges: ParsedLine[];
  costs: ParsedLine[];
}

export interface Checked {
  errors: string[];
  /** saved anyway, but worth a second look (shown after saving) */
  warnings: string[];
  /** template lines with no amount that were left out */
  skipped: string[];
  data: ParsedShipment | null;
}

const orNull = (s: string) => (s === '' ? null : s);

/**
 * Check everything typed. Never throws for bad input — every problem becomes a
 * plain-English line in `errors`, numbered by line so it can be found.
 */
export async function checkForm(state: FormState, rates: Record<string, number>, opts: { currentClientId?: number | null } = {}): Promise<Checked> {
  const { form } = state;
  const errors: string[] = [];
  const warnings: string[] = [];
  const skipped: string[] = [];

  const service = isService(form.service) ? form.service : null;
  if (!service) errors.push('Choose which section this shipment belongs to.');

  let ship_date: string | null = null;
  if (!form.ship_date) errors.push('Enter the ship date.');
  else if (!isDate(form.ship_date) || form.ship_date < '2000-01-01' || form.ship_date > '2099-12-31')
    errors.push(`"${form.ship_date}" is not a valid ship date.`);
  else ship_date = form.ship_date;

  const status = form.status in SHIPMENT_STATUS ? (form.status as ShipmentStatus) : null;
  if (!status) errors.push('Choose a status.');

  // Client: one from the list, or a new name — not both, not neither.
  let client: PartyRef | null = null;
  const cid = parseId(form.client_id);
  const newClient = form.new_client.slice(0, 120);
  if (cid && newClient) errors.push('Choose the client from the list or type a new client\'s name — not both.');
  else if (cid) {
    const c = await one<{ id: number; kind: string; active: boolean }>('SELECT id, kind, active FROM office_parties WHERE id = $1', [cid]);
    if (!c || c.kind !== 'client') errors.push('That client was not found. Choose one from the list.');
    else if (!c.active && c.id !== opts.currentClientId) errors.push('That client is marked inactive. Choose another or make them active again first.');
    else client = { id: cid };
  } else if (newClient) {
    if (newClient.length < 2) errors.push('The new client\'s name is too short.');
    else client = { name: newClient, kind: 'client', phone: orNull(form.new_client_phone.slice(0, 40)) };
  } else if (form.client_id === '__new') errors.push('Type the new client\'s name.');
  else errors.push('Choose the client (or type a new client\'s name).');

  const measure = (label: string, raw: string, max: number, integer = false): number | null => {
    if (raw === '') return null;
    const n = parseNum(raw);
    if (n === null) {
      errors.push(`${label}: "${raw}" is not a number.`);
      return null;
    }
    if (n < 0) {
      errors.push(`${label} cannot be negative.`);
      return null;
    }
    if (n >= max) {
      errors.push(`${label} is too large.`);
      return null;
    }
    if (integer && !Number.isInteger(n)) {
      errors.push(`${label} must be a whole number.`);
      return null;
    }
    return n;
  };
  const pieces = measure('Pieces / cartons', form.pieces, 1e9, true);
  const weight_kg = measure('Weight (kg)', form.weight_kg, 1e10);
  const chargeable_kg = measure('Chargeable weight (kg)', form.chargeable_kg, 1e10);
  const cbm = measure('CBM', form.cbm, 1e9);

  const charges: ParsedLine[] = [];
  const costs: ParsedLine[] = [];
  const payeeIds = new Set<number>();

  const lines = (kind: 'charge' | 'cost', list: LineForm[], out: ParsedLine[]) => {
    list.forEach((l, i) => {
      const label = `${kind === 'charge' ? 'Charge' : 'Cost'} line ${i + 1}`;
      const description = orNull(l.description.slice(0, 300));
      const named = description ? `${label} (${description})` : label;
      const qty = parseNum(l.qty);
      const rate = parseNum(l.rate);
      let amount = parseNum(l.amount);
      const before = errors.length;
      if (l.qty && qty === null) errors.push(`${named}: the quantity "${l.qty}" is not a number.`);
      if (l.rate && rate === null) errors.push(`${named}: the rate "${l.rate}" is not a number.`);
      if (l.amount && amount === null) errors.push(`${named}: the amount "${l.amount}" is not a number.`);

      // Payee (costs only): from the list, or a new name typed on the line.
      let payee: PartyRef | null = null;
      if (kind === 'cost') {
        const pid = parseId(l.payee_id);
        const newName = l.new_payee.slice(0, 120);
        if (pid && newName) errors.push(`${named}: choose who it is paid to from the list or type a new name — not both.`);
        else if (pid) {
          payee = { id: pid };
          payeeIds.add(pid);
        } else if (newName) {
          if (newName.length < 2) errors.push(`${named}: the new payee's name is too short.`);
          const k = PAYEE_KINDS.includes(l.new_payee_kind as PartyKind) ? (l.new_payee_kind as PartyKind) : defaultPayeeKind(l.category);
          payee = { name: newName, kind: k, phone: null };
        } else if (l.payee_id === '__new') errors.push(`${named}: type the new payee's name.`);
      }

      // No money typed at all → the line is left out (e.g. a template line not needed this time).
      if (errors.length === before && amount === null && rate === null && !l.amount && !l.rate && !payee) {
        if (description) skipped.push(`${kind === 'charge' ? 'charge' : 'cost'} "${description}"`);
        return;
      }

      if (amount === null && errors.length === before) {
        if (qty !== null && rate !== null) amount = round2(qty * rate);
        else errors.push(`${named}: enter the amount, or both the quantity and the rate.`);
      }
      if (qty !== null && qty < 0) errors.push(`${named}: the quantity cannot be negative.`);
      if (qty !== null && Math.abs(qty) >= 1e11) errors.push(`${named}: the quantity is too large.`);
      if (rate !== null && Math.abs(rate) >= 1e10) errors.push(`${named}: the rate is too large.`);
      if (amount !== null && Math.abs(amount) >= 1e12) errors.push(`${named}: the amount is too large.`);

      if (kind === 'charge') {
        if (!description) errors.push(`${label}: describe the charge (e.g. "Air freight"). It is printed on the invoice.`);
        if (amount !== null && amount < 0 && !/discount/i.test(description ?? ''))
          errors.push(`${named}: a charge can only be negative if it is a discount — put the word "Discount" in its description.`);
      } else {
        if (!(l.category in COST_CATEGORIES)) errors.push(`${named}: choose what the cost is for.`);
        if ((amount !== null && amount < 0) || (rate !== null && rate < 0))
          errors.push(`${named}: a cost cannot be negative. If a partner gave money back, record it as a payment received from them.`);
      }

      const currency = l.currency.toUpperCase();
      let per_usd: number | null = null;
      if (!(currency in rates)) errors.push(`${named}: the currency "${l.currency}" is not set up. Add it under Settings first.`);
      else if (currency === 'USD') per_usd = 1; // a dollar is always a dollar
      else {
        per_usd = l.per_usd === '' ? rates[currency] : parseNum(l.per_usd);
        if (per_usd === null || !(per_usd > 0) || per_usd >= 1e12) {
          errors.push(`${named}: the rate per US dollar must be a number above 0 (today's rate for ${currency} is ${rates[currency]}).`);
          per_usd = null;
        } else {
          const d = rates[currency];
          if (d > 0 && (per_usd < d / 2 || per_usd > d * 2))
            warnings.push(`${named} uses ${fmtNum(per_usd, 6)} ${currency} to the dollar — today's rate is ${fmtNum(d, 6)}. Check it is right.`);
        }
      }

      if (errors.length !== before || amount === null || per_usd === null) return;
      amount = round2(amount);
      out.push({
        description,
        qty,
        unit: kind === 'charge' ? (l.unit in CHARGE_UNITS ? l.unit : 'fixed') : null,
        rate,
        amount,
        currency,
        per_usd,
        usd: toUsd(amount, per_usd),
        category: kind === 'cost' ? l.category : '',
        payee,
      });
    });
  };
  lines('charge', state.charges, charges);
  lines('cost', state.costs, costs);

  // Payees picked from the list must exist and not be clients.
  if (payeeIds.size) {
    const found = await q<{ id: number; kind: string }>('SELECT id, kind FROM office_parties WHERE id = ANY($1::int[])', [[...payeeIds]]);
    const ok = new Set(found.filter((p) => p.kind !== 'client').map((p) => p.id));
    for (const id of payeeIds) if (!ok.has(id)) errors.push('One of the payees chosen on the cost lines was not found. Choose again.');
  }

  if (errors.length || !service || !ship_date || !status || !client) return { errors: [...new Set(errors)], warnings, skipped, data: null };
  return {
    errors: [],
    warnings,
    skipped,
    data: {
      service,
      ship_date,
      client,
      origin: orNull(form.origin.slice(0, 100)),
      destination: orNull(form.destination.slice(0, 100)),
      goods: orNull(form.goods.slice(0, 500)),
      pieces,
      weight_kg,
      chargeable_kg,
      cbm,
      awb_no: orNull(form.awb_no.slice(0, 60)),
      tracking_no: orNull(form.tracking_no.slice(0, 60)),
      status,
      notes: orNull(form.notes.slice(0, 2000)),
      version: orNull(form.version),
      charges,
      costs,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

async function createParty(p: { name: string; kind: PartyKind; phone: string | null }, userId: number, t: Runner): Promise<number> {
  const dup = await one<{ id: number; kind: string }>(
    `SELECT id, kind FROM office_parties
      WHERE lower(btrim(name)) = lower(btrim($1)) AND ${p.kind === 'client' ? "kind = 'client'" : "kind <> 'client'"}
      LIMIT 1`,
    [p.name],
    t,
  );
  if (dup) {
    throw new ShipmentError(
      p.kind === 'client'
        ? `A client called "${p.name}" already exists. Choose them from the client list (or add something to tell them apart, like their city).`
        : `"${p.name}" already exists (${PARTY_KINDS[dup.kind as PartyKind] ?? dup.kind}). Choose them from the "Paid to" list instead of typing the name.`,
    );
  }
  const row = await one<{ id: number }>(
    `INSERT INTO office_parties (name, kind, phone, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
    [p.name, p.kind, p.phone, userId],
    t,
  );
  await logActivity(userId, 'party_created', 'party', row!.id, `${p.name} (${PARTY_KINDS[p.kind]}) — added from a shipment`, t);
  return row!.id;
}

async function insertLines(shipmentId: number, d: ParsedShipment, userId: number, t: Runner): Promise<void> {
  let sort = 0;
  for (const c of d.charges) {
    await q(
      `INSERT INTO office_charges (shipment_id, description, qty, unit, rate, amount, currency, per_usd, usd, sort)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [shipmentId, c.description, c.qty, c.unit, c.rate, c.amount, c.currency, c.per_usd, c.usd, sort++],
      t,
    );
  }
  // A new payee typed on two lines (same truck owner, two trucks) is created once.
  const made = new Map<string, number>();
  sort = 0;
  for (const c of d.costs) {
    let payeeId: number | null = null;
    if (c.payee && 'id' in c.payee) payeeId = c.payee.id;
    else if (c.payee) {
      const key = c.payee.name.trim().toLowerCase();
      payeeId = made.get(key) ?? (await createParty(c.payee, userId, t));
      made.set(key, payeeId);
    }
    await q(
      `INSERT INTO office_costs (shipment_id, category, payee_id, description, qty, rate, amount, currency, per_usd, usd, sort)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [shipmentId, c.category, payeeId, c.description, c.qty, c.rate, c.amount, c.currency, c.per_usd, c.usd, sort++],
      t,
    );
  }
}

export interface SaveResult {
  id: number;
  ref: string;
  invoiceNumber: string | null;
  invoiceCreated: boolean;
  /** notes for the person, e.g. "the old client's payments were not moved" */
  notes: string[];
}

const sumUsd = (lines: { usd: number }[]) => round2(lines.reduce((a, l) => a + l.usd, 0));

/**
 * Save a new shipment (existingId undefined) or replace an existing one's
 * details and lines — all in ONE transaction, with the invoice and the
 * activity log, so nothing is ever half saved.
 */
export async function saveShipment(d: ParsedShipment, userId: number, existingId?: number): Promise<SaveResult> {
  return tx(async (t) => {
    const notes: string[] = [];
    let prev: { id: number; ref: string; client_id: number | null; client_name: string | null; status: string; version: string; billed: number } | null = null;
    if (existingId) {
      prev = await one(
        `SELECT s.id, s.ref, s.client_id, p.name AS client_name, s.status,
                (extract(epoch FROM s.updated_at) * 1000000)::bigint::text AS version,
                (SELECT COALESCE(SUM(usd), 0) FROM office_charges WHERE shipment_id = s.id) AS billed
           FROM office_shipments s LEFT JOIN office_parties p ON p.id = s.client_id
          WHERE s.id = $1 FOR UPDATE OF s`,
        [existingId],
        t,
      );
      if (!prev) throw new ShipmentError('This shipment no longer exists — someone may have deleted it.');
      if (d.version && d.version !== prev.version)
        throw new ShipmentError(
          'Someone else changed this shipment while you were editing it, so your changes were NOT saved (to avoid overwriting theirs). Open the shipment again to see the latest version, then make your changes.',
        );
    }

    // Client
    let clientId: number;
    let clientName: string;
    if ('id' in d.client) {
      const c = await one<{ id: number; name: string }>("SELECT id, name FROM office_parties WHERE id = $1 AND kind = 'client'", [d.client.id], t);
      if (!c) throw new ShipmentError('That client was not found. Choose one from the list.');
      clientId = c.id;
      clientName = c.name;
    } else {
      clientId = await createParty(d.client, userId, t);
      clientName = d.client.name;
      notes.push(`New client "${clientName}" added.`);
    }

    const fields = [
      d.service, clientId, d.ship_date, d.origin, d.destination, d.goods, d.pieces, d.weight_kg, d.chargeable_kg,
      d.cbm, d.awb_no, d.tracking_no, d.status, d.notes,
    ];
    let id: number;
    let ref: string;
    if (!prev) {
      ref = await nextShipmentRef(Number(d.ship_date.slice(0, 4)), t);
      const row = await one<{ id: number }>(
        `INSERT INTO office_shipments (service, client_id, ship_date, origin, destination, goods, pieces, weight_kg,
                                       chargeable_kg, cbm, awb_no, tracking_no, status, notes, ref, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
        [...fields, ref, userId],
        t,
      );
      id = row!.id;
    } else {
      id = prev.id;
      ref = prev.ref;
      await q(
        `UPDATE office_shipments SET service = $1, client_id = $2, ship_date = $3, origin = $4, destination = $5, goods = $6,
                pieces = $7, weight_kg = $8, chargeable_kg = $9, cbm = $10, awb_no = $11, tracking_no = $12, status = $13,
                notes = $14, updated_at = now()
          WHERE id = $15`,
        [...fields, id],
        t,
      );
      await q('DELETE FROM office_charges WHERE shipment_id = $1', [id], t);
      await q('DELETE FROM office_costs WHERE shipment_id = $1', [id], t);
    }
    await insertLines(id, d, userId, t);

    const hadInvoice = await one<{ number: string }>('SELECT number FROM office_invoices WHERE shipment_id = $1', [id], t);
    const inv = await ensureInvoice(id, userId, t);

    const billed = sumUsd(d.charges);
    if (!prev) {
      await logActivity(
        userId,
        'shipment_created',
        'shipment',
        id,
        `${ref} · ${SERVICES[d.service].short} · ${clientName} · billed ${usd(billed)} (${d.charges.length} charge${d.charges.length === 1 ? '' : 's'}, ${d.costs.length} cost line${d.costs.length === 1 ? '' : 's'})`,
        t,
      );
    } else {
      const changes: string[] = [];
      if (prev.client_id !== clientId) changes.push(`client ${prev.client_name ?? '—'} → ${clientName}`);
      if (prev.status !== d.status) changes.push(`status ${SHIPMENT_STATUS[prev.status as ShipmentStatus] ?? prev.status} → ${SHIPMENT_STATUS[d.status]}`);
      if (round2(prev.billed) !== billed) changes.push(`billed ${usd(prev.billed)} → ${usd(billed)}`);
      changes.push(`${d.charges.length} charge${d.charges.length === 1 ? '' : 's'}, ${d.costs.length} cost line${d.costs.length === 1 ? '' : 's'}`);
      await logActivity(userId, 'shipment_updated', 'shipment', id, `${ref}: ${changes.join('; ')}`, t);

      if (prev.client_id !== null && prev.client_id !== clientId) {
        const paid = await one<{ n: number; usd: number }>(
          `SELECT COUNT(*) AS n, COALESCE(SUM(usd), 0) AS usd FROM office_payments
            WHERE shipment_id = $1 AND direction = 'in' AND party_id = $2`,
          [id, prev.client_id],
          t,
        );
        if (paid && paid.n > 0) {
          notes.push(
            `Note: ${paid.n} payment${paid.n === 1 ? '' : 's'} received for this shipment (${usd(paid.usd)}) ${paid.n === 1 ? 'is' : 'are'} still recorded as paid by ${prev.client_name ?? 'the old client'}, so ${prev.client_name ?? 'they'} now show${paid.n === 1 ? 's' : ''} that much in credit. If ${clientName} made ${paid.n === 1 ? 'that payment' : 'those payments'}, change the payer on the payment${paid.n === 1 ? '' : 's'} too.`,
          );
        }
      }
    }
    return {
      id,
      ref,
      invoiceNumber: inv?.number ?? hadInvoice?.number ?? null,
      invoiceCreated: !hadInvoice && !!inv,
      notes,
    };
  });
}

/** Read, check and save a posted shipment form. Returns what the page needs either way. */
export async function submitShipment(
  fd: FormData,
  userId: number,
  existing?: { id: number; client_id: number | null },
): Promise<{ ok: true; id: number; message: string } | { ok: false; errors: string[]; state: FormState }> {
  const state = readForm(fd);
  const rates = await rateMap();
  const checked = await checkForm(state, rates, { currentClientId: existing?.client_id ?? null });
  if (!checked.data) return { ok: false, errors: checked.errors, state };
  try {
    const r = await saveShipment(checked.data, userId, existing?.id);
    const parts = [`Shipment ${r.ref} saved.`];
    if (r.invoiceCreated && r.invoiceNumber) parts.push(`Invoice ${r.invoiceNumber} is ready.`);
    if (!checked.data.charges.length) parts.push('It has no charges yet, so there is nothing to invoice.');
    parts.push(...r.notes);
    if (checked.skipped.length)
      parts.push(`Left out (no amount entered): ${checked.skipped.join(', ')}.`);
    parts.push(...checked.warnings);
    return { ok: true, id: r.id, message: parts.join(' ') };
  } catch (e) {
    if (e instanceof ShipmentError) return { ok: false, errors: [e.message], state };
    throw e;
  }
}

/** Quick status change from the shipment page. */
export async function setShipmentStatus(id: number, status: ShipmentStatus, userId: number): Promise<string> {
  return tx(async (t) => {
    const s = await one<{ ref: string; status: ShipmentStatus }>('SELECT ref, status FROM office_shipments WHERE id = $1 FOR UPDATE', [id], t);
    if (!s) throw new ShipmentError('This shipment no longer exists.');
    if (s.status === status) return `${s.ref} is already "${SHIPMENT_STATUS[status]}".`;
    await q('UPDATE office_shipments SET status = $1, updated_at = now() WHERE id = $2', [status, id], t);
    await logActivity(userId, 'shipment_status', 'shipment', id, `${s.ref}: ${SHIPMENT_STATUS[s.status]} → ${SHIPMENT_STATUS[status]}`, t);
    return `${s.ref} is now "${SHIPMENT_STATUS[status]}".`;
  });
}

/**
 * Delete a shipment with its charges, costs and invoice (admin only — the
 * page checks). Refused while any payment points at it: those are real money
 * movements and must be dealt with first.
 */
export async function deleteShipment(id: number, userId: number): Promise<string> {
  return tx(async (t) => {
    const s = await one<{ ref: string; client_name: string | null; invoice: string | null }>(
      `SELECT s.ref, p.name AS client_name, i.number AS invoice
         FROM office_shipments s
         LEFT JOIN office_parties p ON p.id = s.client_id
         LEFT JOIN office_invoices i ON i.shipment_id = s.id
        WHERE s.id = $1 FOR UPDATE OF s`,
      [id],
      t,
    );
    if (!s) throw new ShipmentError('This shipment no longer exists.');
    const pays = await one<{ n: number }>('SELECT COUNT(*) AS n FROM office_payments WHERE shipment_id = $1', [id], t);
    if ((pays?.n ?? 0) > 0)
      throw new ShipmentError(
        `${s.ref} cannot be deleted: ${pays!.n} payment${pays!.n === 1 ? ' is' : 's are'} linked to it. Those are real money records — delete them or link them to another shipment first.`,
      );
    const fig = await one<{ billed: number; cost: number }>(
      `SELECT (SELECT COALESCE(SUM(usd), 0) FROM office_charges WHERE shipment_id = $1) AS billed,
              (SELECT COALESCE(SUM(usd), 0) FROM office_costs WHERE shipment_id = $1) AS cost`,
      [id],
      t,
    );
    await q('DELETE FROM office_shipments WHERE id = $1', [id], t); // charges, costs and invoice go with it (cascade)
    await logActivity(
      userId,
      'shipment_deleted',
      'shipment',
      id,
      `${s.ref} · ${s.client_name ?? 'no client'}${s.invoice ? ` · invoice ${s.invoice}` : ''} · billed ${usd(fig?.billed ?? 0)}, cost ${usd(fig?.cost ?? 0)}`,
      t,
    );
    return `Shipment ${s.ref} was deleted${s.invoice ? `, with invoice ${s.invoice}` : ''}.`;
  });
}

/* ------------------------------------------------------------------ */
/* Small display helpers                                               */
/* ------------------------------------------------------------------ */

/** "Kandahar → Dubai", or whatever part is known. */
export function routeText(s: { origin: string | null; destination: string | null }): string {
  if (s.origin && s.destination) return `${s.origin} → ${s.destination}`;
  return s.origin || s.destination || '—';
}

/** "120 kg" / "3.5 CBM" / "120 kg · 3.5 CBM" — the billing measure of a shipment. */
export function measureText(s: { weight_kg: number | null; chargeable_kg: number | null; cbm: number | null }): string {
  const kg = s.chargeable_kg ?? s.weight_kg;
  const parts: string[] = [];
  if (kg !== null) parts.push(`${fmtNum(kg)} kg`);
  if (s.cbm !== null) parts.push(`${fmtNum(s.cbm, 3)} CBM`);
  return parts.join(' · ') || '—';
}
