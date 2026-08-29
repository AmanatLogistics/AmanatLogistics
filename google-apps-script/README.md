# Orders — Google Sheets backend

The Orders section of the tracker (`/orders` and `/orders/admin`) keeps its data
in a Google Sheet. `orders-api.gs` is the whole backend: the website never talks
to Google directly, it calls this script.

The existing shipment tracker is untouched and keeps its own Postgres database.

---

## 1. Prepare the sheet

Create a Google Sheet and name the first tab **Orders**. Put these headers in
row 1 — order them however you like, and leave out any you don't need:

| Header | Meaning |
| --- | --- |
| `Order ID` | Your own reference. Falls back to the row number. |
| `Invoice Number` | **The only field that matters.** The tracking number is built from it. |
| `Tracking Number` | Leave blank — the script fills it in. Type one yourself and it is kept. |
| `Customer Name`, `Phone`, `WhatsApp` | Who the order is for. |
| `Product`, `Quantity`, `Weight` | What is in it. |
| `Origin`, `Destination`, `Shipping Method` | Where it is going. |
| `Order Date`, `Estimated Delivery`, `Actual Delivery` | Dates. Any common format. |
| `Stage` | 1–8, driving the progress timeline. Blank means 1. |
| `Status`, `Notes` | Free text. `Status` is rewritten when you save from the admin. |
| `Stage 1 Date` … `Stage 8 Date` | Optional. Per-stage dates for the timeline. |

Headers are matched by name, ignoring case, spaces and punctuation, so
`Invoice No`, `invoice_number` and `INVOICE #` all work. Columns the script does
not recognise are left alone, and a completely blank row is skipped.

## 2. Deploy the script

1. In the sheet: **Extensions → Apps Script**, and paste in `orders-api.gs`.
2. **Project Settings → Script Properties → Add script property**
   `API_TOKEN` = a long random string you invent.
3. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Copy the `/exec` URL it gives you.

"Anyone" is safe: every request must carry the token, and the script answers
nothing without it. The token lives on the Astro server and never reaches a
browser.

## 3. Point the website at it

Set these in `.env` locally and in Vercel → Settings → Environment Variables:

```
SHEETS_API_URL=https://script.google.com/macros/s/…/exec
SHEETS_API_TOKEN=the same string you put in API_TOKEN
ORDERS_ADMIN_PASSWORD=a strong password for /orders/admin
```

`ORDERS_ADMIN_PASSWORD` must be different from `ADMIN_PASSWORD` and
`TRACKER_ADMIN_PASSWORD`: the three panels have separate cookies, so a session
for one is never a session for another. Local dev falls back to `orders123`.

## 4. Redeploy after editing the script

Apps Script serves the deployed version, not the file you are looking at. After
changing `orders-api.gs`: **Deploy → Manage deployments → edit (pencil) → Version:
New version → Deploy**. The `/exec` URL stays the same.

---

## Tracking numbers

Never typed in by hand and never invented from a counter — a counter would drift
the moment a row was deleted or reordered. Each code is derived from the invoice
number, so the same order always produces the same one:

```
INV-1042   ->  AL-1042
INVOICE/778 -> AL-778
inv 33/a   ->  AL-33A
(blank)    ->  AL-R7        (falls back to the row number)
```

A second row with the same invoice gets `AL-1042-2`, `AL-1042-3`, and so on, so
codes are always unique within the sheet. New codes are written back into the
Tracking Number column the first time the sheet is read, which makes them
permanent — after that they are simply read, never regenerated. A code you type
in yourself is always left alone.

## Reads and writes

- The whole sheet is read in one `getDataRange()` call per request.
- Missing tracking numbers are written back in a **single** `setValues` call
  covering the whole block, not one call per row. Once every row has a code,
  reading writes nothing at all.
- Saving an order writes that one row in one call.
- Writes take a script lock, so two admins saving at once cannot interleave.

## Endpoints

| Request | Answer |
| --- | --- |
| `GET  ?token=…&action=list` | `{ ok: true, orders: [...] }` |
| `GET  ?token=…&action=find&code=…` | `{ ok: true, order: {...} \| null }` — matches tracking **or** invoice number |
| `POST {token, action:'update', id, fields}` | `{ ok: true }` |

Anything missing or unreadable comes back as an empty string rather than an
error: a sparse sheet renders, it does not break. A field the sheet has no
column for is silently skipped on save.
