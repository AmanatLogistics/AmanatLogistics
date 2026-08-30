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
| `Estimated Delivery` | **optional** — add it and the expected date appears beside the actual one |
| `CURRENT STATUS …` | read only, never written |

A stage column is recognised by the number it starts with, so `3  Departed
Kandahar` is stage 3 whatever the rest of the wording says.

Everything else in the workbook — `S.No`, `Customer / Consignee`, the trip IDs,
`Stage No`, `Days in Stage`, `ALERT`, `Remarks`, `DATA CHECK` — is ignored by the
website and **written back untouched** when a row is saved.

### The delivery dates

The **actual** delivery date is stage 14, `14  Delivered to Delhi` — nothing to
add, it is already there.

There is no **estimated** delivery date in SHIPMENTS. Add a column headed
`Estimated Delivery` (or `ETA`, or `Expected Delivery`) and it appears in the
admin next to the actual date, with the difference — "3 days late", "on time",
"2 days early" — and on the customer's page. Without it, that line simply does
not show.

### Nothing else to add to the sheet

The website adds no columns and writes nothing into the sheet for its own
benefit. Tracking numbers are worked out in this script on every read — see
below. The only writes are the ones an admin makes on the edit form, to the
columns above.

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

Two sources, and neither is the sheet:

1. **The register.** `ISSUED_CODES` near the top of `orders-api.gs` holds the
   numbers the office issued before the website existed, `AM-0010` to
   `AM-0031`. Customers may already be holding these, so an invoice listed
   there always gets exactly the code it was given.
2. **A new sequence**, built by the same rule, carrying on past everything in
   the register — so the next new shipment is `AM-0032-INV-…`.

The register is a record of numbers already handed out, not a substitute for
the rule: every entry in it is exactly what the code would build for that
invoice and sequence, and there is a test that proves it. New numbers are never
listed there — they are built.

Where the same invoice sits on more than one row (this sheet has a few), the
first keeps the issued code and the rest are given new ones, so no two
shipments ever share a number.

### Why the numbers do not move

Nothing is stored, so the numbering has to be reproducible from the sheet's
contents alone. It is: rows are walked in the order of the sheet's own **S.No**
column, not the order they physically sit in.

S.No is data rather than a position, and it only ever grows. That gives two
guarantees worth knowing:

- **Sorting or filtering the sheet changes nothing.** Sort by commodity, by
  weight, reverse it — every tracking number stays exactly as it was.
- **Adding a shipment changes nothing**, even a back-dated one. It takes the
  next number; no existing number moves.

Rows with no S.No still get codes — they are simply numbered after the ones
that have it, ordered by invoice date and then invoice number.

**The one thing that does move numbers: deleting a row from the middle.** The
rows after it shift up by one. Shipment rows are normally kept rather than
deleted, so this rarely comes up, but if a number must never move — because a
customer already has it — the fix is to add it to the register, which pins it
for good.

### Correcting a code

A code can be pinned by adding it to `ISSUED_CODES`, keyed by its ACCI invoice
number. That is a one-line change and is how the office's existing numbers are
honoured.

If you would rather staff corrected codes themselves without a code change, add
a column headed `Tracking No` to SHIPMENTS: where that column exists its values
win over everything above, and the tracking number becomes an editable field on
the admin's edit form. The script still never writes a generated code into it —
only what an admin types. The sheet does not need this column and nothing
prompts for it.

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

### Updating the script — the step that is easy to miss

**Apps Script serves the version you last DEPLOYED, not the file in the editor**,
and certainly not the one in this repository. Pasting a new file and saving it
changes nothing on the live site. Every time `orders-api.gs` changes:

1. Paste the current file over the old one in the Apps Script editor.
2. **Deploy → Manage deployments → the pencil icon → Version: *New version* →
   Deploy.**

The `/exec` URL stays the same, so nothing else needs changing.

`SCRIPT_VERSION` at the top of the file exists for exactly this. It is returned
with every reply, and the orders admin compares it against the version the site
expects — if the deployed script is older, the page says so in plain words
instead of just looking broken.

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
