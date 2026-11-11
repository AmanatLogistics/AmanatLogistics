/**
 * The backup: every record in the office, as an Excel workbook for people to
 * read, and as a restore file (the import bundle format) that rebuilds the
 * office on Import → "Import everything at once".
 *
 * Staff logins and passwords are never part of it.
 */
import { q } from './db';
import { partyBalances, accountBalances, shipmentFigures, pnl, balanceTotals } from './ledger';
import { invoiceStatus, INVOICE_STATUS_LABEL } from './invoices';
import { SERVICES, COST_CATEGORIES, EXPENSE_CATEGORIES, PARTY_KINDS, SHIPMENT_STATUS } from './services';
import { METHODS, round2, today } from './money';
import { buildXlsx, type Cell, type Sheet } from './xlsx';

export interface Debtor {
  name: string;
  phone: string | null;
  owes: number;
}

export interface Backup {
  /** YYYY-MM-DD, Kabul time */
  date: string;
  xlsx: Buffer;
  restoreCsv: string;
  /** Clients who still owe us, largest first. */
  debtors: Debtor[];
  counts: Record<string, number>;
  totals: { receivable: number; payable: number; clientCredit: number; netProfit: number };
}

const label = <T extends Record<string, unknown>>(map: T, k: string) => (Object.prototype.hasOwnProperty.call(map, k) ? String(map[k as keyof T]) : k);
const svcLabel = (k: string) => SERVICES[k as keyof typeof SERVICES]?.short ?? k;

export async function buildBackup(): Promise<Backup> {
  const date = today();
  const [parties, accounts, figs, allTime, totals] = await Promise.all([
    partyBalances(),
    accountBalances(),
    shipmentFigures(),
    pnl({ from: '2000-01-01', to: '2100-12-31' }),
    balanceTotals(),
  ]);
  const partyRows = await q<{ id: number; name: string; kind: string; phone: string | null; city: string | null; country: string | null; address: string | null; notes: string | null; active: boolean }>(
    'SELECT id, name, kind, phone, city, country, address, notes, active FROM office_parties ORDER BY lower(name), id',
  );
  const accountRows = await q<{ id: number; name: string; type: string; currency: string; opening_balance: number; opening_date: string | null; active: boolean }>(
    'SELECT id, name, type, currency, opening_balance, opening_date, active FROM office_accounts ORDER BY id',
  );
  const shipments = await q<{
    id: number; ref: string; service: string; ship_date: string; client_name: string | null; origin: string | null; destination: string | null;
    goods: string | null; pieces: number | null; weight_kg: number | null; chargeable_kg: number | null; cbm: number | null; awb_no: string | null;
    tracking_no: string | null; status: string; notes: string | null; bill_address: string | null; invoice_number: string | null; due_date: string | null; issue_date: string | null;
  }>(
    `SELECT s.id, s.ref, s.service, s.ship_date, p.name AS client_name, s.origin, s.destination, s.goods, s.pieces, s.weight_kg,
            s.chargeable_kg, s.cbm, s.awb_no, s.tracking_no, s.status, s.notes, s.bill_address,
            i.number AS invoice_number, i.due_date, i.issue_date
       FROM office_shipments s
       LEFT JOIN office_parties p ON p.id = s.client_id
       LEFT JOIN office_invoices i ON i.shipment_id = s.id
      ORDER BY s.ship_date, s.id`,
  );
  const charges = await q<{ ref: string; invoice_number: string | null; description: string; qty: number | null; unit: string | null; rate: number | null; amount: number; currency: string; per_usd: number; usd: number }>(
    `SELECT s.ref, i.number AS invoice_number, c.description, c.qty, c.unit, c.rate, c.amount, c.currency, c.per_usd, c.usd
       FROM office_charges c JOIN office_shipments s ON s.id = c.shipment_id LEFT JOIN office_invoices i ON i.shipment_id = s.id
      ORDER BY s.ship_date, s.id, c.sort, c.id`,
  );
  const costs = await q<{ ref: string; category: string; payee: string | null; description: string | null; qty: number | null; rate: number | null; amount: number; currency: string; per_usd: number; usd: number }>(
    `SELECT s.ref, c.category, p.name AS payee, c.description, c.qty, c.rate, c.amount, c.currency, c.per_usd, c.usd
       FROM office_costs c JOIN office_shipments s ON s.id = c.shipment_id LEFT JOIN office_parties p ON p.id = c.payee_id
      ORDER BY s.ship_date, s.id, c.sort, c.id`,
  );
  const payments = await q<{
    pay_date: string; direction: string; party: string; party_kind: string; account: string; method: string; amount: number; currency: string;
    per_usd: number; usd: number; ref: string | null; reference: string | null; notes: string | null; entered_by: string | null;
  }>(
    `SELECT pm.pay_date, pm.direction, pt.name AS party, pt.kind AS party_kind, a.name AS account, pm.method, pm.amount, pm.currency,
            pm.per_usd, pm.usd, s.ref, pm.reference, pm.notes, u.name AS entered_by
       FROM office_payments pm
       JOIN office_parties pt ON pt.id = pm.party_id
       JOIN office_accounts a ON a.id = pm.account_id
       LEFT JOIN office_shipments s ON s.id = pm.shipment_id
       LEFT JOIN office_users u ON u.id = pm.created_by
      ORDER BY pm.pay_date, pm.id`,
  );
  const expenses = await q<{ exp_date: string; category: string; description: string | null; payee: string | null; account: string; amount: number; currency: string; per_usd: number; usd: number; method: string; reference: string | null }>(
    `SELECT e.exp_date, e.category, e.description, p.name AS payee, a.name AS account, e.amount, e.currency, e.per_usd, e.usd, e.method, e.reference
       FROM office_expenses e JOIN office_accounts a ON a.id = e.account_id LEFT JOIN office_parties p ON p.id = e.payee_id
      ORDER BY e.exp_date, e.id`,
  );
  const transfers = await q<{ tr_date: string; from_name: string; from_cur: string; to_name: string; to_cur: string; amount_out: number; per_usd_out: number; usd_out: number; amount_in: number; per_usd_in: number; usd_in: number; reference: string | null }>(
    `SELECT t.tr_date, f.name AS from_name, f.currency AS from_cur, tt.name AS to_name, tt.currency AS to_cur, t.amount_out, t.per_usd_out, t.usd_out,
            t.amount_in, t.per_usd_in, t.usd_in, t.reference
       FROM office_transfers t JOIN office_accounts f ON f.id = t.from_account JOIN office_accounts tt ON tt.id = t.to_account
      ORDER BY t.tr_date, t.id`,
  );
  const activity = await q<{ at: string; user_name: string | null; action: string; entity: string | null; summary: string | null }>(
    `SELECT to_char(a.at AT TIME ZONE 'Asia/Kabul', 'YYYY-MM-DD HH24:MI') AS at, u.name AS user_name, a.action, a.entity, a.summary
       FROM office_activity a LEFT JOIN office_users u ON u.id = a.user_id
      WHERE a.action <> 'login_failed'
      ORDER BY a.at, a.id`,
  );

  const balanceOf = new Map(parties.map((p) => [p.id, p]));
  const debtors: Debtor[] = parties
    .filter((p) => p.kind === 'client' && p.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .map((p) => ({ name: p.name, phone: p.phone, owes: round2(p.balance) }));

  /* ---------- the workbook ---------- */
  const sheets: Sheet[] = [];
  const kv: Cell[][] = [
    ['What', 'US dollars'],
    ['Backup date', date],
    ['Revenue (all time)', allTime.revenue],
    ['Direct costs (all time)', allTime.directCost],
    ['Gross profit (all time)', allTime.grossProfit],
    ['Office expenses (all time)', allTime.officeExpenses],
    ['Transfer fees (all time)', allTime.transferFees],
    ['Net profit (all time)', allTime.netProfit],
    ['Owed to us', totals.receivable],
    ['Clients owe us', round2(debtors.reduce((a, d) => a + d.owes, 0))],
    ['We owe partners', totals.payable],
    ['We hold for clients (paid ahead)', totals.clientCredit],
    ...accounts.map((a): Cell[] => [`Account: ${a.name} (${a.currency})`, a.balance]),
  ];
  sheets.push({ name: 'Summary', rows: kv, money: [1] });
  sheets.push({
    name: 'Unpaid clients',
    rows: [['Client', 'Phone', 'Owes us (USD)'], ...debtors.map((d): Cell[] => [d.name, d.phone, d.owes])],
    money: [2],
  });
  sheets.push({
    name: 'Shipments',
    rows: [
      ['Ref', 'Section', 'Ship date', 'Client', 'From', 'To', 'Goods', 'Pieces', 'Weight kg', 'Chargeable kg', 'CBM', 'AWB', 'Tracking', 'Status', 'Invoice', 'Billed', 'Cost', 'Profit', 'Received', 'Due', 'Bill-to address', 'Notes'],
      ...shipments.map((s): Cell[] => {
        const f = figs.get(s.id);
        return [
          s.ref, svcLabel(s.service), s.ship_date, s.client_name, s.origin, s.destination, s.goods, s.pieces, s.weight_kg, s.chargeable_kg, s.cbm,
          s.awb_no, s.tracking_no, label(SHIPMENT_STATUS, s.status), s.invoice_number, f?.revenue ?? 0, f?.cost ?? 0, f?.profit ?? 0, f?.received ?? 0, f?.due ?? 0,
          s.bill_address, s.notes,
        ];
      }),
    ],
    money: [15, 16, 17, 18, 19],
  });
  sheets.push({
    name: 'Invoices',
    rows: [
      ['Invoice', 'Issued', 'Due date', 'Shipment', 'Client', 'Billed', 'Received', 'Still due', 'Status'],
      ...shipments
        .filter((s) => s.invoice_number)
        .map((s): Cell[] => {
          const f = figs.get(s.id);
          const st = invoiceStatus(f?.revenue ?? 0, f?.received ?? 0, s.due_date, date);
          return [s.invoice_number, s.issue_date, s.due_date, s.ref, s.client_name, f?.revenue ?? 0, f?.received ?? 0, f?.due ?? 0, INVOICE_STATUS_LABEL[st]];
        }),
    ],
    money: [5, 6, 7],
  });
  sheets.push({
    name: 'Charges',
    rows: [['Shipment', 'Invoice', 'Description', 'Qty', 'Unit', 'Rate', 'Amount', 'Currency', 'Per 1 USD', 'USD'], ...charges.map((c): Cell[] => [c.ref, c.invoice_number, c.description, c.qty, c.unit, c.rate, c.amount, c.currency, c.per_usd, c.usd])],
    money: [6, 9],
  });
  sheets.push({
    name: 'Costs',
    rows: [
      ['Shipment', 'Category', 'Owed to', 'Description', 'Qty', 'Rate', 'Amount', 'Currency', 'Per 1 USD', 'USD'],
      ...costs.map((c): Cell[] => [c.ref, label(COST_CATEGORIES, c.category), c.payee, c.description, c.qty, c.rate, c.amount, c.currency, c.per_usd, c.usd]),
    ],
    money: [6, 9],
  });
  sheets.push({
    name: 'Payments',
    rows: [
      ['Date', 'In / out', 'Who', 'Kind', 'Account', 'How', 'Amount', 'Currency', 'Per 1 USD', 'USD', 'Shipment', 'Reference', 'Notes', 'Entered by'],
      ...payments.map((p): Cell[] => [
        p.pay_date, p.direction === 'in' ? 'Received' : 'Paid out', p.party, label(PARTY_KINDS, p.party_kind), p.account, label(METHODS, p.method), p.amount, p.currency, p.per_usd, p.usd,
        p.ref, p.reference, p.notes, p.entered_by,
      ]),
    ],
    money: [6, 9],
  });
  sheets.push({
    name: 'Office expenses',
    rows: [
      ['Date', 'What for', 'Description', 'Paid to', 'Account', 'Amount', 'Currency', 'Per 1 USD', 'USD', 'How', 'Reference'],
      ...expenses.map((e): Cell[] => [e.exp_date, label(EXPENSE_CATEGORIES, e.category), e.description, e.payee, e.account, e.amount, e.currency, e.per_usd, e.usd, label(METHODS, e.method), e.reference]),
    ],
    money: [5, 8],
  });
  sheets.push({
    name: 'Transfers',
    rows: [
      ['Date', 'From', 'Amount out', 'Currency', 'To', 'Amount in', 'Currency', 'Fee (USD)', 'Reference'],
      ...transfers.map((t): Cell[] => [t.tr_date, t.from_name, t.amount_out, t.from_cur, t.to_name, t.amount_in, t.to_cur, round2(t.usd_out - t.usd_in), t.reference]),
    ],
    money: [2, 5, 7],
  });
  sheets.push({
    name: 'Clients & partners',
    rows: [
      ['Name', 'Kind', 'Phone', 'City', 'Country', 'Address', 'Active', 'Billed to them', 'Received from them', 'Their bills to us', 'Paid to them', 'Balance (+ owes us, − we owe)', 'Notes'],
      ...partyRows.map((p): Cell[] => {
        const b = balanceOf.get(p.id);
        return [p.name, label(PARTY_KINDS, p.kind), p.phone, p.city, p.country, p.address, p.active ? 'Yes' : 'No', b?.billed ?? 0, b?.received ?? 0, b?.owed_to_them ?? 0, b?.paid_to_them ?? 0, b?.balance ?? 0, p.notes];
      }),
    ],
    money: [7, 8, 9, 10, 11],
  });
  sheets.push({
    name: 'Accounts',
    rows: [
      ['Account', 'Type', 'Currency', 'Opening balance', 'Money in', 'Money out', 'Balance', 'Balance in USD (today\'s rate)', 'Open'],
      ...accounts.map((a): Cell[] => [a.name, a.type, a.currency, a.opening, a.money_in, a.money_out, a.balance, a.balance_usd, a.active ? 'Yes' : 'No']),
    ],
    money: [3, 4, 5, 6, 7],
  });
  sheets.push({ name: 'Activity log', rows: [['When (Kabul)', 'Who', 'What', 'Record', 'Details'], ...activity.map((a): Cell[] => [a.at, a.user_name, a.action, a.entity, a.summary])] });

  /* ---------- the restore file (Import → Import everything at once) ---------- */
  const csv = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const section = (kind: string, cols: string[], rows: unknown[][]) => [`#${kind}`, cols.join(','), ...rows.map((r) => r.map(csv).join(','))].join('\r\n');
  const restoreCsv =
    '﻿' +
    [
      section('accounts', ['name', 'type', 'currency', 'opening_balance', 'opening_date'], accountRows.map((a) => [a.name, a.type, a.currency, a.opening_balance, a.opening_date])),
      section('parties', ['name', 'kind', 'phone', 'city', 'country', 'notes', 'address', 'active'], partyRows.map((p) => [p.name, p.kind, p.phone, p.city, p.country, p.notes, p.address, p.active ? 'yes' : 'no'])),
      section(
        'shipments',
        ['ref', 'service', 'ship_date', 'client_name', 'origin', 'destination', 'goods', 'pieces', 'weight_kg', 'chargeable_kg', 'cbm', 'awb_no', 'tracking_no', 'status', 'notes', 'bill_address'],
        shipments.map((s) => [s.ref, s.service, s.ship_date, s.client_name, s.origin, s.destination, s.goods, s.pieces, s.weight_kg, s.chargeable_kg, s.cbm, s.awb_no, s.tracking_no, s.status, s.notes, s.bill_address]),
      ),
      section(
        'charges',
        ['shipment_ref', 'description', 'qty', 'unit', 'rate', 'amount', 'currency', 'per_usd', 'invoice_no'],
        charges.map((c) => [c.ref, c.description, c.qty, c.unit, c.rate, c.amount, c.currency, c.per_usd, c.invoice_number]),
      ),
      section(
        'costs',
        ['shipment_ref', 'category', 'payee_name', 'description', 'qty', 'rate', 'amount', 'currency', 'per_usd'],
        costs.map((c) => [c.ref, c.category, c.payee, c.description, c.qty, c.rate, c.amount, c.currency, c.per_usd]),
      ),
      section(
        'payments',
        ['pay_date', 'direction', 'party_name', 'account_name', 'amount', 'per_usd', 'method', 'reference', 'shipment_ref', 'notes'],
        payments.map((p) => [p.pay_date, p.direction, p.party, p.account, p.amount, p.per_usd, p.method, p.reference, p.ref, p.notes]),
      ),
      section(
        'expenses',
        ['exp_date', 'category', 'description', 'account_name', 'amount', 'per_usd', 'method', 'reference', 'payee_name'],
        expenses.map((e) => [e.exp_date, e.category, e.description, e.account, e.amount, e.per_usd, e.method, e.reference, e.payee]),
      ),
      section(
        'transfers',
        ['tr_date', 'from_account', 'to_account', 'amount_out', 'per_usd_out', 'amount_in', 'per_usd_in', 'reference'],
        transfers.map((t) => [t.tr_date, t.from_name, t.to_name, t.amount_out, t.per_usd_out, t.amount_in, t.per_usd_in, t.reference]),
      ),
    ].join('\r\n') +
    '\r\n';

  return {
    date,
    xlsx: buildXlsx(sheets),
    restoreCsv,
    debtors,
    counts: { shipments: shipments.length, invoices: shipments.filter((s) => s.invoice_number).length, payments: payments.length, expenses: expenses.length, parties: partyRows.length },
    totals: { receivable: totals.receivable, payable: totals.payable, clientCredit: totals.clientCredit, netProfit: allTime.netProfit },
  };
}
