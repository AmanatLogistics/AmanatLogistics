#!/usr/bin/env node
/**
 * Amanat Office — demo data.
 *
 *   node scripts/office-seed.mjs <postgres-url> [--reset]
 *
 * Fills the office tables with eight months of realistic business across all
 * five sections, in mixed currencies, with partial payments, unpaid partners,
 * office expenses and hawala transfers — for trying the system out and for
 * scripts/office-verify.mjs. Deterministic: the same run gives the same data.
 *
 * The tables must already exist (open /office/login once and the app creates
 * them). --reset first deletes all business data (users, currencies and
 * settings are kept) and is refused unless the database is local and its name
 * contains "office" — it can never wipe a live database.
 */
import pg from 'pg';

const url = process.argv[2];
const reset = process.argv.includes('--reset');
if (!url) {
  console.error('Usage: node scripts/office-seed.mjs <postgres-url> [--reset]');
  process.exit(2);
}
const u = new URL(url);
const local = ['localhost', '127.0.0.1'].includes(u.hostname);
const dbName = u.pathname.slice(1);
if (reset && !(local && dbName.includes('office'))) {
  console.error('Refusing --reset: only allowed on a local database whose name contains "office".');
  process.exit(2);
}

/* ---------- deterministic randomness ---------- */
let seed = 20261022;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (a, b) => a + rand() * (b - a);
const intBetween = (a, b) => Math.floor(between(a, b + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const roundTo = (n, step) => Math.round(n / step) * step;
const usdOf = (amount, perUsd) => round2(amount / perUsd);

/* ---------- dates ---------- */
const TODAY = new Date(Date.now() + 4.5 * 3600_000).toISOString().slice(0, 10);
function addDays(d, n) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
const START = addDays(TODAY, -240);
function randomDate(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return new Date(a + rand() * (b - a)).toISOString().slice(0, 10);
}

const client = new pg.Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false } });
await client.connect();
const q = (text, params = []) => client.query(text, params).then((r) => r.rows);

const exists = await q("SELECT to_regclass('office_shipments') AS t");
if (!exists[0].t) {
  console.error('The office tables do not exist yet. Open /office/login once (the app creates them), then run this again.');
  process.exit(1);
}

await q('BEGIN');
try {
  if (reset) {
    await q(`DELETE FROM office_payments; DELETE FROM office_expenses; DELETE FROM office_transfers;
             DELETE FROM office_invoices; DELETE FROM office_costs; DELETE FROM office_charges;
             DELETE FROM office_shipments; DELETE FROM office_accounts; DELETE FROM office_parties;
             DELETE FROM office_counters; DELETE FROM office_activity WHERE action <> 'login';`);
  } else {
    const n = await q('SELECT COUNT(*)::int AS n FROM office_shipments');
    if (n[0].n > 0) throw new Error('There are already shipments. Run with --reset (local test databases only) to replace them.');
  }

  const owner = (await q("SELECT id FROM office_users WHERE role = 'admin' ORDER BY id LIMIT 1"))[0]?.id ?? null;
  const rates = Object.fromEntries((await q('SELECT code, per_usd FROM office_currencies')).map((r) => [r.code, Number(r.per_usd)]));
  // A day's rate wanders a little around the default, as real rates do.
  const rateFor = (cur) => (cur === 'USD' ? 1 : round2(rates[cur] * between(0.97, 1.03)));

  /* ---------- parties ---------- */
  async function party(name, kind, phone, city, country) {
    return (await q(
      'INSERT INTO office_parties (name, kind, phone, city, country, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [name, kind, phone, city, country, owner],
    ))[0].id;
  }
  const clientNames = [
    ['Haji Gul Dry Fruit Traders', 'Kandahar', 'Afghanistan'],
    ['Noor Ahmad & Sons', 'Kandahar', 'Afghanistan'],
    ['Spinzar Trading Co.', 'Kabul', 'Afghanistan'],
    ['Delhi Dry Fruit House', 'New Delhi', 'India'],
    ['Amritsar Kesar Traders', 'Amritsar', 'India'],
    ['Samarkand Fresh LLC', 'Tashkent', 'Uzbekistan'],
    ['Mirzo Ulugbek Import', 'Tashkent', 'Uzbekistan'],
    ['Khyber Wholesale Ltd', 'London', 'United Kingdom'],
    ['Ariana Online Shop', 'Kandahar', 'Afghanistan'],
    ['Zarghuna Garments', 'Kandahar', 'Afghanistan'],
    ['Pamir Electronics', 'Kabul', 'Afghanistan'],
    ['Hotak Pharmacy Supplies', 'Kandahar', 'Afghanistan'],
  ];
  const clients = [];
  for (const [n, city, country] of clientNames) {
    clients.push(await party(n, 'client', `+93 70 ${intBetween(100, 999)} ${intBetween(1000, 9999)}`, city, country));
  }
  const P = {
    kabulAgent: await party('Rahim Khan — Kabul agent', 'agent', '+93 79 210 4411', 'Kabul', 'Afghanistan'),
    chinaAgent: await party('Li Wei — Guangzhou agent', 'agent', '+86 138 0013 8800', 'Guangzhou', 'China'),
    docsHairatan: await party('Hairatan Customs Broker (Sharif)', 'agent', '+93 77 345 1290', 'Hairatan', 'Afghanistan'),
    docsKabul: await party('Kabul Airport Customs Broker', 'agent', '+93 78 900 1120', 'Kabul', 'Afghanistan'),
    tashkentAgent: await party('Bekzod — Tashkent agent', 'agent', '+998 90 123 4567', 'Tashkent', 'Uzbekistan'),
    airportPartner: await party('Tashkent Airport Cargo Partner', 'agent', '+998 71 140 2020', 'Tashkent', 'Uzbekistan'),
    ariana: await party('Ariana Afghan Airlines (Cargo)', 'airline', '+93 20 210 0351', 'Kabul', 'Afghanistan'),
    kamair: await party('Kam Air (Cargo)', 'airline', '+93 20 210 7000', 'Kabul', 'Afghanistan'),
    sarafiTashkent: await party('Sarafi Tashkent (Akmal)', 'sarafi', '+998 93 555 1122', 'Tashkent', 'Uzbekistan'),
    hawalaKabul: await party('Hawala dealer — Kabul (Shah Bazar)', 'sarafi', '+93 70 888 2211', 'Kabul', 'Afghanistan'),
    landlord: await party('Office landlord (Haji Rauf)', 'supplier', '+93 70 300 1001', 'Kandahar', 'Afghanistan'),
    internet: await party('Afghan Wireless (internet)', 'supplier', '+93 79 100 0100', 'Kandahar', 'Afghanistan'),
  };
  const trucks = [];
  for (const n of ['Abdul Wahid — truck', 'Faizullah Transport', 'Mullah Jan — truck', 'Hairatan Uzbek Truck (Rustam)']) {
    trucks.push(await party(n, 'carrier', `+93 7${intBetween(0, 9)} ${intBetween(100, 999)} ${intBetween(1000, 9999)}`, n.includes('Uzbek') ? 'Hairatan' : 'Kandahar', 'Afghanistan'));
  }

  /* ---------- accounts ---------- */
  async function account(name, type, currency, opening) {
    return (await q(
      'INSERT INTO office_accounts (name, type, currency, opening_balance, opening_date) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [name, type, currency, opening, START],
    ))[0].id;
  }
  const A = {
    cashUsd: await account('Cash box Kandahar (USD)', 'cash', 'USD', 0),
    cashAfn: await account('Cash box Kandahar (AFN)', 'cash', 'AFN', 0),
    bank: await account('Azizi Bank — USD account', 'bank', 'USD', 0),
    sarafi: await account('Sarafi Tashkent (held for us)', 'sarafi', 'USD', 0),
    hawala: await account('Hawala Kabul (Shah Bazar)', 'hawala', 'USD', 0),
  };
  const accountCurrency = { [A.cashUsd]: 'USD', [A.cashAfn]: 'AFN', [A.bank]: 'USD', [A.sarafi]: 'USD', [A.hawala]: 'USD' };

  /* ---------- shipments ---------- */
  const plan = [
    ...Array(18).fill('tashkent'),
    ...Array(12).fill('kabul_air'),
    ...Array(12).fill('china'),
    ...Array(10).fill('ups'),
    ...Array(8).fill('other'),
  ];
  const shipments = plan.map((service) => ({ service, date: randomDate(START, TODAY) })).sort((a, b) => (a.date < b.date ? -1 : 1));

  const counters = {};
  const nextNo = (kind, year) => (counters[`${kind}-${year}`] = (counters[`${kind}-${year}`] ?? 0) + 1);
  const pad = (n) => String(n).padStart(4, '0');
  const payments = []; // filled below, inserted at the end
  const goodsBy = {
    tashkent: ['Dried figs', 'Raisins (green)', 'Almonds', 'Dried apricots', 'Pine nuts', 'Fresh pomegranates'],
    kabul_air: ['Raisins (black)', 'Saffron', 'Dried mulberries', 'Fresh grapes', 'Almonds'],
    china: ['Garments', 'Mobile accessories', 'Kitchenware', 'Shoes', 'Electrical fittings'],
    ups: ['Documents & samples', 'Saffron samples', 'Personal parcel', 'Spare parts'],
    other: ['Dry fruit (mixed)', 'Fresh melons', 'Pomegranates'],
  };

  for (const sh of shipments) {
    const year = Number(sh.date.slice(0, 4));
    const ref = `AML-${year}-${pad(nextNo('shipment', year))}`;
    const age = (Date.parse(TODAY) - Date.parse(sh.date)) / 86_400_000;
    const status = age > 25 ? 'delivered' : age > 12 ? 'arrived' : age > 4 ? 'in_transit' : 'booked';
    const clientId = sh.service === 'china' ? pick(clients.slice(8)) : sh.service === 'ups' ? pick(clients) : pick(clients.slice(0, 8));
    let kg = null, chg = null, cbm = null, pieces = null, origin = 'Kandahar', destination = 'Tashkent';
    const charges = [];
    const costs = [];
    const line = (arr, o) => arr.push({ ...o, usd: usdOf(o.amount, o.per_usd) });

    if (sh.service === 'tashkent') {
      kg = roundTo(between(300, 2500), 10); chg = kg; pieces = Math.round(kg / 25);
      destination = pick(['Tashkent → Delhi', 'Tashkent → London', 'Tashkent → Dubai']);
      const rate = round2(between(2.6, 3.4));
      line(charges, { description: 'Air freight via Tashkent', qty: chg, unit: 'kg', rate, amount: round2(chg * rate), currency: 'USD', per_usd: 1 });
      let r;
      r = rateFor('AFN'); const truckAfn = roundTo(between(25000, 40000), 500);
      line(costs, { category: 'truck', payee: pick(trucks.slice(0, 3)), description: 'Truck Kandahar → Hairatan', qty: 1, rate: truckAfn, amount: truckAfn, currency: 'AFN', per_usd: r });
      r = rateFor('AFN'); const docs = roundTo(between(8000, 15000), 500);
      line(costs, { category: 'documents', payee: P.docsHairatan, description: 'Documents — clearance agent', qty: 1, rate: docs, amount: docs, currency: 'AFN', per_usd: r });
      r = rateFor('UZS'); const loadUzs = roundTo(between(1_500_000, 3_000_000), 50_000);
      line(costs, { category: 'loading', payee: P.tashkentAgent, description: 'Loading / unloading — Tashkent agent', qty: 1, rate: loadUzs, amount: loadUzs, currency: 'UZS', per_usd: r });
      const truck2 = roundTo(between(250, 450), 10);
      line(costs, { category: 'truck', payee: trucks[3], description: 'Truck Hairatan → Tashkent airport', qty: 1, rate: truck2, amount: truck2, currency: 'USD', per_usd: 1 });
      const ap = round2(between(1.6, 2.1));
      line(costs, { category: 'airport_partner', payee: P.airportPartner, description: 'Tashkent airport partner (per kg, all-in)', qty: chg, rate: ap, amount: round2(chg * ap), currency: 'USD', per_usd: 1 });
    } else if (sh.service === 'kabul_air') {
      kg = roundTo(between(200, 1500), 10); chg = kg; pieces = Math.round(kg / 20);
      destination = pick(['Kabul → Delhi', 'Kabul → Dubai', 'Kabul → Istanbul']);
      const rate = round2(between(2.2, 2.8));
      line(charges, { description: 'Air freight via Kabul', qty: chg, unit: 'kg', rate, amount: round2(chg * rate), currency: 'USD', per_usd: 1 });
      let r = rateFor('AFN'); const truckAfn = roundTo(between(15000, 25000), 500);
      line(costs, { category: 'truck', payee: pick(trucks.slice(0, 3)), description: 'Truck Kandahar → Kabul', qty: 1, rate: truckAfn, amount: truckAfn, currency: 'AFN', per_usd: r });
      r = rateFor('AFN'); const docs = roundTo(between(5000, 9000), 500);
      line(costs, { category: 'documents', payee: P.docsKabul, description: 'Documents & clearance', qty: 1, rate: docs, amount: docs, currency: 'AFN', per_usd: r });
      const air = round2(between(1.3, 1.7));
      line(costs, { category: 'airline', payee: pick([P.ariana, P.kamair]), description: 'Airline freight (per kg)', qty: chg, rate: air, amount: round2(chg * air), currency: 'USD', per_usd: 1 });
    } else if (sh.service === 'china') {
      cbm = round2(between(2, 18)); pieces = Math.round(cbm * 9); origin = pick(['Guangzhou', 'Yiwu']); destination = 'Kandahar';
      const rate = roundTo(between(170, 210), 5);
      line(charges, { description: 'China → Kandahar consolidation', qty: cbm, unit: 'cbm', rate, amount: round2(cbm * rate), currency: 'USD', per_usd: 1 });
      const r = rateFor('CNY'); const cny = roundTo(between(900, 1100), 10);
      line(costs, { category: 'china_agent', payee: P.chinaAgent, description: 'China agent — loading & transport', qty: cbm, rate: cny, amount: round2(cbm * cny), currency: 'CNY', per_usd: r });
    } else if (sh.service === 'ups') {
      kg = round2(between(5, 80)); chg = round2(kg * between(1, 1.2)); pieces = intBetween(1, 6); destination = pick(['UPS → London', 'UPS → New York', 'UPS → Toronto', 'UPS → Frankfurt']);
      const rate = round2(between(9, 14));
      line(charges, { description: 'Courier via UPS', qty: chg, unit: 'kg', rate, amount: round2(chg * rate), currency: 'USD', per_usd: 1 });
      const rent = roundTo(between(20, 60), 5);
      line(costs, { category: 'kabul_rent', payee: P.kabulAgent, description: 'Kabul rent', qty: 1, rate: rent, amount: rent, currency: 'USD', per_usd: 1 });
      const per = round2(between(6, 9));
      line(costs, { category: 'kabul_agent', payee: P.kabulAgent, description: 'Kabul agent — Dubai & UPS charges', qty: chg, rate: per, amount: round2(chg * per), currency: 'USD', per_usd: 1 });
    } else {
      kg = roundTo(between(500, 3000), 50); chg = kg; destination = pick(['Spin Boldak → Karachi', 'Torkham → Peshawar']);
      const rate = round2(between(0.3, 0.5));
      line(charges, { description: 'Road freight', qty: chg, unit: 'kg', rate, amount: round2(chg * rate), currency: 'USD', per_usd: 1 });
      const r = rateFor('AFN'); const truckAfn = roundTo(between(chg * 12, chg * 22), 500);
      line(costs, { category: 'truck', payee: pick(trucks.slice(0, 3)), description: 'Transport', qty: 1, rate: truckAfn, amount: truckAfn, currency: 'AFN', per_usd: r });
    }
    // A few loss-makers, as real life has: a big discount for a regular client.
    if (rand() < 0.06) {
      const disc = -round2(charges.reduce((a, c) => a + c.usd, 0) * between(0.25, 0.45));
      line(charges, { description: 'Discount — regular client', qty: 1, unit: 'fixed', rate: disc, amount: disc, currency: 'USD', per_usd: 1 });
    }

    const sid = (await q(
      `INSERT INTO office_shipments (ref, service, client_id, ship_date, origin, destination, goods, pieces, weight_kg, chargeable_kg, cbm, awb_no, tracking_no, status, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, $4::date + time '10:00')
       RETURNING id`,
      [ref, sh.service, clientId, sh.date, origin, destination, pick(goodsBy[sh.service]), pieces, kg, chg, cbm,
       ['tashkent', 'kabul_air'].includes(sh.service) ? `${intBetween(100, 999)}-${intBetween(10000000, 99999999)}` : null,
       sh.service === 'ups' ? `1Z${intBetween(100000, 999999)}${intBetween(1000000, 9999999)}` : null,
       status, owner],
    ))[0].id;
    let i = 0;
    for (const c of charges) {
      await q('INSERT INTO office_charges (shipment_id, description, qty, unit, rate, amount, currency, per_usd, usd, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [sid, c.description, c.qty, c.unit, c.rate, c.amount, c.currency, c.per_usd, c.usd, i++]);
    }
    i = 0;
    for (const c of costs) {
      await q('INSERT INTO office_costs (shipment_id, category, payee_id, description, qty, rate, amount, currency, per_usd, usd, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [sid, c.category, c.payee, c.description, c.qty, c.rate, c.amount, c.currency, c.per_usd, c.usd, i++]);
    }
    const invNo = `INV-${year}-${pad(nextNo('invoice', year))}`;
    await q('INSERT INTO office_invoices (number, shipment_id, issue_date, due_date) VALUES ($1,$2,$3,$3::date + 15)', [invNo, sid, sh.date]);

    /* --- money in from the client --- */
    const revenue = round2(charges.reduce((a, c) => a + c.usd, 0));
    const roll = rand();
    let toCollect = revenue;
    if (age < 10 && roll < 0.6) toCollect = 0; // recent: not paid yet
    else if (roll < 0.12) toCollect = round2(revenue * between(0.4, 0.8)); // part paid
    else if (roll < 0.17) toCollect = round2(revenue + roundTo(between(50, 200), 10)); // paid a bit extra (advance)
    const inAccount = sh.service === 'tashkent' ? pick([A.sarafi, A.sarafi, A.hawala])
      : sh.service === 'kabul_air' ? pick([A.bank, A.hawala])
      : sh.service === 'ups' ? A.cashUsd
      : pick([A.cashUsd, A.cashAfn]);
    const method = { [A.sarafi]: 'sarafi', [A.hawala]: 'hawala', [A.bank]: 'bank', [A.cashUsd]: 'cash', [A.cashAfn]: 'cash' }[inAccount];
    const parts = toCollect > 1500 && rand() < 0.5 ? [0.5, 0.5] : [1];
    let left = toCollect;
    parts.forEach((share, k) => {
      if (left <= 0) return;
      const usdPart = k === parts.length - 1 ? left : round2(toCollect * share);
      left = round2(left - usdPart);
      const d = addDays(sh.date, intBetween(2, 35) + k * 10);
      if (d > TODAY) return;
      const cur = accountCurrency[inAccount];
      const per = rateFor(cur);
      const amount = cur === 'USD' ? usdPart : roundTo(usdPart * per, 10);
      payments.push({ direction: 'in', date: d, party: clientId, account: inAccount, shipment: sid, amount, currency: cur, per_usd: per, method,
        reference: method === 'hawala' ? `HW-${intBetween(1000, 9999)}` : method === 'bank' ? `AZB-${intBetween(100000, 999999)}` : method === 'sarafi' ? `SRF-${intBetween(100, 999)}` : null });
    });

    /* --- money out to partners: most costs are settled, recent ones often not --- */
    const byPayee = new Map();
    for (const c of costs) byPayee.set(c.payee, round2((byPayee.get(c.payee) ?? 0) + c.usd));
    for (const [payee, usdDue] of byPayee) {
      if (age < 8 && rand() < 0.7) continue;
      if (rand() < 0.12) continue; // still owed
      const d = addDays(sh.date, intBetween(1, 20));
      if (d > TODAY) continue;
      const isAirline = payee === P.ariana || payee === P.kamair;
      const isUzbek = payee === P.tashkentAgent || payee === P.airportPartner || payee === trucks[3];
      const acc = isAirline ? A.bank : isUzbek ? A.sarafi : costs.find((c) => c.payee === payee).currency === 'AFN' ? A.cashAfn : A.cashUsd;
      const cur = accountCurrency[acc];
      const per = rateFor(cur);
      const amount = cur === 'USD' ? usdDue : roundTo(usdDue * per, 10);
      payments.push({ direction: 'out', date: d, party: payee, account: acc, shipment: sid, amount, currency: cur, per_usd: per,
        method: isAirline ? 'bank' : isUzbek ? 'sarafi' : 'cash', reference: isAirline ? `AWB pay ${intBetween(1000, 9999)}` : null });
    }
  }

  /* ---------- office expenses, monthly ---------- */
  const expenses = [];
  for (let m = new Date(`${START.slice(0, 7)}-01T00:00:00Z`); m.toISOString().slice(0, 10) <= TODAY; m.setUTCMonth(m.getUTCMonth() + 1)) {
    const month = m.toISOString().slice(0, 7);
    const day = (d) => `${month}-${String(d).padStart(2, '0')}`;
    const add = (d, category, description, payee, account, amountUsdOrLocal, method = 'cash') => {
      const date = day(d);
      if (date > TODAY || date < START) return;
      const cur = accountCurrency[account];
      const per = rateFor(cur);
      expenses.push({ date, category, description, payee, account, amount: amountUsdOrLocal, currency: cur, per_usd: per, method });
    };
    add(2, 'rent', `Office rent ${month}`, P.landlord, A.cashUsd, 600);
    add(28, 'salaries', `Salaries ${month} (4 staff)`, null, A.cashUsd, 1850);
    add(5, 'internet', `Internet & phones ${month}`, P.internet, A.cashAfn, 4500);
    add(10, 'utilities', `Electricity ${month}`, null, A.cashAfn, roundTo(between(3000, 6500), 100));
    add(15, 'fuel', `Fuel & local transport ${month}`, null, A.cashAfn, roundTo(between(5000, 10000), 100));
    add(20, 'food', `Tea & guests ${month}`, null, A.cashAfn, roundTo(between(2000, 4000), 100));
    if (rand() < 0.5) add(12, 'stationery', 'Printing & stationery', null, A.cashAfn, roundTo(between(1500, 3500), 100));
    add(25, 'fees', `Bank charges ${month}`, null, A.bank, 15, 'bank');
  }

  /* ---------- hawala transfers: bring Tashkent and Kabul money home ---------- */
  const transfers = [];
  for (let m = new Date(`${START.slice(0, 7)}-01T00:00:00Z`); ; m.setUTCMonth(m.getUTCMonth() + 1)) {
    const month = m.toISOString().slice(0, 7);
    const d1 = `${month}-18`;
    const d2 = `${month}-22`;
    if (d1 > TODAY) break;
    if (d1 >= START) {
      const out = roundTo(between(4000, 9000), 100);
      transfers.push({ date: d1, from: A.sarafi, to: A.cashUsd, amount_out: out, amount_in: round2(out * 0.99), reference: `HW-T${intBetween(100, 999)}` });
    }
    if (d2 >= START && d2 <= TODAY) {
      const out = roundTo(between(2000, 5000), 100);
      transfers.push({ date: d2, from: A.hawala, to: A.bank, amount_out: out, amount_in: round2(out - 15), reference: `HW-K${intBetween(100, 999)}` });
    }
  }

  /* ---------- opening balances that keep every account above zero ---------- */
  const events = [];
  for (const p of payments) events.push({ date: p.date, account: p.account, delta: p.direction === 'in' ? p.amount : -p.amount });
  for (const e of expenses) events.push({ date: e.date, account: e.account, delta: -e.amount });
  for (const t of transfers) {
    events.push({ date: t.date, account: t.from, delta: -t.amount_out });
    events.push({ date: t.date, account: t.to, delta: t.amount_in });
  }
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.delta - a.delta));
  for (const acc of Object.values(A)) {
    let run = 0, low = 0;
    for (const e of events.filter((x) => x.account === acc)) {
      run += e.delta;
      low = Math.min(low, run);
    }
    const cushion = accountCurrency[acc] === 'AFN' ? 50_000 : 1_500;
    const opening = roundTo(-low + cushion, accountCurrency[acc] === 'AFN' ? 1000 : 100);
    await q('UPDATE office_accounts SET opening_balance = $1 WHERE id = $2', [opening, acc]);
  }

  /* ---------- write money rows ---------- */
  for (const p of payments.sort((a, b) => (a.date < b.date ? -1 : 1))) {
    await q(
      `INSERT INTO office_payments (direction, pay_date, party_id, account_id, shipment_id, amount, currency, per_usd, usd, method, reference, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, $2::date + time '14:00')`,
      [p.direction, p.date, p.party, p.account, p.shipment, p.amount, p.currency, p.per_usd, usdOf(p.amount, p.per_usd), p.method, p.reference, owner],
    );
  }
  for (const e of expenses) {
    await q(
      `INSERT INTO office_expenses (exp_date, category, description, payee_id, account_id, amount, currency, per_usd, usd, method, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [e.date, e.category, e.description, e.payee, e.account, e.amount, e.currency, e.per_usd, usdOf(e.amount, e.per_usd), e.method, owner],
    );
  }
  for (const t of transfers) {
    await q(
      `INSERT INTO office_transfers (tr_date, from_account, to_account, amount_out, per_usd_out, usd_out, amount_in, per_usd_in, usd_in, reference, created_by)
       VALUES ($1,$2,$3,$4,1,$4,$5,1,$5,$6,$7)`,
      [t.date, t.from, t.to, t.amount_out, t.amount_in, t.reference, owner],
    );
  }
  for (const [key, value] of Object.entries(counters)) {
    await q('INSERT INTO office_counters (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = GREATEST(office_counters.value, EXCLUDED.value)', [key, value]);
  }
  await q("INSERT INTO office_activity (user_id, action, entity, summary) VALUES ($1, 'demo_seeded', 'system', $2)",
    [owner, `${shipments.length} shipments, ${payments.length} payments, ${expenses.length} expenses, ${transfers.length} transfers`]);
  await q('COMMIT');
  console.log(`Seeded ${clients.length} clients, ${Object.keys(P).length + trucks.length} partners, 5 accounts, ${shipments.length} shipments, ${payments.length} payments, ${expenses.length} expenses, ${transfers.length} transfers (${START} → ${TODAY}).`);
} catch (e) {
  await q('ROLLBACK');
  console.error('Seeding failed, nothing was saved:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
