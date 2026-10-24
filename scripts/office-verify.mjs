#!/usr/bin/env node
/**
 * Amanat Office — independent check of the ledger.
 *
 *   node scripts/office-verify.mjs <postgres-url> <base-url> <username> <password>
 *
 * Signs in to the running app, reads the ledger's figures from
 * /office/api/summary, then recomputes every one of them here from the raw
 * table rows in plain JavaScript (no SQL sums, no shared code) and compares
 * them to the cent. Also checks the bookkeeping rules every row must follow.
 * Exit code 1 if anything disagrees.
 */
import pg from 'pg';

const [url, base, username, password] = process.argv.slice(2);
if (!url || !base || !username || !password) {
  console.error('Usage: node scripts/office-verify.mjs <postgres-url> <base-url> <username> <password>');
  process.exit(2);
}
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (arr, f) => round2(arr.reduce((a, x) => a + f(x), 0));
const N = (v) => (v === null || v === undefined ? 0 : Number(v));
const problems = [];
let checks = 0;
function same(label, got, want) {
  checks++;
  if (Math.abs(N(got) - N(want)) > 0.011) problems.push(`${label}: app says ${got}, recomputed ${want}`);
}
function rule(label, ok) {
  checks++;
  if (!ok) problems.push(label);
}

/* ---------- 1. the app's figures ---------- */
const login = await fetch(`${base}/office/login`, {
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded', origin: base },
  body: new URLSearchParams({ username, password }),
});
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
if (!cookie.includes('=') || login.status !== 303) {
  console.error(`Could not sign in (HTTP ${login.status}).`);
  process.exit(2);
}
async function summary(from, to) {
  const r = await fetch(`${base}/office/api/summary?from=${from}&to=${to}`, { headers: { cookie } });
  if (!r.ok) throw new Error(`/office/api/summary returned ${r.status}`);
  return r.json();
}

/* ---------- 2. raw rows ---------- */
const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const db = new pg.Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false } });
await db.connect();
const all = async (t) => (await db.query(`SELECT * FROM ${t}`)).rows;
// One client runs one query at a time, so read the tables in turn.
const tables = {};
for (const t of ['parties', 'accounts', 'shipments', 'charges', 'costs', 'invoices', 'payments', 'expenses', 'transfers']) {
  tables[t] = await all(`office_${t}`);
}
const { parties, accounts, shipments, charges, costs, invoices, payments, expenses, transfers } = tables;
await db.end();
const d = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const shipById = new Map(shipments.map((s) => [s.id, s]));

/* ---------- 3. bookkeeping rules on every row ---------- */
for (const [name, rows] of [['charge', charges], ['cost', costs], ['payment', payments], ['expense', expenses]]) {
  for (const r of rows) rule(`${name} ${r.id}: usd ${r.usd} ≠ amount ${r.amount} / rate ${r.per_usd}`, Math.abs(round2(N(r.amount) / N(r.per_usd)) - N(r.usd)) <= 0.011);
}
for (const t of transfers) {
  rule(`transfer ${t.id}: usd_out wrong`, Math.abs(round2(N(t.amount_out) / N(t.per_usd_out)) - N(t.usd_out)) <= 0.011);
  rule(`transfer ${t.id}: usd_in wrong`, Math.abs(round2(N(t.amount_in) / N(t.per_usd_in)) - N(t.usd_in)) <= 0.011);
}
const accById = new Map(accounts.map((a) => [a.id, a]));
for (const p of payments) rule(`payment ${p.id}: currency ${p.currency} ≠ account's ${accById.get(p.account_id)?.currency}`, p.currency === accById.get(p.account_id)?.currency);
for (const e of expenses) rule(`expense ${e.id}: currency ${e.currency} ≠ account's ${accById.get(e.account_id)?.currency}`, e.currency === accById.get(e.account_id)?.currency);
for (const s of shipments) {
  const hasCharges = charges.some((c) => c.shipment_id === s.id);
  const inv = invoices.filter((i) => i.shipment_id === s.id).length;
  if (hasCharges) rule(`shipment ${s.ref}: has charges but ${inv} invoices`, inv === 1);
}
rule('invoice numbers are unique', new Set(invoices.map((i) => i.number)).size === invoices.length);
rule('shipment refs are unique', new Set(shipments.map((s) => s.ref)).size === shipments.length);

/* ---------- 4. recompute and compare (all time, and the current year) ---------- */
const year = new Date().getUTCFullYear();
for (const [from, to] of [['2000-01-01', '2100-12-31'], [`${year}-01-01`, `${year}-12-31`]]) {
  const app = await summary(from, to);
  const inPeriod = (x) => x >= from && x <= to;
  const tag = from === '2000-01-01' ? 'all time' : `${year}`;

  if (from === '2000-01-01') {
    // Parties (balances are all-time by definition)
    for (const p of parties) {
      const billed = sum(charges.filter((c) => shipById.get(c.shipment_id)?.client_id === p.id), (c) => N(c.usd));
      const received = sum(payments.filter((x) => x.direction === 'in' && x.party_id === p.id), (x) => N(x.usd));
      const owed = sum(costs.filter((c) => c.payee_id === p.id), (c) => N(c.usd));
      const paid = sum(payments.filter((x) => x.direction === 'out' && x.party_id === p.id), (x) => N(x.usd));
      const a = app.parties.find((x) => x.id === p.id);
      if (!a) { problems.push(`party ${p.name} missing from the app`); continue; }
      same(`party "${p.name}" billed`, a.billed, billed);
      same(`party "${p.name}" received`, a.received, received);
      same(`party "${p.name}" owed_to_them`, a.owed_to_them, owed);
      same(`party "${p.name}" paid_to_them`, a.paid_to_them, paid);
      same(`party "${p.name}" balance`, a.balance, round2(billed - received - owed + paid));
    }
    let receivable = 0, payable = 0, credit = 0;
    for (const p of parties) {
      const a = app.parties.find((x) => x.id === p.id);
      const b = round2(N(a?.billed) - N(a?.received) - N(a?.owed_to_them) + N(a?.paid_to_them));
      if (b > 0) receivable += b;
      else if (b < 0) (p.kind === 'client' ? (credit += -b) : (payable += -b));
    }
    same('total clients owe us', app.totals.receivable, round2(receivable));
    same('total we owe partners', app.totals.payable, round2(payable));
    same('total we hold for clients', app.totals.clientCredit, round2(credit));

    // Shipments. Received = payments linked to it + its share of the client's
    // payments on account (unlinked in − unlinked out to them), handed out
    // over the client's shipments oldest first (ship date, then id).
    const fig = new Map(shipments.map((s) => {
      const revenue = sum(charges.filter((c) => c.shipment_id === s.id), (c) => N(c.usd));
      const linked = sum(payments.filter((x) => x.direction === 'in' && x.shipment_id === s.id), (x) => N(x.usd));
      return [s.id, { revenue, cost: sum(costs.filter((c) => c.shipment_id === s.id), (c) => N(c.usd)), linked, applied: 0 }];
    }));
    for (const p of parties) {
      let pool = sum(payments.filter((x) => x.party_id === p.id && x.shipment_id == null), (x) => (x.direction === 'in' ? N(x.usd) : -N(x.usd)));
      const theirs = shipments.filter((s) => s.client_id === p.id).sort((x, y) => d(x.ship_date).localeCompare(d(y.ship_date)) || x.id - y.id);
      for (const s of theirs) {
        if (pool <= 0) break;
        const f = fig.get(s.id);
        const take = Math.min(pool, Math.max(round2(f.revenue - f.linked), 0));
        f.applied = round2(take);
        pool = round2(pool - take);
      }
    }
    for (const s of shipments) {
      const { revenue, cost, linked, applied } = fig.get(s.id);
      const received = round2(linked + applied);
      const a = app.shipments[s.id];
      if (!a) { problems.push(`shipment ${s.ref} missing from the app`); continue; }
      same(`${s.ref} revenue`, a.revenue, revenue);
      same(`${s.ref} cost`, a.cost, cost);
      same(`${s.ref} profit`, a.profit, round2(revenue - cost));
      same(`${s.ref} received`, a.received, received);
      same(`${s.ref} paid on account`, a.applied, applied);
      same(`${s.ref} due`, a.due, round2(revenue - received));
    }
    // Paid on account can never exceed what each client paid on account.
    for (const p of parties) {
      const pool = Math.max(sum(payments.filter((x) => x.party_id === p.id && x.shipment_id == null), (x) => (x.direction === 'in' ? N(x.usd) : -N(x.usd))), 0);
      const used = sum(shipments.filter((s) => s.client_id === p.id), (s) => N(app.shipments[s.id]?.applied));
      rule(`party "${p.name}": ${used} applied from ${pool} paid on account`, used <= pool + 0.011);
    }

    // Accounts, in their own currency
    for (const acc of accounts) {
      const bal = round2(
        N(acc.opening_balance)
          + sum(payments.filter((x) => x.account_id === acc.id && x.direction === 'in'), (x) => N(x.amount))
          - sum(payments.filter((x) => x.account_id === acc.id && x.direction === 'out'), (x) => N(x.amount))
          - sum(expenses.filter((x) => x.account_id === acc.id), (x) => N(x.amount))
          + sum(transfers.filter((t) => t.to_account === acc.id), (t) => N(t.amount_in))
          - sum(transfers.filter((t) => t.from_account === acc.id), (t) => N(t.amount_out)),
      );
      const a = app.accounts.find((x) => x.id === acc.id);
      if (!a) { problems.push(`account ${acc.name} missing from the app`); continue; }
      same(`account "${acc.name}" balance (${acc.currency})`, a.balance, bal);
    }
  }

  // Profit & loss for the period
  const shipsIn = shipments.filter((s) => inPeriod(d(s.ship_date)));
  const ids = new Set(shipsIn.map((s) => s.id));
  const revenue = sum(charges.filter((c) => ids.has(c.shipment_id)), (c) => N(c.usd));
  const direct = sum(costs.filter((c) => ids.has(c.shipment_id)), (c) => N(c.usd));
  const officeExp = sum(expenses.filter((e) => inPeriod(d(e.exp_date))), (e) => N(e.usd));
  const fees = sum(transfers.filter((t) => inPeriod(d(t.tr_date))), (t) => N(t.usd_out) - N(t.usd_in));
  same(`P&L ${tag} revenue`, app.pnl.revenue, revenue);
  same(`P&L ${tag} direct cost`, app.pnl.directCost, direct);
  same(`P&L ${tag} gross profit`, app.pnl.grossProfit, round2(revenue - direct));
  same(`P&L ${tag} office expenses`, app.pnl.officeExpenses, officeExp);
  same(`P&L ${tag} transfer fees`, app.pnl.transferFees, fees);
  same(`P&L ${tag} net profit`, app.pnl.netProfit, round2(revenue - direct - officeExp - fees));
  for (const svc of ['ups', 'china', 'tashkent', 'kabul_air', 'other']) {
    const sIds = new Set(shipsIn.filter((s) => s.service === svc).map((s) => s.id));
    const r = sum(charges.filter((c) => sIds.has(c.shipment_id)), (c) => N(c.usd));
    const c = sum(costs.filter((x) => sIds.has(x.shipment_id)), (x) => N(x.usd));
    const a = app.pnl.byService.find((x) => x.service === svc) ?? { revenue: 0, cost: 0, profit: 0, shipments: 0 };
    same(`P&L ${tag} ${svc} revenue`, a.revenue, r);
    same(`P&L ${tag} ${svc} cost`, a.cost, c);
    same(`P&L ${tag} ${svc} shipments`, a.shipments, sIds.size);
  }

  // Cash flow for the period
  same(`cash flow ${tag} received`, app.cashFlow.received, sum(payments.filter((x) => x.direction === 'in' && inPeriod(d(x.pay_date))), (x) => N(x.usd)));
  same(`cash flow ${tag} paid out`, app.cashFlow.paidOut, sum(payments.filter((x) => x.direction === 'out' && inPeriod(d(x.pay_date))), (x) => N(x.usd)));
  same(`cash flow ${tag} expenses`, app.cashFlow.expenses, officeExp);
}

/* ---------- 5. result ---------- */
console.log(`Checked ${checks} figures and rules across ${parties.length} parties, ${shipments.length} shipments, ${payments.length} payments, ${expenses.length} expenses, ${transfers.length} transfers, ${accounts.length} accounts.`);
if (problems.length) {
  console.log(`FAIL — ${problems.length} problem(s):`);
  for (const p of problems.slice(0, 200)) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log('PASS — every figure the app shows matches the independent recalculation.');
