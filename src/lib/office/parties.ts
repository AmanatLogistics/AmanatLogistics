/**
 * Amanat Office — parties: clients and partners (agents, truck owners,
 * airlines, sarafs, suppliers, staff, anyone else money moves to or from).
 *
 * Shared SQL for the parties pages: the list with its filters, one party,
 * what a party's shipments / cost lines / payments are, the duplicate-name
 * check, and the "is anything still pointing at this party?" check that
 * decides whether a party may be deleted.
 *
 * Money rule: every balance comes from ledger.ts (partyBalances, partyBalance,
 * partyStatement, shipmentFigures). The only sums made here are
 *   · list totals — plain additions of the ledger's own per-party balances,
 *     split into "they owe us" (> 0) and "we owe" (< 0), exactly as
 *     ledger.ts balanceTotals() splits them;
 *   · statement column totals — additions of the ledger's own statement lines,
 *     checked against the ledger's opening/closing balance (statementView);
 *   · tab totals — additions of the `usd` column of the rows shown (cost
 *     lines, payments), which are the same rows the ledger adds up.
 */
import { q, one, tx, type Runner } from './db';
import { logActivity } from './activity';
import { round2, usd } from './money';
import { partyBalances, partyStatement, shipmentFigures, type PartyBalance, type ShipmentFigures, type StatementLine } from './ledger';
import { PARTY_KINDS, COST_CATEGORIES, type PartyKind, type ServiceKey } from './services';
import { str } from './form';

export const PAGE_SIZE = 50;
export const KIND_KEYS = Object.keys(PARTY_KINDS) as PartyKind[];
/** Every kind except client: the "Agents & partners" list. */
export const PARTNER_KINDS = KIND_KEYS.filter((k) => k !== 'client');

/** One line on what each kind means, for the form. */
export const KIND_HELP: Record<PartyKind, string> = {
  client: 'Ships goods with us and pays us.',
  agent: 'Works for us on a route — Kabul, China, Tashkent, Hairatan documents… We pay them.',
  carrier: 'Truck owner or transport company we pay per trip.',
  airline: 'Airline or airport partner — Ariana, Kam Air, the Tashkent airport partner.',
  sarafi: 'Money changer / hawala dealer who moves or holds money.',
  supplier: 'Sells us goods or services (packing, stationery, repairs…).',
  staff: 'Someone who works for us — salary, advances.',
  other: 'Anyone else money moves to or from.',
};

export type Mode = 'client' | 'partners';

export function isKind(v: unknown): v is PartyKind {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PARTY_KINDS, v);
}

export function kindLabel(kind: string): string {
  return isKind(kind) ? PARTY_KINDS[kind] : kind;
}

export function modeOf(kind: string): Mode {
  return kind === 'client' ? 'client' : 'partners';
}

/** Where the list for this kind lives (sidebar ids 'clients' / 'partners'). */
export function listHref(kind: string): string {
  return kind === 'client' ? '/office/parties?kind=client' : '/office/parties?kind=partners';
}

export function navId(kind: string): 'clients' | 'partners' {
  return kind === 'client' ? 'clients' : 'partners';
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

/** A positive database id from a route/query/form value, or null. */
export function idParam(v: unknown): number | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  if (!/^\d{1,9}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

/** 'YYYY-MM-DD' that is a real calendar date, or null. */
export function dateParam(v: string | null | undefined): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
}

export function pageParam(params: URLSearchParams): number {
  const n = Number(params.get('page'));
  return Number.isInteger(n) && n > 1 && n < 100_000 ? n : 1;
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

/** "Haji  Gul " → "Haji Gul": how names are stored and compared. */
export function normalizeName(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** The numbers in a phone field, each as a tel: link target ("+93 700 111 222 / 0799…" → two). */
export function phoneLinks(phone: string | null | undefined): { text: string; href: string }[] {
  if (!phone) return [];
  return phone
    .split(/[\/,;]| or /i)
    .map((p) => p.trim())
    .filter((p) => /\d/.test(p))
    .map((p) => ({ text: p, href: `tel:${p.replace(/(?!^\+)[^\d]/g, '')}` }));
}

/** A CSV download. Text cells that start like a spreadsheet formula are made harmless. */
export function csvResponse(filename: string, header: string[], rows: unknown[][]): Response {
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
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

/* ------------------------------------------------------------------ */
/* Balances in words                                                   */
/* ------------------------------------------------------------------ */

export type Tone = '' | 'pos' | 'neg';

/**
 * A ledger balance (> 0 they owe us, < 0 we owe them) in office words.
 *   clients:  "Owes us $X"   "We hold $X for them" (paid in advance)   "Settled"
 *   partners: "We owe $X"    "They owe us $X"                          "Settled"
 * Money we owe is red; settled is green.
 */
export function balanceWords(balance: number, mode: Mode): { text: string; tone: Tone; owed: 'us' | 'them' | 'none' } {
  const b = round2(balance);
  if (b === 0) return { text: 'Settled', tone: 'pos', owed: 'none' };
  if (mode === 'client') {
    return b > 0 ? { text: `Owes us ${usd(b)}`, tone: '', owed: 'us' } : { text: `We hold ${usd(-b)} for them`, tone: 'neg', owed: 'them' };
  }
  return b < 0 ? { text: `We owe ${usd(-b)}`, tone: 'neg', owed: 'them' } : { text: `They owe us ${usd(b)}`, tone: '', owed: 'us' };
}

/** The headline on a party's page: "Haji Gul owes us $1,200.00". */
export function balanceHeadline(name: string, balance: number, mode: Mode): string {
  const b = round2(balance);
  if (b === 0) return `${name} and we are settled — nobody owes anything`;
  if (b > 0) return `${name} owes us ${usd(b)}`;
  return mode === 'client' ? `We hold ${usd(-b)} for ${name}` : `We owe ${name} ${usd(-b)}`;
}

/** One plain sentence on how the balance came about, from the four ledger parts. */
export function balanceExplained(p: Pick<PartyBalance, 'billed' | 'received' | 'owed_to_them' | 'paid_to_them' | 'balance' | 'kind'>): string {
  const ours: string[] = [];
  if (p.billed) ours.push(`we billed them ${usd(p.billed)} for shipments`);
  if (p.received) ours.push(`they paid us ${usd(p.received)}`);
  const theirs: string[] = [];
  if (p.owed_to_them) theirs.push(`they billed us ${usd(p.owed_to_them)} for work on shipments`);
  if (p.paid_to_them) theirs.push(`we paid them ${usd(p.paid_to_them)}`);
  // Lead with what usually happens with this kind of party.
  const parts = p.kind === 'client' ? [...ours, ...theirs] : [...theirs, ...ours];
  if (!parts.length) return 'No shipments, bills or payments on their account yet.';
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  const b = round2(p.balance);
  const end =
    b > 0
      ? `so they still owe us ${usd(b)}`
      : b < 0
        ? p.kind === 'client'
          ? `so they have paid ${usd(-b)} more than billed — we hold it for them`
          : `so we still owe them ${usd(-b)}`
        : 'so the account is settled';
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} — ${end}.`;
}

/** The printed statement speaks to the party: "You owe $X" / "We owe you $X". */
export function readerWords(balance: number): string {
  const b = round2(balance);
  if (b > 0) return `You owe ${usd(b)}`;
  if (b < 0) return `We owe you ${usd(-b)}`;
  return 'Settled';
}

/* ------------------------------------------------------------------ */
/* One party                                                           */
/* ------------------------------------------------------------------ */

export interface Party {
  id: number;
  name: string;
  kind: PartyKind;
  phone: string | null;
  city: string | null;
  country: string | null;
  notes: string | null;
  active: boolean;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
}

export async function getParty(id: number, runner?: Runner): Promise<Party | null> {
  return one<Party>(
    `SELECT p.id, p.name, p.kind, p.phone, p.city, p.country, p.notes, p.active, p.created_by,
            u.name AS created_by_name, p.created_at
       FROM office_parties p LEFT JOIN office_users u ON u.id = p.created_by
      WHERE p.id = $1`,
    [id],
    runner,
  );
}

/** Active parties with the same name (spaces and capitals ignored), except `excludeId`. */
export async function sameNameParties(
  name: string,
  excludeId?: number | null,
  runner?: Runner,
): Promise<{ id: number; name: string; kind: PartyKind; city: string | null }[]> {
  return q(
    `SELECT id, name, kind, city FROM office_parties
      WHERE active AND id <> $2
        AND lower(btrim(regexp_replace(name, '\\s+', ' ', 'g'))) = lower($1)
      ORDER BY id`,
    [normalizeName(name), excludeId ?? 0],
    runner,
  );
}

/* ------------------------------------------------------------------ */
/* The list                                                            */
/* ------------------------------------------------------------------ */

export type ListSort = 'name' | 'balance';
export const LIST_SORTS: Record<ListSort, string> = { name: 'Name (A–Z)', balance: 'Balance (largest first)' };

export interface ListFilters {
  mode: Mode;
  /** a single partner kind, in partners mode */
  kind: PartyKind | null;
  q: string | null;
  inactive: boolean;
  sort: ListSort;
}

/**
 * ?kind=client                → clients
 * ?kind=partners              → every kind except client
 * ?kind=agent|carrier|…       → partners of that kind only
 * plus ?q= (name, phone, city), ?inactive=1, ?sort=name|balance
 */
export function listFilters(sp: URLSearchParams): ListFilters {
  const k = sp.get('kind');
  const mode: Mode = k === 'partners' || (isKind(k) && k !== 'client') ? 'partners' : 'client';
  const kind = mode === 'partners' && isKind(k) && k !== 'client' ? k : null;
  const qv = (sp.get('q') ?? '').trim().slice(0, 80);
  const sort = sp.get('sort') === 'balance' ? 'balance' : 'name';
  return { mode, kind, q: qv || null, inactive: sp.get('inactive') === '1', sort };
}

export interface ListRow extends PartyBalance {
  country: string | null;
}

export interface ListTotals {
  count: number;
  /** Σ positive balances — they owe us */
  theyOwe: number;
  /** Σ negative balances, as a positive figure — we owe them (or hold for clients) */
  weOwe: number;
  /** theyOwe − weOwe */
  net: number;
}

/**
 * Parties matching the filters, each with its ledger balance, sorted. The
 * search and filters pick WHICH parties (SQL, bound parameters); the figures
 * are ledger.ts partyBalances() unchanged.
 */
export async function listParties(f: ListFilters): Promise<{ rows: ListRow[]; totals: ListTotals }> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.mode === 'client') where.push(`kind = 'client'`);
  else if (f.kind) where.push(`kind = ${add(f.kind)}`);
  else where.push(`kind <> 'client'`);
  if (!f.inactive) where.push('active');
  if (f.q) {
    const p = add(likePattern(f.q));
    const ors = [`name ILIKE ${p}`, `city ILIKE ${p}`, `phone ILIKE ${p}`];
    // Phone numbers are written every which way: "0700 111 222", "+93 700 111 222".
    const digits = f.q.replace(/\D/g, '').replace(/^0+/, '');
    if (digits.length >= 5) ors.push(`regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') LIKE ${add(`%${digits}%`)}`);
    where.push(`(${ors.join(' OR ')})`);
  }
  const picked = await q<{ id: number; country: string | null }>(
    `SELECT id, country FROM office_parties WHERE ${where.join(' AND ')}`,
    params,
  );
  const country = new Map(picked.map((r) => [r.id, r.country]));
  const balances = await partyBalances(f.mode === 'client' ? { kind: 'client' } : f.kind ? { kind: f.kind } : {});
  const rows: ListRow[] = balances.filter((b) => country.has(b.id)).map((b) => ({ ...b, country: country.get(b.id) ?? null }));

  const byName = (a: ListRow, b: ListRow) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id - b.id;
  if (f.sort === 'balance') {
    // Clients: who owes us most first. Partners: whom we owe most first.
    const sign = f.mode === 'client' ? -1 : 1;
    rows.sort((a, b) => sign * (a.balance - b.balance) || byName(a, b));
  } else rows.sort(byName);

  let theyOwe = 0;
  let weOwe = 0;
  for (const r of rows) {
    if (r.balance > 0) theyOwe += r.balance;
    else if (r.balance < 0) weOwe += -r.balance;
  }
  theyOwe = round2(theyOwe);
  weOwe = round2(weOwe);
  return { rows, totals: { count: rows.length, theyOwe, weOwe, net: round2(theyOwe - weOwe) } };
}

/* ------------------------------------------------------------------ */
/* Statement                                                           */
/* ------------------------------------------------------------------ */

export interface StatementRow extends StatementLine {
  /** what kind of line, in words: "We billed them", "Their bill to us"… */
  what: string;
  /** description with cost categories shown as their labels */
  detail: string;
  /**
   * The two statement columns, signed in the party's usual direction:
   *   clients:  bill = billed to them,    pay = they paid us
   *   partners: bill = their bill to us,  pay = we paid them
   * A line going the other way (a client who also billed us, an agent who
   * paid us back) shows as a negative figure in its column.
   */
  bill: number | null;
  pay: number | null;
}

export interface StatementView {
  opening: number;
  closing: number;
  rows: StatementRow[];
  totalBill: number;
  totalPay: number;
  /** true when the column totals and the ledger's opening/closing agree to the cent */
  consistent: boolean;
}

/**
 * ledger.ts partyStatement(), laid out for a page: each line put into the
 * "bills" or "payments" column for this kind of party, with plain words.
 */
export async function statementView(partyId: number, mode: Mode, from?: string | null, to?: string | null): Promise<StatementView> {
  const st = await partyStatement(partyId, from ?? undefined, to ?? undefined);
  const sign = mode === 'client' ? 1 : -1;
  const rows: StatementRow[] = st.lines.map((l) => {
    const isBill = l.kind === 'charge' || l.kind === 'cost';
    const cat = (COST_CATEGORIES as Record<string, string>)[l.description];
    const detail = l.kind === 'cost' && cat ? cat : l.description;
    const what =
      l.kind === 'charge'
        ? 'We billed them'
        : l.kind === 'cost'
          ? 'Their bill to us'
          : l.kind === 'received'
            ? 'They paid us'
            : 'We paid them';
    return {
      ...l,
      what,
      detail,
      bill: isBill ? round2(sign * l.delta) : null,
      pay: isBill ? null : round2(-sign * l.delta),
    };
  });
  const totalBill = round2(rows.reduce((a, r) => a + (r.bill ?? 0), 0));
  const totalPay = round2(rows.reduce((a, r) => a + (r.pay ?? 0), 0));
  const consistent = round2(st.opening + sign * (totalBill - totalPay)) === round2(st.closing);
  return { opening: st.opening, closing: st.closing, rows, totalBill, totalPay, consistent };
}

/** Column headings for the statement, for our screen and for the printed copy. */
export function statementHeads(mode: Mode): { bill: string; billHelp: string; pay: string; payHelp: string; printBill: string; printPay: string } {
  return mode === 'client'
    ? { bill: 'Billed', billHelp: 'billed to them', pay: 'They paid', payHelp: 'paid to us', printBill: 'Billed to you', printPay: 'You paid' }
    : { bill: 'We owe them', billHelp: 'their bills to us', pay: 'Paid', payHelp: 'we paid them', printBill: 'Your bills to us', printPay: 'We paid you' };
}

/**
 * A statement line as the printed copy says it to the party: payments become
 * "Payment from you" / "Payment to you", and a line going the unusual way for
 * this kind of party (a client's own bill to us, our bill to a partner) gets a
 * note so its negative figure makes sense.
 */
export function printDescription(r: StatementRow, mode: Mode): { text: string; note: string | null } {
  if (r.kind === 'received') return { text: r.detail.replace(/^Payment received/, 'Payment from you'), note: mode === 'client' ? null : 'you paid us' };
  if (r.kind === 'paid') return { text: r.detail.replace(/^Payment made/, 'Payment to you'), note: mode === 'client' ? 'we paid you' : null };
  if (r.kind === 'cost') return { text: r.detail, note: mode === 'client' ? 'your bill to us' : null };
  return { text: r.detail, note: mode === 'client' ? null : 'our bill to you' };
}

/* ------------------------------------------------------------------ */
/* Shipments (as client), cost lines (as payee), payments              */
/* ------------------------------------------------------------------ */

export interface ClientShipment {
  id: number;
  ref: string;
  ship_date: string;
  service: ServiceKey;
  status: string;
  origin: string | null;
  destination: string | null;
  fig: ShipmentFigures;
}

/** Shipments where they are the client, newest first, with ledger figures. */
export async function clientShipments(partyId: number): Promise<ClientShipment[]> {
  const ships = await q<Omit<ClientShipment, 'fig'>>(
    `SELECT id, ref, ship_date, service, status, origin, destination
       FROM office_shipments WHERE client_id = $1
      ORDER BY ship_date DESC, id DESC`,
    [partyId],
  );
  if (!ships.length) return [];
  const figs = await shipmentFigures(ships.map((s) => s.id));
  const zero: ShipmentFigures = { revenue: 0, cost: 0, profit: 0, received: 0, due: 0 };
  return ships.map((s) => ({ ...s, fig: figs.get(s.id) ?? zero }));
}

export interface PayeeCostLine {
  id: number;
  shipment_id: number;
  ref: string;
  ship_date: string;
  service: ServiceKey;
  category: string;
  description: string | null;
  qty: number | null;
  rate: number | null;
  amount: number;
  currency: string;
  per_usd: number;
  usd: number;
}

/** Cost lines where they are the payee (what they billed us), newest first. */
export async function payeeCostLines(partyId: number): Promise<PayeeCostLine[]> {
  return q<PayeeCostLine>(
    `SELECT c.id, c.shipment_id, s.ref, s.ship_date, s.service, c.category, c.description,
            c.qty, c.rate, c.amount, c.currency, c.per_usd, c.usd
       FROM office_costs c JOIN office_shipments s ON s.id = c.shipment_id
      WHERE c.payee_id = $1
      ORDER BY s.ship_date DESC, s.id DESC, c.sort, c.id`,
    [partyId],
  );
}

export function costCategoryLabel(c: string): string {
  return (COST_CATEGORIES as Record<string, string>)[c] ?? c;
}

export interface PartyPayment {
  id: number;
  direction: 'in' | 'out';
  pay_date: string;
  amount: number;
  currency: string;
  per_usd: number;
  usd: number;
  method: string;
  reference: string | null;
  account_id: number;
  account_name: string;
  shipment_id: number | null;
  shipment_ref: string | null;
}

/** Every payment from or to them, newest first. */
export async function partyPayments(partyId: number): Promise<PartyPayment[]> {
  return q<PartyPayment>(
    `SELECT p.id, p.direction, p.pay_date, p.amount, p.currency, p.per_usd, p.usd, p.method, p.reference,
            p.account_id, a.name AS account_name, p.shipment_id, s.ref AS shipment_ref
       FROM office_payments p
       JOIN office_accounts a ON a.id = p.account_id
       LEFT JOIN office_shipments s ON s.id = p.shipment_id
      WHERE p.party_id = $1
      ORDER BY p.pay_date DESC, p.id DESC`,
    [partyId],
  );
}

/**
 * Office expenses paid to them (rent to a landlord, a salary to staff). These
 * are paid on the spot, so — as in ledger.ts — they are not part of the
 * party's balance; the page mentions them so nobody wonders where they went.
 */
export async function partyExpenseTotal(partyId: number): Promise<{ n: number; usd: number }> {
  const r = await one<{ n: number; usd: number }>(
    'SELECT COUNT(*) AS n, COALESCE(SUM(usd), 0) AS usd FROM office_expenses WHERE payee_id = $1',
    [partyId],
  );
  return { n: r?.n ?? 0, usd: round2(r?.usd ?? 0) };
}

/** How many of each thing they have — for the tab labels. */
export async function partyCounts(partyId: number): Promise<{ shipments: number; costs: number; payments: number }> {
  const r = await one<{ shipments: number; costs: number; payments: number }>(
    `SELECT (SELECT COUNT(*) FROM office_shipments WHERE client_id = $1) AS shipments,
            (SELECT COUNT(*) FROM office_costs WHERE payee_id = $1) AS costs,
            (SELECT COUNT(*) FROM office_payments WHERE party_id = $1) AS payments`,
    [partyId],
  );
  return r ?? { shipments: 0, costs: 0, payments: 0 };
}

/* ------------------------------------------------------------------ */
/* Is anything pointing at this party?                                 */
/* ------------------------------------------------------------------ */

/** The tables that point at a party, in words. */
const KNOWN_REFS: { table: string; column: string; one: string; many: string }[] = [
  { table: 'office_shipments', column: 'client_id', one: 'shipment where they are the client', many: 'shipments where they are the client' },
  { table: 'office_costs', column: 'payee_id', one: 'cost line on a shipment (their bill to us)', many: 'cost lines on shipments (their bills to us)' },
  { table: 'office_payments', column: 'party_id', one: 'payment to or from them', many: 'payments to or from them' },
  { table: 'office_expenses', column: 'payee_id', one: 'office expense paid to them', many: 'office expenses paid to them' },
];

export interface PartyRefs {
  items: { table: string; column: string; n: number; words: string }[];
  total: number;
}

/**
 * Every record that points at this party. The known tables above, plus any
 * other table with a foreign key to office_parties (found in the database's
 * own catalogue, so a table added later is never missed).
 */
export async function partyReferences(id: number, runner?: Runner): Promise<PartyRefs> {
  const fks = await q<{ tbl: string; col: string }>(
    `SELECT cl.relname AS tbl, a.attname AS col
       FROM pg_constraint c
       JOIN pg_class cl ON cl.oid = c.conrelid
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f' AND c.confrelid = 'office_parties'::regclass
      ORDER BY cl.relname, a.attname`,
    [],
    runner,
  );
  const targets = [...KNOWN_REFS.map((k) => ({ table: k.table, column: k.column }))];
  for (const fk of fks) {
    if (!targets.some((t) => t.table === fk.tbl && t.column === fk.col)) targets.push({ table: fk.tbl, column: fk.col });
  }
  const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const items: PartyRefs['items'] = [];
  for (const t of targets) {
    // Table and column names come from the list above or the catalogue, never from a request.
    const r = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM ${ident(t.table)} WHERE ${ident(t.column)} = $1`, [id], runner);
    const n = r?.n ?? 0;
    if (!n) continue;
    const known = KNOWN_REFS.find((k) => k.table === t.table && k.column === t.column);
    const words = known ? `${n} ${n === 1 ? known.one : known.many}` : `${n} record${n === 1 ? '' : 's'} in ${t.table.replace(/^office_/, '')}`;
    items.push({ ...t, n, words });
  }
  return { items, total: items.reduce((a, i) => a + i.n, 0) };
}

export function joinWords(list: string[]): string {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * Delete a party — only when nothing at all points at them. The party row is
 * locked first, so a payment or shipment saved at the same moment either
 * lands before the check (and blocks the delete) or waits and then fails.
 */
export async function deleteParty(
  id: number,
  userId: number,
): Promise<{ ok: true; name: string; kind: PartyKind } | { ok: false; error: string }> {
  try {
    return await tx(async (t) => {
      const p = await one<{ id: number; name: string; kind: PartyKind }>(
        'SELECT id, name, kind FROM office_parties WHERE id = $1 FOR UPDATE',
        [id],
        t,
      );
      if (!p) return { ok: false as const, error: 'That client or partner was already deleted.' };
      const refs = await partyReferences(id, t);
      if (refs.total > 0) {
        return {
          ok: false as const,
          error: `${p.name} cannot be deleted: ${joinWords(refs.items.map((i) => i.words))} still ${refs.total === 1 ? 'points' : 'point'} to them. Those are real records, so they must stay. Mark ${p.name} inactive instead.`,
        };
      }
      await q('DELETE FROM office_parties WHERE id = $1', [id], t);
      await logActivity(userId, 'party_deleted', 'party', id, `${p.name} (${kindLabel(p.kind)}) deleted`, t);
      return { ok: true as const, name: p.name, kind: p.kind };
    });
  } catch (e) {
    // A foreign key we did not know about, or a record saved at the same instant.
    if ((e as { code?: string })?.code === '23503') {
      return { ok: false, error: 'They cannot be deleted because other records still point to them. Mark them inactive instead.' };
    }
    throw e;
  }
}

/** Mark a party inactive (hidden from lists and pick-lists) or active again. */
export async function setPartyActive(id: number, active: boolean, userId: number): Promise<string | null> {
  return tx(async (t) => {
    const p = await one<{ name: string; active: boolean }>('SELECT name, active FROM office_parties WHERE id = $1 FOR UPDATE', [id], t);
    if (!p) return null;
    if (p.active === active) return p.name;
    await q('UPDATE office_parties SET active = $1 WHERE id = $2', [active, id], t);
    await logActivity(userId, 'party_updated', 'party', id, `${p.name}: ${active ? 'marked active again' : 'marked inactive'}`, t);
    return p.name;
  });
}

/* ------------------------------------------------------------------ */
/* The form                                                            */
/* ------------------------------------------------------------------ */

export const PARTY_FIELDS = ['name', 'kind', 'phone', 'city', 'country', 'notes', 'active', 'confirm_dup'];

export interface PartyInput {
  name: string;
  kind: PartyKind;
  phone: string | null;
  city: string | null;
  country: string | null;
  notes: string | null;
  active: boolean;
}

/** The posted form as plain strings, so a form that failed can be shown again as typed. */
export function formValues(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of PARTY_FIELDS) {
    const v = fd.get(n);
    out[n] = typeof v === 'string' ? v : '';
  }
  return out;
}

export function readPartyForm(fd: FormData): { ok: true; value: PartyInput } | { ok: false; error: string } {
  const rawName = str(fd, 'name', 300);
  const name = rawName ? normalizeName(rawName) : '';
  if (!name) return { ok: false, error: 'Enter their name.' };
  if (name.length > 120) return { ok: false, error: 'The name is too long — keep it under 120 characters.' };
  const kind = str(fd, 'kind', 20);
  if (!isKind(kind)) return { ok: false, error: 'Choose what kind of party this is (client, agent, truck owner…).' };
  const phone = str(fd, 'phone', 200);
  if (phone && phone.length > 60) return { ok: false, error: 'The phone field is too long — keep it under 60 characters.' };
  if (phone && (phone.match(/\d/g) ?? []).length < 5) return { ok: false, error: 'The phone number looks too short — type the number with its digits, e.g. 0700 123 456.' };
  const city = str(fd, 'city', 200);
  if (city && city.length > 80) return { ok: false, error: 'The city is too long — keep it under 80 characters.' };
  const country = str(fd, 'country', 200);
  if (country && country.length > 80) return { ok: false, error: 'The country is too long — keep it under 80 characters.' };
  const notesRaw = fd.get('notes');
  const notes = typeof notesRaw === 'string' && notesRaw.trim() ? notesRaw.trim() : null;
  if (notes && notes.length > 2000) return { ok: false, error: 'The notes are too long — keep them under 2,000 characters.' };
  return {
    ok: true,
    value: {
      name,
      kind,
      phone: phone ? phone.replace(/\s+/g, ' ') : null,
      city: city ? normalizeName(city) : null,
      country: country ? normalizeName(country) : null,
      notes,
      active: fd.get('active') === 'on',
    },
  };
}

export async function insertParty(v: PartyInput, userId: number, t: Runner): Promise<number> {
  const r = await one<{ id: number }>(
    `INSERT INTO office_parties (name, kind, phone, city, country, notes, active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [v.name, v.kind, v.phone, v.city, v.country, v.notes, v.active, userId],
    t,
  );
  return r!.id;
}

export async function updateParty(id: number, v: PartyInput, t: Runner): Promise<void> {
  await q(
    `UPDATE office_parties SET name = $1, kind = $2, phone = $3, city = $4, country = $5, notes = $6, active = $7
      WHERE id = $8`,
    [v.name, v.kind, v.phone, v.city, v.country, v.notes, v.active, id],
    t,
  );
}

/** "Haji Gul Traders (Client) — Kandahar, +93 700 111 222" for the activity log. */
export function partySummary(v: Pick<PartyInput, 'name' | 'kind' | 'city' | 'phone' | 'active'>): string {
  const extra = [v.city, v.phone].filter(Boolean).join(', ');
  return `${v.name} (${kindLabel(v.kind)})${extra ? ` — ${extra}` : ''}${v.active ? '' : ' — inactive'}`;
}

/** What changed, in words, for the activity log. */
export function partyChanges(old: Party, v: PartyInput): string {
  const out: string[] = [];
  const show = (s: string | null) => (s ? `"${s.length > 40 ? s.slice(0, 40) + '…' : s}"` : 'blank');
  if (old.name !== v.name) out.push(`name ${show(old.name)} → ${show(v.name)}`);
  if (old.kind !== v.kind) out.push(`kind ${kindLabel(old.kind)} → ${kindLabel(v.kind)}`);
  if ((old.phone ?? null) !== v.phone) out.push(`phone ${show(old.phone)} → ${show(v.phone)}`);
  if ((old.city ?? null) !== v.city) out.push(`city ${show(old.city)} → ${show(v.city)}`);
  if ((old.country ?? null) !== v.country) out.push(`country ${show(old.country)} → ${show(v.country)}`);
  if ((old.notes ?? null) !== v.notes) out.push('notes changed');
  if (old.active !== v.active) out.push(v.active ? 'marked active again' : 'marked inactive');
  return `${v.name}: ${out.length ? out.join('; ') : 'no changes'}`;
}

/* ------------------------------------------------------------------ */
/* Dates for the statement filter                                      */
/* ------------------------------------------------------------------ */

/** Quick ranges for the statement: this month, last month, this year, last year. */
export function quickRanges(todayStr: string): { key: string; label: string; from: string; to: string }[] {
  const [y, m] = todayStr.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const ly = m === 1 ? y - 1 : y;
  const lm = m === 1 ? 12 : m - 1;
  return [
    { key: 'this-month', label: 'This month', from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${lastDay(y, m)}` },
    { key: 'last-month', label: 'Last month', from: `${ly}-${pad(lm)}-01`, to: `${ly}-${pad(lm)}-${lastDay(ly, lm)}` },
    { key: 'this-year', label: `${y}`, from: `${y}-01-01`, to: `${y}-12-31` },
    { key: 'last-year', label: `${y - 1}`, from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
  ];
}

/** ?from=&to= for a statement, valid dates only, swapped if back to front. */
export function statementRange(sp: URLSearchParams): { from: string | null; to: string | null } {
  let from = dateParam(sp.get('from'));
  let to = dateParam(sp.get('to'));
  if (from && to && from > to) [from, to] = [to, from];
  return { from, to };
}
