# Amanat Office — staff system

A private, password-protected system at **/office** for running Amanat
Logistics' cargo business: shipments on every route, what each costs and earns,
invoices, money received and paid (cash, hawala, bank, sarafi), office
expenses, cash boxes and accounts, and who owes whom.

Not public: every page calls `guard()`, every page is `noindex`, `/office` is
disallowed in robots.txt, and the only public link is "Staff login" in the
website footer.

## How the business works (what the system models)

Five lines of business ("sections", `src/lib/office/services.ts`):

| key | section | how it runs | billed by |
|---|---|---|---|
| `ups` | Courier — Kabul → Dubai → UPS | sent to Kabul; the Kabul agent forwards to Dubai and hands to UPS. We pay the Kabul agent rent + all other charges. | kg |
| `china` | China consolidation | clients hand cartons to our person in China, who loads and brings them to Kandahar. Client pays on arrival; we pay the China agent and keep a margin. | CBM |
| `tashkent` | Air via Tashkent | Kandahar truck → Hairatan (documents agent, cash) → transload to Tashkent truck (Tashkent agent: loading/unloading) → Tashkent airport partner (price per kg, all-in) → airway bill. Client pays (full or part) — often cash to our sarafi agent in Tashkent, or hawala. Tashkent person paid by the airway bill. | kg |
| `kabul_air` | Air via Kabul airport | Kandahar → Kabul; airline (Ariana Afghan, Kam Air) paid to its bank account. | kg |
| `other` | Other shipments | dry fruit etc. on other routes | kg |

Trucks come from different owners each time → each cost line has its own payee.
Office expenses (rent, salaries, internet…) are separate from shipments.

## Data model (`schema.ts`)

- `office_parties` — EVERYONE money moves to/from: clients, agents, carriers
  (truck owners), airlines, sarafs, suppliers. One table → one statement.
- `office_accounts` — where money sits (cash box, bank, saraf holding money for
  us). ONE currency per account.
- `office_shipments` — one consignment. `office_charges` = what the client is
  billed (revenue). `office_costs` = what it costs us, each with a `payee_id`.
- `office_invoices` — one per shipment, created automatically (`invoices.ts →
  ensureInvoice`) once it has a charge. Its lines ARE the shipment's charges.
- `office_payments` — `direction` `in` (received) or `out` (paid), always from/to
  a party, into/out of an account, optionally linked to a shipment.
- `office_expenses` — office running costs, paid from an account.
- `office_transfers` — moving money between our own accounts (hawala); the
  dollar difference out − in is a transfer fee (a cost).
- `office_activity` — who did what. `office_users` — staff logins.

### Money rule (everywhere, no exceptions)

Every money row stores `amount` + `currency` + `per_usd` (units per 1 USD on the
day) + `usd` (= `toUsd(amount, per_usd)` from `money.ts`). Reports add `usd`.
Default rates come from `office_currencies` (Settings page); the user may
override `per_usd` on each entry. A payment / expense / transfer uses its
ACCOUNT's currency — set `currency` from the account server-side, never trust
the form for it.

### The ledger is the only source of truth (`ledger.ts`)

Never compute a balance, profit or due figure in a page. Use:

- `partyBalances({kind})`, `partyBalance(id)`, `balanceTotals()`,
  `partyStatement(id, from, to)` — balance = billed − received − owed_to_them +
  paid_to_them. > 0 they owe us; < 0 we owe them.
- `shipmentFigures(ids)`, `shipmentFigure(id)` — revenue, cost, profit, received, due.
- `pnl(period, service?)`, `monthlyPnl(period, service?)` — P&L.
- `accountBalances()` — per account, in its own currency (+ USD estimate).
- `cashFlow(period)`; `periodFromParams(url.searchParams, today())`.

If you genuinely need a figure the ledger lacks, add a function to YOUR module's
lib file using exactly the same rules, and say so in your report.

## Conventions

- Astro server pages (`export const prerender = false`), plain HTML forms
  that POST to the same page, then **redirect (303)** with
  `withMsg(path, 'Saved.')` — the `<Flash />` component shows it. Small inline
  `<script is:inline>` only for conveniences (line totals, qty×rate); every form
  must still work without JS.
- Page skeleton:

```astro
---
import OfficeLayout from '../../layouts/OfficeLayout.astro';   // adjust ../ depth
import PageHead from '../../components/office/PageHead.astro';
import Flash from '../../components/office/Flash.astro';
import { guard, sameOrigin, isAdmin } from '../../lib/office/auth';
import { q, one, tx } from '../../lib/office/db';
import { logActivity } from '../../lib/office/activity';
import { str, num, date, oneOf, rows, withMsg } from '../../lib/office/form';
export const prerender = false;
const user = await guard(Astro);              // or guard(Astro, { admin: true })
if (user instanceof Response) return user;
let error: string | null = null;
if (Astro.request.method === 'POST') {
  if (!sameOrigin(Astro.request)) error = 'That request looked unsafe, so it was blocked.';
  else {
    const fd = await Astro.request.formData();
    // validate → on problem set `error` (and re-render with the user's input kept)
    // write inside tx(async (t) => { … q(sql, params, t) …; await logActivity(user.id, 'x_created', 'x', id, summary, t) })
    return Astro.redirect(withMsg(`/office/x/${id}`, 'Saved.'), 303);
  }
}
---
<OfficeLayout title="…" user={user} active="…">
  <PageHead title="…" sub="…" crumbs={[…]}><a class="o-btn primary" href="…">…</a></PageHead>
  <Flash error={error} />
  …
</OfficeLayout>
```

- SQL: ALWAYS bound parameters (`$1`), never string-built values. Dynamic
  ORDER BY / column names only from a fixed whitelist.
- Every create/update/delete writes `logActivity(...)` in the same `tx`.
- Roles: `isAdmin(user)`. Staff must NOT see profit, cost totals, margins, P&L,
  reports, users, settings, or delete buttons. Staff MAY see revenue billed,
  received and due (they collect money), and enter costs on a shipment.
- Deleting money records is admin-only and asks for confirmation
  (`onsubmit="return confirm('…')"`). Refuse to delete a party, account or
  shipment that other records point to — say why.
- UI: only the classes in `src/styles/office.css` (see its header) and the
  components in `src/components/office/` (`PageHead`, `Flash`, `Stat`). Money
  via `fmtMoney(amount, currency)` / `usd(n)`, dates via `fmtDate`, numbers via
  `fmtNum` (money.ts). Negative money in red (`.neg`), positive profit green
  (`.pos`). Tables right-align numbers (`.num`) and have a totals `<tfoot>`.
- Lists: filters in a GET form (`.o-filters`), 50 rows per page with
  `?page=`, newest first, and a CSV export (`?format=csv`) where useful
  (admin-only when it contains profit).
- Plain, friendly English labels — the users are office staff, not
  accountants. Explain balances in words ("Owes us $1,200", "We owe $300").
- Mobile: forms stack (`.o-row` does this), tables scroll (`.o-table-wrap`).
- Print pages (invoice, statement) are standalone HTML (no OfficeLayout) with
  `@page { size: A4; margin: 14mm }`, a Print button (`.no-print`), the maroon
  logo `/images/brand-logo-maroon.png` and the letterhead from `getSettings()`.

## Local development

- Postgres: `postgresql://postgres@127.0.0.1:5433/office` (in `.env` as
  `OFFICE_DATABASE_URL`). Tables are created automatically on first request.
- Dev server: http://127.0.0.1:4321 (Astro 7 runs it as a daemon:
  `npx astro dev status|logs|stop`). Do not start a second one.
- First sign-in locally: `owner` / `office123` (creates the owner). A staff
  test user `ahmad` / `staffpass1` exists.
- Production: set `OFFICE_OWNER_PASSWORD` (and optionally
  `OFFICE_OWNER_USERNAME`, `OFFICE_SESSION_SECRET`) in Vercel; the site's Neon
  `DATABASE_URL` is used automatically.

## Module map (who owns which files)

| module | files |
|---|---|
| foundation | `lib/office/{db,schema,auth,activity,money,services,form,ledger,settings,invoices}.ts`, `layouts/OfficeLayout.astro`, `styles/office.css`, `components/office/{PageHead,Flash,Stat}.astro`, `pages/office/{login,logout,account,users,settings,activity}`, `pages/office/api/summary.ts` |
| shipments | `lib/office/shipments.ts`, `components/office/LineItems.astro`, `pages/office/shipments/**` |
| money | `lib/office/entries.ts`, `pages/office/{payments,expenses,accounts,transfers}/**` |
| parties | `lib/office/parties.ts`, `pages/office/parties/**` |
| insights | `lib/office/insights.ts`, `components/office/{BarChart,PeriodPicker}.astro`, `pages/office/index.astro`, `pages/office/{invoices,sections,reports}/**` |
| data | `lib/office/importer.ts`, `pages/office/import/**`, `scripts/office-seed.mjs`, `scripts/office-verify.mjs` |
