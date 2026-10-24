/**
 * Importing old records from spreadsheets (CSV).
 *
 * One file per kind of record. Import order matters, because later files
 * refer to earlier ones by name or reference:
 *   accounts → parties → shipments → charges → costs → payments → expenses → transfers
 *
 * Several kinds can also come together: several files at once, or one
 * "bundle" file in which each kind's rows follow a line such as "#shipments".
 * They are put in the order above and checked as a whole.
 *
 * Every file is checked row by row first (preview); then the rows without
 * problems are saved in ONE transaction — all of them, or none if anything
 * fails while saving. Rows are saved in batches, a few statements per kind,
 * so a large import does not run past the server's time limit when the
 * database is far away.
 */
import { q, one, tx, type Runner } from './db';
import { toUsd, round2, rateMap } from './money';
import { SERVICES, COST_CATEGORIES, PARTY_KINDS, ACCOUNT_TYPES, EXPENSE_CATEGORIES, SHIPMENT_STATUS } from './services';
import { METHODS } from './money';
import { nextShipmentRef, getSettings } from './settings';
import { ensureInvoice } from './invoices';
import { logActivity } from './activity';

/**
 * Numbers as spreadsheets write them, in either convention:
 *   1,250.50   1.250,50   1250,5   1,000   12 700   -50
 * When both "." and "," appear, the last one is the decimal point. A lone
 * comma is a thousands separator only in the exact 1,000 / 12,500,000 shape;
 * otherwise (3,5 or 1250,50) it is a decimal comma.
 */
export function parseNumber(v: string): number | null {
  let t = v.trim().replace(/[\s\u00A0']/g, '');
  if (!t) return null;
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    t = lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (lastComma >= 0) {
    t = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(/,(?=\d+$)/, '.');
  } else if ((t.match(/\./g) ?? []).length > 1) {
    t = t.replace(/\./g, ''); // 1.250.000
  }
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/** Parse CSV / semicolon / tab separated text. Handles quotes, "" escapes, CRLF and a BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delim = [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** "2026-03-15", "15/03/2026", "15-03-2026", "15.03.2026" → "2026-03-15" (day first). */
export function parseDate(v: string): string | null {
  const t = v.trim();
  let y: number, m: number, d: number;
  let mt = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (mt) [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else if ((mt = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [d, m, y] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === iso ? iso : null;
}

/** Match a key or its label, ignoring case and spacing: "Tashkent Air" → "tashkent". */
function matchEnum(v: string, map: Record<string, string | { short?: string; label?: string }>): string | null {
  const t = norm(v);
  if (!t) return null;
  for (const [k, lab] of Object.entries(map)) {
    const labels = typeof lab === 'string' ? [lab] : [lab.short ?? '', lab.label ?? ''];
    if (norm(k) === t || labels.some((l) => l && norm(l) === t)) return k;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Kinds and their columns                                             */
/* ------------------------------------------------------------------ */

export type ImportKind = 'accounts' | 'parties' | 'shipments' | 'charges' | 'costs' | 'payments' | 'expenses' | 'transfers';

interface Col {
  key: string;
  required?: boolean;
  help: string;
}

const SVC_LABELS = Object.fromEntries(Object.entries(SERVICES).map(([k, s]) => [k, { short: s.short, label: s.label }]));

export const KINDS: Record<ImportKind, { label: string; what: string; cols: Col[]; example: string[][] }> = {
  accounts: {
    label: 'Cash boxes & accounts',
    what: 'Where money sits: cash boxes, bank accounts, sarafs. Import these first.',
    cols: [
      { key: 'name', required: true, help: 'e.g. Cash box Kandahar (USD)' },
      { key: 'type', help: 'cash, bank, sarafi, hawala or other (default cash)' },
      { key: 'currency', required: true, help: 'USD, AFN, AED, CNY, UZS, PKR…' },
      { key: 'opening_balance', help: 'money in it on the opening date (default 0)' },
      { key: 'opening_date', help: 'YYYY-MM-DD or DD/MM/YYYY' },
    ],
    example: [['Cash box Kandahar (USD)', 'cash', 'USD', '2500', '2026-01-01'], ['Sarafi Tashkent', 'sarafi', 'USD', '0', '2026-01-01']],
  },
  parties: {
    label: 'Clients & partners',
    what: 'Everyone money moves to or from. Shipments and payments find them by name.',
    cols: [
      { key: 'name', required: true, help: 'as you want it to appear' },
      { key: 'kind', help: 'client, agent, carrier, airline, sarafi, supplier, staff, other (default client)' },
      { key: 'phone', help: '' },
      { key: 'city', help: '' },
      { key: 'country', help: '' },
      { key: 'notes', help: '' },
    ],
    example: [['Haji Gul Dry Fruit Traders', 'client', '+93 70 123 4567', 'Kandahar', 'Afghanistan', ''], ['Rahim Khan — Kabul agent', 'agent', '+93 79 210 4411', 'Kabul', 'Afghanistan', 'UPS route']],
  },
  shipments: {
    label: 'Shipments',
    what: 'One row per shipment. Leave ref empty to get a new number; keep your old number by filling it in.',
    cols: [
      { key: 'ref', help: 'your old shipment number (optional)' },
      { key: 'service', required: true, help: 'ups, china, tashkent, kabul_air or other (or its name, e.g. "Tashkent Air")' },
      { key: 'ship_date', required: true, help: 'YYYY-MM-DD or DD/MM/YYYY' },
      { key: 'client_name', required: true, help: 'matched by name' },
      { key: 'origin', help: '' },
      { key: 'destination', help: '' },
      { key: 'goods', help: '' },
      { key: 'pieces', help: 'cartons / pieces' },
      { key: 'weight_kg', help: '' },
      { key: 'chargeable_kg', help: '' },
      { key: 'cbm', help: '' },
      { key: 'awb_no', help: 'airway bill number' },
      { key: 'tracking_no', help: 'UPS tracking number' },
      { key: 'status', help: 'booked, in_transit, arrived, delivered, cancelled (default delivered)' },
      { key: 'notes', help: '' },
    ],
    example: [['AML-OLD-101', 'tashkent', '12/03/2026', 'Haji Gul Dry Fruit Traders', 'Kandahar', 'Tashkent → Delhi', 'Dried figs', '40', '1000', '1000', '', '157-12345678', '', 'delivered', '']],
  },
  charges: {
    label: 'Shipment charges (what clients were billed)',
    what: 'One row per billed line. Each shipment with charges gets its invoice automatically.',
    cols: [
      { key: 'shipment_ref', required: true, help: 'must match a shipment ref' },
      { key: 'description', required: true, help: '' },
      { key: 'qty', help: '' },
      { key: 'unit', help: 'kg, cbm, pcs or fixed' },
      { key: 'rate', help: 'price per unit' },
      { key: 'amount', help: 'total; worked out from qty × rate when empty' },
      { key: 'currency', help: 'default USD' },
      { key: 'per_usd', help: 'how many of that currency per 1 USD on the day; default from Settings' },
      { key: 'invoice_no', help: 'your old invoice number for this shipment, to keep it (optional; otherwise a new number)' },
    ],
    example: [['AML-OLD-101', 'Air freight via Tashkent', '1000', 'kg', '3.10', '3100', 'USD', '1', 'INV-OLD-77']],
  },
  costs: {
    label: 'Shipment costs (what we owe partners)',
    what: 'One row per cost line, with the partner it is owed to.',
    cols: [
      { key: 'shipment_ref', required: true, help: 'must match a shipment ref' },
      { key: 'category', help: `${Object.keys(COST_CATEGORIES).join(', ')} (default other)` },
      { key: 'payee_name', help: 'partner we owe it to, matched by name' },
      { key: 'description', help: '' },
      { key: 'qty', help: '' },
      { key: 'rate', help: '' },
      { key: 'amount', help: 'total; qty × rate when empty' },
      { key: 'currency', help: 'default USD' },
      { key: 'per_usd', help: 'default from Settings' },
    ],
    example: [['AML-OLD-101', 'truck', 'Abdul Wahid — truck', 'Truck Kandahar → Hairatan', '1', '32000', '32000', 'AFN', '70']],
  },
  payments: {
    label: 'Payments received & made',
    what: 'Money in from clients (direction in) and out to partners (direction out).',
    cols: [
      { key: 'pay_date', required: true, help: 'YYYY-MM-DD or DD/MM/YYYY' },
      { key: 'direction', required: true, help: 'in (received) or out (paid)' },
      { key: 'party_name', required: true, help: 'matched by name' },
      { key: 'account_name', required: true, help: 'must match a cash box / account; the currency is the account\'s' },
      { key: 'amount', required: true, help: 'in the account\'s currency' },
      { key: 'per_usd', help: 'default from Settings' },
      { key: 'method', help: 'cash, hawala, bank, sarafi, other (default cash)' },
      { key: 'reference', help: 'hawala code, bank ref…' },
      { key: 'shipment_ref', help: 'optional link to a shipment' },
      { key: 'notes', help: '' },
    ],
    example: [['20/03/2026', 'in', 'Haji Gul Dry Fruit Traders', 'Sarafi Tashkent', '3100', '1', 'sarafi', 'SRF-221', 'AML-OLD-101', '']],
  },
  expenses: {
    label: 'Office expenses',
    what: 'Rent, salaries, internet and other running costs.',
    cols: [
      { key: 'exp_date', required: true, help: 'YYYY-MM-DD or DD/MM/YYYY' },
      { key: 'category', help: `${Object.keys(EXPENSE_CATEGORIES).join(', ')} (default other)` },
      { key: 'description', help: '' },
      { key: 'account_name', required: true, help: 'paid from this cash box / account' },
      { key: 'amount', required: true, help: 'in the account\'s currency' },
      { key: 'per_usd', help: 'default from Settings' },
      { key: 'method', help: 'default cash' },
      { key: 'reference', help: '' },
    ],
    example: [['02/03/2026', 'rent', 'Office rent March', 'Cash box Kandahar (USD)', '600', '1', 'cash', '']],
  },
  transfers: {
    label: 'Transfers between accounts',
    what: 'Hawala and other moves of money between your own accounts.',
    cols: [
      { key: 'tr_date', required: true, help: 'YYYY-MM-DD or DD/MM/YYYY' },
      { key: 'from_account', required: true, help: '' },
      { key: 'to_account', required: true, help: '' },
      { key: 'amount_out', required: true, help: 'what left, in the from-account\'s currency' },
      { key: 'per_usd_out', help: 'default from Settings' },
      { key: 'amount_in', help: 'what arrived, in the to-account\'s currency (default: same as out)' },
      { key: 'per_usd_in', help: 'default from Settings' },
      { key: 'reference', help: '' },
    ],
    example: [['18/03/2026', 'Sarafi Tashkent', 'Cash box Kandahar (USD)', '5000', '1', '4950', '1', 'HW-T221']],
  },
};

export const KIND_ORDER: ImportKind[] = ['accounts', 'parties', 'shipments', 'charges', 'costs', 'payments', 'expenses', 'transfers'];

export function isKind(k: string | null): k is ImportKind {
  return !!k && Object.prototype.hasOwnProperty.call(KINDS, k);
}

/** The template file: header row + example rows. */
export function templateCsv(kind: ImportKind): string {
  const k = KINDS[kind];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return '﻿' + [k.cols.map((c) => c.key), ...k.example].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

/* ------------------------------------------------------------------ */
/* Checking                                                            */
/* ------------------------------------------------------------------ */

export interface CheckedRow {
  line: number;
  values: Record<string, string>;
  /** What will be saved, in words, for the preview. */
  preview: string;
  errors: string[];
  /** Ready-to-save data when there are no errors. */
  data?: Record<string, unknown>;
}

export interface CheckResult {
  kind: ImportKind;
  headerProblems: string[];
  rows: CheckedRow[];
  /** Names that will be created as new clients/partners. */
  newParties: { name: string; kind: string }[];
}

interface Lookups {
  parties: Map<string, { id: number; kind: string }>;
  accounts: Map<string, { id: number; currency: string }>;
  shipments: Map<string, number>;
  currencies: Record<string, number>;
  /** Invoice number (lower case) → its shipment, and shipment → its invoice number. */
  invoices: Map<string, number>;
  invoiceOf: Map<number, string>;
  /** Payments and expenses already saved, as "same record" keys, so a file imported twice is not counted twice. */
  paymentKeys: Set<string>;
  expenseKeys: Set<string>;
}

const money2 = (n: unknown) => Number(n).toFixed(2);
const paymentKey = (d: { pay_date: unknown; direction: unknown; party_id: unknown; account_id: unknown; amount: unknown }) =>
  `${d.pay_date}|${d.direction}|${d.party_id}|${d.account_id}|${money2(d.amount)}`;
const expenseKey = (d: { exp_date: unknown; account_id: unknown; amount: unknown; category: unknown; description: unknown }) =>
  `${d.exp_date}|${d.account_id}|${money2(d.amount)}|${d.category}|${lk(String(d.description ?? ''))}`;

async function loadLookups(runner?: Runner): Promise<Lookups> {
  const key = (s: string) => s.trim().toLowerCase();
  const parties = new Map((await q<{ id: number; name: string; kind: string }>('SELECT id, name, kind FROM office_parties', [], runner)).map((p) => [key(p.name), { id: p.id, kind: p.kind }]));
  const accounts = new Map((await q<{ id: number; name: string; currency: string }>('SELECT id, name, currency FROM office_accounts', [], runner)).map((a) => [key(a.name), { id: a.id, currency: a.currency }]));
  const shipments = new Map((await q<{ id: number; ref: string }>('SELECT id, ref FROM office_shipments', [], runner)).map((s) => [key(s.ref), s.id]));
  const currencies = Object.fromEntries((await q<{ code: string; per_usd: number }>('SELECT code, per_usd FROM office_currencies', [], runner)).map((c) => [c.code, c.per_usd]));
  const inv = await q<{ number: string; shipment_id: number }>('SELECT number, shipment_id FROM office_invoices', [], runner);
  const invoices = new Map(inv.map((i) => [key(i.number), i.shipment_id]));
  const invoiceOf = new Map(inv.map((i) => [i.shipment_id, i.number]));
  const paymentKeys = new Set(
    (await q<{ pay_date: string; direction: string; party_id: number; account_id: number; amount: number }>('SELECT pay_date, direction, party_id, account_id, amount FROM office_payments', [], runner)).map(paymentKey),
  );
  const expenseKeys = new Set(
    (await q<{ exp_date: string; account_id: number; amount: number; category: string; description: string | null }>('SELECT exp_date, account_id, amount, category, description FROM office_expenses', [], runner)).map(expenseKey),
  );
  return { parties, accounts, shipments, currencies, invoices, invoiceOf, paymentKeys, expenseKeys };
}

const lk = (s: string) => s.trim().toLowerCase();

function kindForCost(category: string): string {
  return category === 'truck' ? 'carrier' : category === 'airline' ? 'airline' : 'agent';
}

/**
 * Check every row of a file. `createParties`: unknown client / partner names
 * become new parties instead of errors. `alreadyThere`: shipment refs (lower
 * case) that this import found already in the system, whose charges and costs
 * in the same import are then skipped rather than added a second time.
 */
export async function checkFile(kind: ImportKind, text: string, createParties: boolean, runner?: Runner, alreadyThere?: Set<string>): Promise<CheckResult> {
  const spec = KINDS[kind];
  const raw = parseCsv(text);
  const result: CheckResult = { kind, headerProblems: [], rows: [], newParties: [] };
  if (!raw.length) {
    result.headerProblems.push('The file is empty.');
    return result;
  }
  const header = raw[0].map(norm);
  const known = new Set(spec.cols.map((c) => c.key));
  for (const c of spec.cols) if (c.required && !header.includes(c.key)) result.headerProblems.push(`Missing column "${c.key}".`);
  const unknownCols = header.filter((h) => h && !known.has(h));
  if (unknownCols.length) result.headerProblems.push(`These columns are not used and will be ignored: ${unknownCols.join(', ')}.`);
  if (result.headerProblems.some((p) => p.startsWith('Missing'))) return result;

  const L = await loadLookups(runner);
  const newParty = new Map<string, string>(); // lower name → kind, from rows that will be saved
  let rowNewParties: [string, string][] = [];
  const seenInFile = new Set<string>();
  const invoiceInFile = new Map<string, number>(); // lower invoice number → shipment, for charges
  const fileInvoiceOf = new Map<number, string>(); // shipment → lower invoice number given in this file

  const partyFor = (name: string, kindIfNew: string, errors: string[]): { id?: number; name: string } | null => {
    if (!name) return null;
    const hit = L.parties.get(lk(name));
    if (hit) return { id: hit.id, name };
    if (!createParties) {
      errors.push(`No client/partner called "${name}". Import them first, or tick "create missing".`);
      return null;
    }
    rowNewParties.push([lk(name), kindIfNew]);
    return { name };
  };
  const money = (v: string, label: string, errors: string[], opts: { allowNegative?: boolean; required?: boolean } = {}) => {
    if (!v.trim()) {
      if (opts.required) errors.push(`${label} is missing.`);
      return null;
    }
    const n = parseNumber(v);
    if (n === null) errors.push(`${label} "${v}" is not a number.`);
    else if (n < 0 && !opts.allowNegative) errors.push(`${label} cannot be negative.`);
    else if (Math.abs(n) >= 1e12) errors.push(`${label} is too large.`);
    return n;
  };
  const rateFor = (v: string, cur: string, errors: string[], label = 'per_usd') => {
    if (cur === 'USD') return 1;
    if (!v.trim()) return L.currencies[cur] ?? null;
    const n = parseNumber(v);
    if (n === null || n <= 0) {
      errors.push(`${label} "${v}" must be a number above 0.`);
      return null;
    }
    return n;
  };

  raw.slice(1).forEach((cells, i) => {
    const values: Record<string, string> = {};
    header.forEach((h, j) => {
      if (known.has(h)) values[h] = (cells[j] ?? '').trim();
    });
    const v = (k: string) => values[k] ?? '';
    const errors: string[] = [];
    rowNewParties = [];
    for (const c of spec.cols) if (c.required && !v(c.key)) errors.push(`"${c.key}" is empty.`);
    let data: Record<string, unknown> = {};
    let preview = '';

    if (kind === 'accounts') {
      const type = v('type') ? matchEnum(v('type'), ACCOUNT_TYPES) : 'cash';
      if (!type) errors.push(`Unknown type "${v('type')}".`);
      const cur = v('currency').toUpperCase();
      if (cur && !(cur in L.currencies)) errors.push(`Unknown currency "${cur}" — add it in Settings first.`);
      const opening = money(v('opening_balance'), 'opening_balance', errors, { allowNegative: true }) ?? 0;
      const od = v('opening_date') ? parseDate(v('opening_date')) : null;
      if (v('opening_date') && !od) errors.push(`opening_date "${v('opening_date')}" is not a date.`);
      if (L.accounts.has(lk(v('name'))) || seenInFile.has(lk(v('name')))) errors.push(`An account called "${v('name')}" already exists.`);
      seenInFile.add(lk(v('name')));
      data = { name: v('name'), type, currency: cur, opening, opening_date: od };
      preview = `${v('name')} — ${type}, ${cur}, opening ${opening}`;
    } else if (kind === 'parties') {
      const pk = v('kind') ? matchEnum(v('kind'), PARTY_KINDS) : 'client';
      if (!pk) errors.push(`Unknown kind "${v('kind')}".`);
      if (L.parties.has(lk(v('name'))) || seenInFile.has(lk(v('name')))) errors.push(`"${v('name')}" already exists.`);
      seenInFile.add(lk(v('name')));
      data = { name: v('name'), kind: pk, phone: v('phone') || null, city: v('city') || null, country: v('country') || null, notes: v('notes') || null };
      preview = `${v('name')} (${pk})`;
    } else if (kind === 'shipments') {
      const service = matchEnum(v('service'), SVC_LABELS);
      if (v('service') && !service) errors.push(`Unknown service "${v('service')}".`);
      const date = parseDate(v('ship_date'));
      if (v('ship_date') && !date) errors.push(`ship_date "${v('ship_date')}" is not a date.`);
      const status = v('status') ? matchEnum(v('status'), SHIPMENT_STATUS) : 'delivered';
      if (!status) errors.push(`Unknown status "${v('status')}".`);
      const client = partyFor(v('client_name'), 'client', errors);
      const ref = v('ref');
      if (ref && L.shipments.has(lk(ref))) errors.push(`Shipment ${ref} already exists.`);
      else if (ref && seenInFile.has(lk(ref))) errors.push(`Shipment ${ref} appears twice in this file.`);
      if (ref) seenInFile.add(lk(ref));
      const nums: Record<string, number | null> = {};
      for (const f of ['pieces', 'weight_kg', 'chargeable_kg', 'cbm']) nums[f] = money(v(f), f, errors);
      data = { ref: ref || null, service, ship_date: date, client, origin: v('origin') || null, destination: v('destination') || null, goods: v('goods') || null, ...nums, pieces: nums.pieces === null ? null : Math.round(nums.pieces), awb_no: v('awb_no') || null, tracking_no: v('tracking_no') || null, status, notes: v('notes') || null };
      preview = `${ref || '(new number)'} · ${service ? SERVICES[service as keyof typeof SERVICES].short : '?'} · ${date ?? '?'} · ${v('client_name')}`;
    } else if (kind === 'charges' || kind === 'costs') {
      const sid = L.shipments.get(lk(v('shipment_ref')));
      if (v('shipment_ref') && !sid) errors.push(`No shipment ${v('shipment_ref')} — import shipments first.`);
      if (sid && alreadyThere?.has(lk(v('shipment_ref')))) errors.push(`${v('shipment_ref')} was already in the system before this import, so its lines here are skipped (imported before?).`);
      const cur = (v('currency') || 'USD').toUpperCase();
      if (!(cur in L.currencies)) errors.push(`Unknown currency "${cur}".`);
      const qty = money(v('qty'), 'qty', errors);
      const rate = money(v('rate'), 'rate', errors, { allowNegative: kind === 'charges' });
      let amount = money(v('amount'), 'amount', errors, { allowNegative: kind === 'charges' });
      if (amount === null && qty !== null && rate !== null) amount = round2(qty * rate);
      if (amount === null && rate !== null && qty === null) amount = rate;
      if (amount === null) errors.push('Give an amount (or qty and rate).');
      const per = rateFor(v('per_usd'), cur, errors);
      if (kind === 'charges') {
        const invNo = v('invoice_no');
        if (invNo && sid) {
          const taken = L.invoices.get(lk(invNo));
          const own = L.invoiceOf.get(sid);
          const inFile = invoiceInFile.get(lk(invNo));
          if (taken !== undefined && taken !== sid) errors.push(`Invoice number ${invNo} is already used by another shipment.`);
          else if (own && lk(own) !== lk(invNo)) errors.push(`${v('shipment_ref')} already has invoice ${own}.`);
          else if (inFile !== undefined && inFile !== sid) errors.push(`Invoice number ${invNo} is given to two shipments in this file.`);
          else if (fileInvoiceOf.has(sid) && fileInvoiceOf.get(sid) !== lk(invNo)) errors.push(`${v('shipment_ref')} is given two different invoice numbers in this file.`);
          else {
            invoiceInFile.set(lk(invNo), sid);
            fileInvoiceOf.set(sid, lk(invNo));
          }
        }
        data = { shipment_id: sid, description: v('description'), qty, unit: v('unit') || null, rate, amount, currency: cur, per_usd: per, invoice_no: invNo || null };
        preview = `${v('shipment_ref')} · ${v('description')} · ${amount ?? '?'} ${cur}${invNo ? ` · invoice ${invNo}` : ''}`;
      } else {
        const category = v('category') ? matchEnum(v('category'), COST_CATEGORIES) : 'other';
        if (!category) errors.push(`Unknown category "${v('category')}".`);
        const payee = partyFor(v('payee_name'), kindForCost(category ?? 'other'), errors);
        data = { shipment_id: sid, category, payee, description: v('description') || null, qty, rate, amount, currency: cur, per_usd: per };
        preview = `${v('shipment_ref')} · ${category} · ${v('payee_name') || 'no payee'} · ${amount ?? '?'} ${cur}`;
      }
    } else if (kind === 'payments') {
      const date = parseDate(v('pay_date'));
      if (v('pay_date') && !date) errors.push(`pay_date "${v('pay_date')}" is not a date.`);
      const dir = matchEnum(v('direction'), { in: 'received', out: 'paid' });
      if (v('direction') && !dir) errors.push(`direction must be "in" or "out".`);
      const party = partyFor(v('party_name'), dir === 'out' ? 'agent' : 'client', errors);
      const acc = L.accounts.get(lk(v('account_name')));
      if (v('account_name') && !acc) errors.push(`No account called "${v('account_name')}" — import accounts first.`);
      const amount = money(v('amount'), 'amount', errors, { required: true });
      if (amount === 0) errors.push('amount must be above 0.');
      const per = acc ? rateFor(v('per_usd'), acc.currency, errors) : null;
      const method = v('method') ? matchEnum(v('method'), METHODS) : 'cash';
      if (!method) errors.push(`Unknown method "${v('method')}".`);
      let sid: number | null = null;
      if (v('shipment_ref')) {
        sid = L.shipments.get(lk(v('shipment_ref'))) ?? null;
        if (!sid) errors.push(`No shipment ${v('shipment_ref')}.`);
      }
      if (party?.id && acc && date && dir && amount !== null && L.paymentKeys.has(paymentKey({ pay_date: date, direction: dir, party_id: party.id, account_id: acc.id, amount })))
        errors.push('This payment is already in the system (same date, person, account and amount), so it is skipped. If it really happened twice, enter the second one by hand.');
      data = { direction: dir, pay_date: date, party, account_id: acc?.id, currency: acc?.currency, amount, per_usd: per, method, reference: v('reference') || null, shipment_id: sid, notes: v('notes') || null };
      preview = `${date ?? '?'} · ${dir === 'in' ? 'received from' : 'paid to'} ${v('party_name')} · ${amount ?? '?'} ${acc?.currency ?? ''} · ${v('account_name')}`;
    } else if (kind === 'expenses') {
      const date = parseDate(v('exp_date'));
      if (v('exp_date') && !date) errors.push(`exp_date "${v('exp_date')}" is not a date.`);
      const category = v('category') ? matchEnum(v('category'), EXPENSE_CATEGORIES) : 'other';
      if (!category) errors.push(`Unknown category "${v('category')}".`);
      const acc = L.accounts.get(lk(v('account_name')));
      if (v('account_name') && !acc) errors.push(`No account called "${v('account_name')}".`);
      const amount = money(v('amount'), 'amount', errors, { required: true });
      if (amount === 0) errors.push('amount must be above 0.');
      const per = acc ? rateFor(v('per_usd'), acc.currency, errors) : null;
      const method = v('method') ? matchEnum(v('method'), METHODS) : 'cash';
      if (!method) errors.push(`Unknown method "${v('method')}".`);
      if (acc && date && amount !== null && L.expenseKeys.has(expenseKey({ exp_date: date, account_id: acc.id, amount, category, description: v('description') || null })))
        errors.push('This expense is already in the system (same date, account, amount and description), so it is skipped.');
      data = { exp_date: date, category, description: v('description') || null, account_id: acc?.id, currency: acc?.currency, amount, per_usd: per, method, reference: v('reference') || null };
      preview = `${date ?? '?'} · ${category} · ${amount ?? '?'} ${acc?.currency ?? ''}`;
    } else if (kind === 'transfers') {
      const date = parseDate(v('tr_date'));
      if (v('tr_date') && !date) errors.push(`tr_date "${v('tr_date')}" is not a date.`);
      const from = L.accounts.get(lk(v('from_account')));
      const to = L.accounts.get(lk(v('to_account')));
      if (v('from_account') && !from) errors.push(`No account called "${v('from_account')}".`);
      if (v('to_account') && !to) errors.push(`No account called "${v('to_account')}".`);
      if (from && to && from.id === to.id) errors.push('From and to are the same account.');
      const out = money(v('amount_out'), 'amount_out', errors, { required: true });
      const inn = money(v('amount_in'), 'amount_in', errors) ?? (from && to && from.currency === to.currency ? out : null);
      if (inn === null && from && to) errors.push('amount_in is needed when the two accounts use different currencies.');
      if (out === 0 || inn === 0) errors.push('Amounts must be above 0.');
      const perOut = from ? rateFor(v('per_usd_out'), from.currency, errors, 'per_usd_out') : null;
      const perIn = to ? rateFor(v('per_usd_in'), to.currency, errors, 'per_usd_in') : null;
      data = { tr_date: date, from_account: from?.id, to_account: to?.id, amount_out: out, per_usd_out: perOut, amount_in: inn, per_usd_in: perIn, reference: v('reference') || null };
      preview = `${date ?? '?'} · ${v('from_account')} → ${v('to_account')} · ${out ?? '?'} → ${inn ?? '?'}`;
    }
    if (!errors.length) for (const [n, k] of rowNewParties) if (!newParty.has(n)) newParty.set(n, k);
    result.rows.push({ line: i + 2, values, preview, errors, data: errors.length ? undefined : data });
  });
  result.newParties = [...newParty.entries()].map(([name, k]) => {
    // keep the spelling from the file
    const original = result.rows.flatMap((r) => Object.values(r.values)).find((x) => lk(x) === name) ?? name;
    return { name: original, kind: k };
  });
  return result;
}

/* ------------------------------------------------------------------ */
/* Saving                                                              */
/* ------------------------------------------------------------------ */

export interface ImportOutcome {
  saved: number;
  skipped: number;
  createdParties: number;
  invoices: number;
}

/** A header problem that stops the whole file (as opposed to a note about ignored columns). */
export function isBlocking(checked: CheckResult): boolean {
  return checked.headerProblems.some((p) => p.startsWith('Missing') || p.startsWith('The file'));
}

/** Insert many rows in a few statements. Returns the RETURNING rows, if asked for. */
async function insertMany(t: Runner, table: string, cols: string[], rows: unknown[][], returning?: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  // Postgres takes at most 65,535 parameters per statement.
  const per = Math.max(1, Math.floor(30_000 / cols.length));
  for (let i = 0; i < rows.length; i += per) {
    const params: unknown[] = [];
    const values = rows.slice(i, i + per).map((r) => `(${r.map((v) => (params.push(v), `$${params.length}`)).join(', ')})`);
    out.push(...(await q<Record<string, unknown>>(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${values.join(', ')}${returning ? ` RETURNING ${returning}` : ''}`, params, t)));
  }
  return out;
}

type PartyRef = { id?: number; name: string } | null;

/** Save the rows of a checked file that have no problems, inside the caller's transaction. */
async function saveChecked(kind: ImportKind, checked: CheckResult, userId: number, t: Runner): Promise<ImportOutcome> {
  const ok = checked.rows.filter((r) => r.data).map((r) => r.data!);

  // New clients and partners first, all in one statement.
  const partyOf = (d: Record<string, unknown>): [PartyRef, string] | null =>
    kind === 'shipments' ? [d.client as PartyRef, 'client']
    : kind === 'costs' ? [d.payee as PartyRef, kindForCost(d.category as string)]
    : kind === 'payments' ? [d.party as PartyRef, d.direction === 'out' ? 'agent' : 'client']
    : null;
  const toCreate = new Map<string, [string, string]>();
  for (const d of ok) {
    const [p, k] = partyOf(d) ?? [null, ''];
    if (p && !p.id && !toCreate.has(lk(p.name))) toCreate.set(lk(p.name), [p.name, k]);
  }
  const partyIds = new Map<string, number>();
  if (toCreate.size) {
    const made = await insertMany(t, 'office_parties', ['name', 'kind', 'created_by', 'notes'], [...toCreate.values()].map(([n, k]) => [n, k, userId, 'Created by import']), 'id, name');
    for (const m of made) partyIds.set(lk(String(m.name)), Number(m.id));
  }
  const pid = (p: PartyRef) => (p ? (p.id ?? partyIds.get(lk(p.name)) ?? null) : null);

  // Next line number on each shipment, for charges and costs added to it.
  const nextSort = async (table: string) => {
    const ids = [...new Set(ok.map((d) => d.shipment_id as number))];
    const have = await q<{ shipment_id: number; n: number }>(`SELECT shipment_id, COUNT(*) AS n FROM ${table} WHERE shipment_id = ANY($1::int[]) GROUP BY shipment_id`, [ids], t);
    const n = new Map(have.map((h) => [h.shipment_id, h.n]));
    return (sid: number) => {
      const v = n.get(sid) ?? 0;
      n.set(sid, v + 1);
      return v;
    };
  };

  let invoices = 0;
  if (kind === 'accounts') {
    await insertMany(t, 'office_accounts', ['name', 'type', 'currency', 'opening_balance', 'opening_date', 'notes'], ok.map((d) => [d.name, d.type, d.currency, d.opening, d.opening_date, 'Imported']));
  } else if (kind === 'parties') {
    await insertMany(t, 'office_parties', ['name', 'kind', 'phone', 'city', 'country', 'notes', 'created_by'], ok.map((d) => [d.name, d.kind, d.phone, d.city, d.country, d.notes, userId]));
  } else if (kind === 'shipments') {
    const rows: unknown[][] = [];
    for (const d of ok) {
      const ref = (d.ref as string | null) ?? (await nextShipmentRef(Number(String(d.ship_date).slice(0, 4)), t));
      rows.push([ref, d.service, pid(d.client as PartyRef), d.ship_date, d.origin, d.destination, d.goods, d.pieces, d.weight_kg, d.chargeable_kg, d.cbm, d.awb_no, d.tracking_no, d.status, d.notes, userId]);
    }
    await insertMany(t, 'office_shipments', ['ref', 'service', 'client_id', 'ship_date', 'origin', 'destination', 'goods', 'pieces', 'weight_kg', 'chargeable_kg', 'cbm', 'awb_no', 'tracking_no', 'status', 'notes', 'created_by'], rows);
  } else if (kind === 'charges') {
    const sort = await nextSort('office_charges');
    await insertMany(
      t,
      'office_charges',
      ['shipment_id', 'description', 'qty', 'unit', 'rate', 'amount', 'currency', 'per_usd', 'usd', 'sort'],
      ok.map((d) => [d.shipment_id, d.description, d.qty, d.unit, d.rate, d.amount, d.currency, d.per_usd, toUsd(d.amount as number, d.per_usd as number), sort(d.shipment_id as number)]),
    );
    // Every shipment that now has charges gets its invoice: under the old number when one was given.
    const wanted = new Map<number, string | null>();
    for (const d of ok) wanted.set(d.shipment_id as number, (d.invoice_no as string | null) ?? wanted.get(d.shipment_id as number) ?? null);
    const have = new Set((await q<{ shipment_id: number }>('SELECT shipment_id FROM office_invoices WHERE shipment_id = ANY($1::int[])', [[...wanted.keys()]], t)).map((r) => r.shipment_id));
    const numbered = [...wanted].filter(([sid, no]) => no && !have.has(sid)) as [number, string][];
    if (numbered.length) {
      const { dueDays } = await getSettings(t);
      const made = await q<{ id: number; number: string }>(
        `INSERT INTO office_invoices (number, shipment_id, issue_date, due_date)
         SELECT x.number, s.id, s.ship_date, s.ship_date + $3::int
           FROM unnest($1::text[], $2::int[]) AS x(number, sid) JOIN office_shipments s ON s.id = x.sid
         RETURNING id, number`,
        [numbered.map((n) => n[1]), numbered.map((n) => n[0]), dueDays],
        t,
      );
      await insertMany(t, 'office_activity', ['user_id', 'action', 'entity', 'entity_id', 'summary'], made.map((m) => [userId, 'invoice_created', 'invoice', m.id, m.number]));
      invoices += made.length;
    }
    for (const [sid, no] of wanted) if (!no && !have.has(sid) && (await ensureInvoice(sid, userId, t))) invoices++;
  } else if (kind === 'costs') {
    const sort = await nextSort('office_costs');
    await insertMany(
      t,
      'office_costs',
      ['shipment_id', 'category', 'payee_id', 'description', 'qty', 'rate', 'amount', 'currency', 'per_usd', 'usd', 'sort'],
      ok.map((d) => [d.shipment_id, d.category, pid(d.payee as PartyRef), d.description, d.qty, d.rate, d.amount, d.currency, d.per_usd, toUsd(d.amount as number, d.per_usd as number), sort(d.shipment_id as number)]),
    );
  } else if (kind === 'payments') {
    await insertMany(
      t,
      'office_payments',
      ['direction', 'pay_date', 'party_id', 'account_id', 'shipment_id', 'amount', 'currency', 'per_usd', 'usd', 'method', 'reference', 'notes', 'created_by'],
      ok.map((d) => [d.direction, d.pay_date, pid(d.party as PartyRef), d.account_id, d.shipment_id, d.amount, d.currency, d.per_usd, toUsd(d.amount as number, d.per_usd as number), d.method, d.reference, d.notes, userId]),
    );
  } else if (kind === 'expenses') {
    await insertMany(
      t,
      'office_expenses',
      ['exp_date', 'category', 'description', 'account_id', 'amount', 'currency', 'per_usd', 'usd', 'method', 'reference', 'created_by'],
      ok.map((d) => [d.exp_date, d.category, d.description, d.account_id, d.amount, d.currency, d.per_usd, toUsd(d.amount as number, d.per_usd as number), d.method, d.reference, userId]),
    );
  } else if (kind === 'transfers') {
    await insertMany(
      t,
      'office_transfers',
      ['tr_date', 'from_account', 'to_account', 'amount_out', 'per_usd_out', 'usd_out', 'amount_in', 'per_usd_in', 'usd_in', 'reference', 'notes', 'created_by'],
      ok.map((d) => [d.tr_date, d.from_account, d.to_account, d.amount_out, d.per_usd_out, toUsd(d.amount_out as number, d.per_usd_out as number), d.amount_in, d.per_usd_in, toUsd(d.amount_in as number, d.per_usd_in as number), d.reference, 'Imported', userId]),
    );
  }
  const skipped = checked.rows.length - ok.length;
  await logActivity(userId, 'imported', kind, null, `${KINDS[kind].label}: ${ok.length} saved, ${skipped} skipped, ${toCreate.size} new clients/partners`, t);
  return { saved: ok.length, skipped, createdParties: toCreate.size, invoices };
}

/** Re-check the file and save every row without problems, all in one transaction. */
export async function runImport(kind: ImportKind, text: string, createParties: boolean, userId: number): Promise<ImportOutcome> {
  return tx(async (t) => {
    const checked = await checkFile(kind, text, createParties, t);
    if (isBlocking(checked)) throw new Error(checked.headerProblems.join(' '));
    return saveChecked(kind, checked, userId, t);
  });
}

/* ------------------------------------------------------------------ */
/* Several kinds at once                                               */
/* ------------------------------------------------------------------ */

export interface BundlePart {
  kind: ImportKind;
  text: string;
  /** Where it came from, for the preview: file name, and section. */
  source: string;
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * A one-file import: each kind's rows follow a line holding only "#" and the
 * kind ("#accounts", "#shipments", …), then that kind's header row. Returns
 * null when the file is not laid out like that (an ordinary one-kind file).
 */
export function splitBundle(text: string, source: string): { parts: BundlePart[]; problems: string[] } | null {
  const parts: BundlePart[] = [];
  const problems: string[] = [];
  let cur: { kind: ImportKind | null; name: string; rows: string[][] } | null = null;
  const flush = () => {
    if (cur?.kind && cur.rows.length) parts.push({ kind: cur.kind, text: cur.rows.map((r) => r.map(csvCell).join(',')).join('\r\n'), source: `${source} · #${cur.name}` });
  };
  for (const row of parseCsv(text)) {
    const m = row[0].trim().match(/^#\s*([a-z_]+)\s*$/i);
    if (m && row.slice(1).every((c) => !c.trim())) {
      flush();
      const name = m[1].toLowerCase();
      if (!isKind(name)) problems.push(`${source}: "#${m[1]}" is not a kind of record (use ${KIND_ORDER.map((k) => '#' + k).join(', ')}).`);
      cur = { kind: isKind(name) ? name : null, name, rows: [] };
    } else if (!cur) return null;
    else cur.rows.push(row);
  }
  flush();
  return parts.length || problems.length ? { parts, problems } : null;
}

/** What a one-kind file holds, from its header row (or failing that, its file name). */
export function detectKind(fileName: string, text: string): ImportKind | null {
  const header = (parseCsv(text)[0] ?? []).map(norm);
  const has = (c: string) => header.includes(c);
  if (has('exp_date')) return 'expenses';
  if (has('tr_date')) return 'transfers';
  if (has('pay_date')) return 'payments';
  if (has('shipment_ref')) return has('payee_name') || has('category') ? 'costs' : 'charges';
  if (has('ship_date') || has('service')) return 'shipments';
  if (has('currency') && (has('opening_balance') || has('type'))) return 'accounts';
  if (has('name') && has('kind')) return 'parties';
  const base = fileName.toLowerCase();
  return KIND_ORDER.find((k) => base.includes(k)) ?? null;
}

export interface BundleStep {
  part: BundlePart;
  checked: CheckResult;
  outcome: ImportOutcome | null;
}

class DryRun extends Error {
  constructor(public steps: BundleStep[]) {
    super('Checked only');
  }
}

/**
 * Check — and with `save`, save — several kinds together, in the import
 * order, in one transaction. Each kind is saved before the next is checked,
 * so shipments can be found by the charges after them; a check-only run then
 * rolls everything back. A file with a blocking header problem stops the save.
 */
export async function runBundle(parts: BundlePart[], createParties: boolean, userId: number, save: boolean): Promise<BundleStep[]> {
  const ordered = [...parts].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  try {
    return await tx(async (t) => {
      const steps: BundleStep[] = [];
      const alreadyThere = new Set<string>();
      for (const part of ordered) {
        const checked = await checkFile(part.kind, part.text, createParties, t, alreadyThere);
        // A shipment refused because it already exists: its charges and costs below must not be added to it again.
        if (part.kind === 'shipments') for (const r of checked.rows) if (r.errors.some((e) => e.endsWith('already exists.'))) alreadyThere.add(lk(r.values.ref ?? ''));
        steps.push({ part, checked, outcome: isBlocking(checked) ? null : await saveChecked(part.kind, checked, userId, t) });
      }
      if (!save) throw new DryRun(steps);
      const stopped = steps.find((s) => !s.outcome);
      if (stopped) throw new Error(`${stopped.part.source}: ${stopped.checked.headerProblems.join(' ')}`);
      return steps;
    });
  } catch (e) {
    if (e instanceof DryRun) return e.steps;
    throw e;
  }
}

export { rateMap };
