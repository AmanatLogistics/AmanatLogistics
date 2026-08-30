# Orders — the SHIPMENTS sheet as the backend

The Orders section of the site (`/orders` and `/orders/admin`) reads the
**SHIPMENTS** sheet of *Amanat_Shipment_Control_Tracker*. `orders-api.gs` is the
whole backend: the website never talks to Google directly, it calls this script.

Written against that workbook as it actually is — its header row, its fourteen
stage columns, its `11-Aug-26` dates, its `-` placeholders and its comma'd
weights. The existing shipment tracker at `/tracking` is untouched and keeps its
own Postgres database.

---

## What it reads

Columns are matched **by name**, so they can be reordered and the sheet can hold
any number of other columns — they are read past and left alone.

| Column in SHIPMENTS | Used for |
| --- | --- |
| `ACCI INVOICE NO` | the key; the only column that must have a value |
| `ACCI Invoice Date (booked)` | stage 0 — the shipment exists from here |
| `Commodity`, `Cartons / Pkgs`, `Gross Weight (kg)` | what is in it |
| `KDR Truck Plate`, `TAS Truck Plate` | the two trucks |
| `1 …` through `14 …` | the fourteen stage dates |
| `AWB No`, `Flight No`, `Flight Date` | the air leg |
| `CURRENT STATUS …` | read only, never written |
| **`Tracking No`** | **you need to add this one** — see below |

A stage column is recognised by the number it starts with, so `3  Departed
Kandahar` is stage 3 whatever the rest of the wording says.

Everything else in the workbook — `S.No`, `Customer / Consignee`, the trip IDs,
`Stage No`, `Days in Stage`, `ALERT`, `Remarks`, `DATA CHECK` — is ignored by the
website and **written back untouched** when a row is saved.

### The one column to add

Add a column headed **`Tracking No`** to SHIPMENTS. The script fills it in and
never clears it. Without it the site still works, but it cannot keep the
tracking numbers it issues, and the admin shows a warning saying so.

## How far along a shipment is

The stage is the **highest numbered date column that has a date** — never a
count of filled cells. That is what makes both customs routes work:

- **Route KDR** — cleared in Kandahar first, so stage 7 stays empty.
- **Route HRTN** — the inland leg runs first, so stages 1 and 2 stay empty.

Counting filled cells would under-report both. Leaving those cells blank is
correct, not missing data, and the timeline shows them as passed rather than
pending once the shipment is beyond them.

The seven groups the dashboard filters by are the workbook's own colour key:

| Group | Stages |
| --- | --- |
| Booked | 0 — invoice raised |
| Kandahar | 1–2 |
| To Hairatan | 3–6 |
| Hairatan | 7–9 |
| Uzbekistan | 10–11 |
| Tashkent Airport | 12–13 |
| Delivered | 14 |

## Tracking numbers

The format is **`AM-0031-INV-062`** for ACCI invoice `RN-062`:

```
  AM  -  0031  -  INV  -  062
  ^^     ^^^^              ^^^
prefix  sequence      the invoice's number
```

- **The sequence** is a four-digit running number.
- **The invoice part** is the number out of the ACCI invoice: `RM-055` gives
  `055`, `PH-028` gives `028`, `INV-020` gives `020`. The series prefix is not
  repeated.

### Where a code comes from

Three sources, in order of authority:

1. **The sheet.** A code already in the `Tracking No` column — including one an
   admin edited by hand — is always kept.
2. **The register.** `ISSUED_CODES` near the top of `orders-api.gs` holds the
   numbers the office issued before the website existed, `AM-0010` to `AM-0031`.
   Customers may already be holding these, so an invoice listed there always
   gets exactly the code it was given.
3. **A new sequence**, built by the same rule, carrying on past everything in
   1 and 2 — so the next new shipment is `AM-0032-INV-…`.

The register is a record of numbers already handed out, not a substitute for the
rule: every entry in it is exactly what the code would build for that invoice
and sequence, and there is a test that proves it. New numbers are never listed
there — they are built.

Where the same invoice sits on more than one row (this sheet has a few), the
first row keeps the issued code and the rest are given new ones, so no two
shipments ever share a number.

### It works before the sheet has a Tracking No column

With no `Tracking No` column, codes are still worked out on every read, and
everything — the admin list, customer lookup by code, the timeline — works
normally. What you lose is permanence: they are recomputed each time, so
inserting a row above an unnumbered one can shift the numbers below it, and a
code cannot be edited by hand.

**Adding the column fixes both.** The script fills it in once, and from then on
those codes are simply read, never regenerated.

### Editing a code

With the column present, the tracking number is an ordinary editable field on
the admin's edit form. Whatever you type is kept and is what customers look the
shipment up by. Clear it and the automatic rule takes over again on the next
read.

## Deploying

1. In the sheet: **Extensions → Apps Script**, and paste in `orders-api.gs`.
2. **Project Settings → Script Properties → Add script property**
   `API_TOKEN` = a long random string you invent.
3. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Copy the `/exec` URL.

"Anyone" is safe: every request must carry the token, and the script answers
nothing without it. The token stays on the Astro server; a browser never sees it.

Then set these in `.env` locally and in Vercel → Settings → Environment Variables:

```
SHEETS_API_URL=https://script.google.com/macros/s/…/exec
SHEETS_API_TOKEN=the same string you put in API_TOKEN
ORDERS_ADMIN_PASSWORD=a strong password for /orders/admin
```

`ORDERS_ADMIN_PASSWORD` must differ from `ADMIN_PASSWORD` and
`TRACKER_ADMIN_PASSWORD`: the three panels have separate cookies, so a session
for one is never a session for another. Local dev falls back to `orders123`.

**After editing the script**, Apps Script keeps serving the deployed version:
**Deploy → Manage deployments → edit (pencil) → Version: New version → Deploy**.
The `/exec` URL stays the same.

## Reads and writes

- The sheet is read in one `getDataRange()` call per request.
- New tracking numbers are written back in a **single** `setValues` covering the
  whole block, not one call per row. Once every row has a code, reading writes
  nothing at all.
- Saving a shipment writes that one row in one call, with every column the
  website does not manage left exactly as it was read.
- Writes take a script lock, so two admins saving at once cannot interleave.

## Endpoints

| Request | Answer |
| --- | --- |
| `GET  ?token=…&action=list` | `{ ok, orders, stages, trackingColumn }` |
| `GET  ?token=…&action=find&code=…` | `{ ok, order \| null, stages }` — tracking **or** ACCI invoice number |
| `POST {token, action:'update', id, fields}` | `{ ok: true }` |

Anything missing or unreadable comes back as an empty string rather than an
error: a sparse row renders, it does not break. A field the sheet has no column
for is skipped on save.
