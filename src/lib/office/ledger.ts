/**
 * Amanat Office — the ledger. EVERY balance, profit and due figure shown
 * anywhere in the office system comes from the functions in this file, so the
 * dashboard, a client statement and an invoice can never disagree.
 *
 * All figures are US dollars (each record's own `usd` column; see schema.ts).
 *
 * ── Party balance (clients, agents, carriers, airlines, sarafs — anyone) ──
 *
 *     balance = billed − received − owed_to_them + paid_to_them
 *
 *   billed        charges on shipments where they are the client
 *   received      payments IN from them
 *   owed_to_them  shipment costs where they are the payee
 *   paid_to_them  payments OUT to them
 *
 *   balance > 0  → they owe us   (receivable)
 *   balance < 0  → we owe them   (payable — an agent's unpaid bill, or a
 *                                 client who paid in advance / overpaid)
 *
 * ── Shipment ──
 *
 *     revenue = Σ charges      cost = Σ costs      profit = revenue − cost
 *     received = Σ payments IN linked to the shipment
 *     due = revenue − received
 *
 * ── Profit & loss for a period ──
 *
 *     revenue and direct cost   — shipments whose ship_date is in the period
 *     office expenses           — expenses whose exp_date is in the period
 *     transfer fees             — usd_out − usd_in of transfers in the period
 *     net profit = revenue − direct cost − office expenses − transfer fees
 *
 * ── Account (cash box, bank, saraf) — in the account's own currency ──
 *
 *     balance = opening + payments in − payments out − expenses
 *               + transfers in − transfers out
 */
import { q, one } from './db';
import { round2 } from './money';
import type { ServiceKey } from './services';

/* ------------------------------------------------------------------ */
/* Parties                                                             */
/* ------------------------------------------------------------------ */

export interface PartyBalance {
  id: number;
  name: string;
  kind: string;
  phone: string | null;
  city: string | null;
  active: boolean;
  billed: number;
  received: number;
  owed_to_them: number;
  paid_to_them: number;
  /** > 0 they owe us, < 0 we owe them */
  balance: number;
}

const PARTY_BALANCE_SQL = `
  SELECT p.id, p.name, p.kind, p.phone, p.city, p.active,
         COALESCE(b.v, 0)  AS billed,
         COALESCE(r.v, 0)  AS received,
         COALESCE(c.v, 0)  AS owed_to_them,
         COALESCE(pd.v, 0) AS paid_to_them
    FROM office_parties p
    LEFT JOIN (SELECT s.client_id AS id, SUM(ch.usd) AS v
                 FROM office_charges ch JOIN office_shipments s ON s.id = ch.shipment_id
                GROUP BY s.client_id) b ON b.id = p.id
    LEFT JOIN (SELECT party_id AS id, SUM(usd) AS v FROM office_payments WHERE direction = 'in'  GROUP BY party_id) r  ON r.id = p.id
    LEFT JOIN (SELECT payee_id AS id, SUM(usd) AS v FROM office_costs WHERE payee_id IS NOT NULL GROUP BY payee_id) c ON c.id = p.id
    LEFT JOIN (SELECT party_id AS id, SUM(usd) AS v FROM office_payments WHERE direction = 'out' GROUP BY party_id) pd ON pd.id = p.id`;

function withBalance(r: Omit<PartyBalance, 'balance'>): PartyBalance {
  return { ...r, balance: round2(r.billed - r.received - r.owed_to_them + r.paid_to_them) };
}

/** Every party with its balance. Filter by kind ('client', 'agent', …) if given. */
export async function partyBalances(opts: { kind?: string; activeOnly?: boolean } = {}): Promise<PartyBalance[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.kind) {
    params.push(opts.kind);
    where.push(`p.kind = $${params.length}`);
  }
  if (opts.activeOnly) where.push('p.active');
  const rows = await q<Omit<PartyBalance, 'balance'>>(
    `${PARTY_BALANCE_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.name`,
    params,
  );
  return rows.map(withBalance);
}

export async function partyBalance(id: number): Promise<PartyBalance | null> {
  const r = await one<Omit<PartyBalance, 'balance'>>(`${PARTY_BALANCE_SQL} WHERE p.id = $1`, [id]);
  return r ? withBalance(r) : null;
}

/** Totals across everyone: what clients owe us, what we owe others. */
export async function balanceTotals(): Promise<{ receivable: number; payable: number; clientCredit: number }> {
  const all = await partyBalances();
  let receivable = 0;
  let payable = 0;
  let clientCredit = 0;
  for (const p of all) {
    if (p.balance > 0) receivable += p.balance;
    else if (p.balance < 0) {
      if (p.kind === 'client') clientCredit += -p.balance;
      else payable += -p.balance;
    }
  }
  return { receivable: round2(receivable), payable: round2(payable), clientCredit: round2(clientCredit) };
}

/**
 * One party's statement: every charge, cost and payment that touches them,
 * oldest first, with a running balance (same sign rule as above).
 */
export interface StatementLine {
  date: string;
  kind: 'charge' | 'received' | 'cost' | 'paid';
  ref: string | null;
  shipment_id: number | null;
  description: string;
  /** what this line adds to the balance (they owe us more → positive) */
  delta: number;
  balance: number;
  /** original currency figure, for display */
  amount: number;
  currency: string;
}

export async function partyStatement(partyId: number, from?: string, to?: string): Promise<{ opening: number; lines: StatementLine[]; closing: number }> {
  const rows = await q<Omit<StatementLine, 'balance'> & { sort_ts: string; id: number }>(
    `SELECT * FROM (
       SELECT s.ship_date AS date, 'charge' AS kind, s.ref, s.id AS shipment_id,
              COALESCE(ch.description, 'Charge') AS description, ch.usd AS delta, ch.amount, ch.currency,
              s.created_at AS sort_ts, ch.id
         FROM office_charges ch JOIN office_shipments s ON s.id = ch.shipment_id
        WHERE s.client_id = $1
       UNION ALL
       SELECT p.pay_date, 'received', s.ref, p.shipment_id,
              CONCAT('Payment received', CASE WHEN p.reference IS NOT NULL AND p.reference <> '' THEN ' — ' || p.reference ELSE '' END),
              -p.usd, p.amount, p.currency, p.created_at, p.id
         FROM office_payments p LEFT JOIN office_shipments s ON s.id = p.shipment_id
        WHERE p.party_id = $1 AND p.direction = 'in'
       UNION ALL
       SELECT s.ship_date, 'cost', s.ref, s.id,
              COALESCE(c.description, c.category), -c.usd, c.amount, c.currency, s.created_at, c.id
         FROM office_costs c JOIN office_shipments s ON s.id = c.shipment_id
        WHERE c.payee_id = $1
       UNION ALL
       SELECT p.pay_date, 'paid', s.ref, p.shipment_id,
              CONCAT('Payment made', CASE WHEN p.reference IS NOT NULL AND p.reference <> '' THEN ' — ' || p.reference ELSE '' END),
              p.usd, p.amount, p.currency, p.created_at, p.id
         FROM office_payments p LEFT JOIN office_shipments s ON s.id = p.shipment_id
        WHERE p.party_id = $1 AND p.direction = 'out'
     ) x
     ORDER BY date, sort_ts, id`,
    [partyId],
  );
  let running = 0;
  let opening = 0;
  const lines: StatementLine[] = [];
  for (const r of rows) {
    running = round2(running + r.delta);
    if (from && r.date < from) {
      opening = running;
      continue;
    }
    if (to && r.date > to) continue;
    lines.push({ date: r.date, kind: r.kind, ref: r.ref, shipment_id: r.shipment_id, description: r.description, delta: r.delta, balance: running, amount: r.amount, currency: r.currency });
  }
  const closing = lines.length ? lines[lines.length - 1].balance : opening;
  return { opening, lines, closing };
}

/* ------------------------------------------------------------------ */
/* Shipments                                                           */
/* ------------------------------------------------------------------ */

export interface ShipmentFigures {
  revenue: number;
  cost: number;
  profit: number;
  received: number;
  due: number;
}

/**
 * Revenue / cost / profit / received / due for a set of shipments, keyed by id.
 * Pass ids, or nothing for all shipments.
 */
export async function shipmentFigures(ids?: number[]): Promise<Map<number, ShipmentFigures>> {
  const params: unknown[] = [];
  let where = '';
  if (ids) {
    if (!ids.length) return new Map();
    params.push(ids);
    where = 'WHERE s.id = ANY($1::int[])';
  }
  const rows = await q<{ id: number; revenue: number; cost: number; received: number }>(
    `SELECT s.id,
            COALESCE(ch.v, 0) AS revenue,
            COALESCE(co.v, 0) AS cost,
            COALESCE(pi.v, 0) AS received
       FROM office_shipments s
       LEFT JOIN (SELECT shipment_id, SUM(usd) AS v FROM office_charges GROUP BY shipment_id) ch ON ch.shipment_id = s.id
       LEFT JOIN (SELECT shipment_id, SUM(usd) AS v FROM office_costs GROUP BY shipment_id) co ON co.shipment_id = s.id
       LEFT JOIN (SELECT shipment_id, SUM(usd) AS v FROM office_payments WHERE direction = 'in' AND shipment_id IS NOT NULL GROUP BY shipment_id) pi ON pi.shipment_id = s.id
       ${where}`,
    params,
  );
  return new Map(
    rows.map((r) => [
      r.id,
      { revenue: r.revenue, cost: r.cost, profit: round2(r.revenue - r.cost), received: r.received, due: round2(r.revenue - r.received) },
    ]),
  );
}

export async function shipmentFigure(id: number): Promise<ShipmentFigures> {
  return (await shipmentFigures([id])).get(id) ?? { revenue: 0, cost: 0, profit: 0, received: 0, due: 0 };
}

/* ------------------------------------------------------------------ */
/* Profit & loss                                                       */
/* ------------------------------------------------------------------ */

export interface Period {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
}

export interface ServicePnl {
  service: ServiceKey;
  shipments: number;
  kg: number;
  cbm: number;
  revenue: number;
  cost: number;
  profit: number;
}

export interface Pnl {
  revenue: number;
  directCost: number;
  grossProfit: number;
  officeExpenses: number;
  transferFees: number;
  netProfit: number;
  byService: ServicePnl[];
  costByCategory: { category: string; usd: number }[];
  expenseByCategory: { category: string; usd: number }[];
}

export async function pnl(period: Period, service?: ServiceKey): Promise<Pnl> {
  const sParams: unknown[] = [period.from, period.to];
  let sFilter = '';
  if (service) {
    sParams.push(service);
    sFilter = ` AND s.service = $3`;
  }
  const byService = await q<ServicePnl>(
    `SELECT s.service,
            COUNT(*) AS shipments,
            COALESCE(SUM(COALESCE(s.chargeable_kg, s.weight_kg)), 0) AS kg,
            COALESCE(SUM(s.cbm), 0) AS cbm,
            COALESCE(SUM(ch.v), 0) AS revenue,
            COALESCE(SUM(co.v), 0) AS cost
       FROM office_shipments s
       LEFT JOIN (SELECT shipment_id, SUM(usd) AS v FROM office_charges GROUP BY shipment_id) ch ON ch.shipment_id = s.id
       LEFT JOIN (SELECT shipment_id, SUM(usd) AS v FROM office_costs GROUP BY shipment_id) co ON co.shipment_id = s.id
      WHERE s.ship_date BETWEEN $1 AND $2${sFilter}
      GROUP BY s.service ORDER BY s.service`,
    sParams,
  );
  for (const r of byService) r.profit = round2(r.revenue - r.cost);

  const costByCategory = await q<{ category: string; usd: number }>(
    `SELECT c.category, SUM(c.usd) AS usd
       FROM office_costs c JOIN office_shipments s ON s.id = c.shipment_id
      WHERE s.ship_date BETWEEN $1 AND $2${sFilter}
      GROUP BY c.category ORDER BY usd DESC`,
    sParams,
  );

  const revenue = round2(byService.reduce((a, r) => a + r.revenue, 0));
  const directCost = round2(byService.reduce((a, r) => a + r.cost, 0));

  // Office expenses and transfer fees belong to the business as a whole, not
  // to one section, so a section's P&L stops at gross profit.
  let officeExpenses = 0;
  let transferFees = 0;
  let expenseByCategory: { category: string; usd: number }[] = [];
  if (!service) {
    expenseByCategory = await q(
      `SELECT category, SUM(usd) AS usd FROM office_expenses
        WHERE exp_date BETWEEN $1 AND $2 GROUP BY category ORDER BY usd DESC`,
      [period.from, period.to],
    );
    officeExpenses = round2(expenseByCategory.reduce((a, r) => a + r.usd, 0));
    const tf = await one<{ v: number }>(
      `SELECT COALESCE(SUM(usd_out - usd_in), 0) AS v FROM office_transfers WHERE tr_date BETWEEN $1 AND $2`,
      [period.from, period.to],
    );
    transferFees = round2(tf?.v ?? 0);
  }
  const grossProfit = round2(revenue - directCost);
  return {
    revenue,
    directCost,
    grossProfit,
    officeExpenses,
    transferFees,
    netProfit: round2(grossProfit - officeExpenses - transferFees),
    byService,
    costByCategory,
    expenseByCategory,
  };
}

/** Revenue, cost, expenses and net profit for each month in the period. */
export async function monthlyPnl(period: Period, service?: ServiceKey): Promise<{ month: string; revenue: number; cost: number; expenses: number; net: number }[]> {
  const sParams: unknown[] = [period.from, period.to];
  let sFilter = '';
  if (service) {
    sParams.push(service);
    sFilter = ' AND s.service = $3';
  }
  const ship = await q<{ month: string; revenue: number; cost: number }>(
    `SELECT to_char(s.ship_date, 'YYYY-MM') AS month,
            COALESCE(SUM(ch.v), 0) AS revenue, COALESCE(SUM(co.v), 0) AS cost
       FROM office_shipments s
       LEFT JOIN (SELECT shipment_id, SUM(usd) AS v FROM office_charges GROUP BY shipment_id) ch ON ch.shipment_id = s.id
       LEFT JOIN (SELECT shipment_id, SUM(usd) AS v FROM office_costs GROUP BY shipment_id) co ON co.shipment_id = s.id
      WHERE s.ship_date BETWEEN $1 AND $2${sFilter}
      GROUP BY 1`,
    sParams,
  );
  const exp = service
    ? []
    : await q<{ month: string; v: number }>(
        `SELECT month, SUM(v) AS v FROM (
           SELECT to_char(exp_date, 'YYYY-MM') AS month, usd AS v FROM office_expenses WHERE exp_date BETWEEN $1 AND $2
           UNION ALL
           SELECT to_char(tr_date, 'YYYY-MM'), usd_out - usd_in FROM office_transfers WHERE tr_date BETWEEN $1 AND $2
         ) x GROUP BY month`,
        [period.from, period.to],
      );
  // Every month in the range, even empty ones, so a chart has no gaps.
  const months: string[] = [];
  const [fy, fm] = period.from.slice(0, 7).split('-').map(Number);
  const [ty, tm] = period.to.slice(0, 7).split('-').map(Number);
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? (y++, (m = 1)) : m++) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return months.map((month) => {
    const s = ship.find((r) => r.month === month);
    const e = exp.find((r) => r.month === month);
    const revenue = s?.revenue ?? 0;
    const cost = s?.cost ?? 0;
    const expenses = round2(e?.v ?? 0);
    return { month, revenue, cost, expenses, net: round2(revenue - cost - expenses) };
  });
}

/* ------------------------------------------------------------------ */
/* Accounts (cash boxes, banks, sarafs)                                */
/* ------------------------------------------------------------------ */

export interface AccountBalance {
  id: number;
  name: string;
  type: string;
  currency: string;
  active: boolean;
  opening: number;
  money_in: number;
  money_out: number;
  balance: number;
  /** balance at today's default rate, for a dollar total across accounts */
  balance_usd: number;
}

export async function accountBalances(): Promise<AccountBalance[]> {
  const rows = await q<Omit<AccountBalance, 'balance' | 'balance_usd'> & { per_usd: number }>(
    `SELECT a.id, a.name, a.type, a.currency, a.active, a.opening_balance AS opening, cur.per_usd,
            COALESCE(pi.v, 0) + COALESCE(ti.v, 0) AS money_in,
            COALESCE(po.v, 0) + COALESCE(ex.v, 0) + COALESCE(tro.v, 0) AS money_out
       FROM office_accounts a
       JOIN office_currencies cur ON cur.code = a.currency
       LEFT JOIN (SELECT account_id, SUM(amount) AS v FROM office_payments WHERE direction = 'in'  GROUP BY account_id) pi ON pi.account_id = a.id
       LEFT JOIN (SELECT account_id, SUM(amount) AS v FROM office_payments WHERE direction = 'out' GROUP BY account_id) po ON po.account_id = a.id
       LEFT JOIN (SELECT account_id, SUM(amount) AS v FROM office_expenses GROUP BY account_id) ex ON ex.account_id = a.id
       LEFT JOIN (SELECT to_account AS id, SUM(amount_in) AS v FROM office_transfers GROUP BY to_account) ti ON ti.id = a.id
       LEFT JOIN (SELECT from_account AS id, SUM(amount_out) AS v FROM office_transfers GROUP BY from_account) tro ON tro.id = a.id
      ORDER BY a.active DESC, a.name`,
  );
  return rows.map(({ per_usd, ...r }) => {
    const balance = round2(r.opening + r.money_in - r.money_out);
    return { ...r, balance, balance_usd: round2(balance / per_usd) };
  });
}

/* ------------------------------------------------------------------ */
/* Cash flow                                                           */
/* ------------------------------------------------------------------ */

export interface CashFlow {
  received: number;
  paidOut: number;
  expenses: number;
  net: number;
  byMethod: { method: string; received: number; paid: number }[];
}

/** Money actually moved in the period (not what was billed or owed). */
export async function cashFlow(period: Period): Promise<CashFlow> {
  const byMethod = await q<{ method: string; received: number; paid: number }>(
    `SELECT method,
            COALESCE(SUM(CASE WHEN kind = 'in' THEN usd END), 0) AS received,
            COALESCE(SUM(CASE WHEN kind = 'out' THEN usd END), 0) AS paid
       FROM (
         SELECT method, direction AS kind, usd FROM office_payments WHERE pay_date BETWEEN $1 AND $2
         UNION ALL
         SELECT method, 'out', usd FROM office_expenses WHERE exp_date BETWEEN $1 AND $2
       ) x GROUP BY method ORDER BY method`,
    [period.from, period.to],
  );
  const t = await one<{ received: number; paid: number; expenses: number }>(
    `SELECT
       (SELECT COALESCE(SUM(usd), 0) FROM office_payments WHERE direction = 'in'  AND pay_date BETWEEN $1 AND $2) AS received,
       (SELECT COALESCE(SUM(usd), 0) FROM office_payments WHERE direction = 'out' AND pay_date BETWEEN $1 AND $2) AS paid,
       (SELECT COALESCE(SUM(usd), 0) FROM office_expenses WHERE exp_date BETWEEN $1 AND $2) AS expenses`,
    [period.from, period.to],
  );
  const received = t?.received ?? 0;
  const paidOut = t?.paid ?? 0;
  const expenses = t?.expenses ?? 0;
  return { received, paidOut, expenses, net: round2(received - paidOut - expenses), byMethod };
}

/* ------------------------------------------------------------------ */
/* Periods                                                             */
/* ------------------------------------------------------------------ */

/**
 * Turn ?period=…&from=…&to=… into a date range. Presets: this-month,
 * last-month, this-year, last-year, all, custom (uses from/to).
 */
export function periodFromParams(params: URLSearchParams, todayStr: string): Period & { key: string; label: string } {
  const key = params.get('period') ?? 'this-month';
  const [y, m] = todayStr.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  switch (key) {
    case 'last-month': {
      const ly = m === 1 ? y - 1 : y;
      const lm = m === 1 ? 12 : m - 1;
      return { key, label: 'Last month', from: `${ly}-${pad(lm)}-01`, to: `${ly}-${pad(lm)}-${lastDay(ly, lm)}` };
    }
    case 'this-year':
      return { key, label: `${y}`, from: `${y}-01-01`, to: `${y}-12-31` };
    case 'last-year':
      return { key, label: `${y - 1}`, from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case 'all':
      return { key, label: 'All time', from: '2000-01-01', to: `${y + 1}-12-31` };
    case 'custom': {
      const ok = (s: string | null) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
      const from = ok(params.get('from')) ? params.get('from')! : `${y}-${pad(m)}-01`;
      const to = ok(params.get('to')) ? params.get('to')! : todayStr;
      return { key, label: `${from} → ${to}`, from: from <= to ? from : to, to: from <= to ? to : from };
    }
    default:
      return { key: 'this-month', label: 'This month', from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${lastDay(y, m)}` };
  }
}
