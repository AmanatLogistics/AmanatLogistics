# Amanat Logistics — Website

Premium export & freight marketing site. Built with **Astro 7 + Tailwind CSS v4**,
contact form emails via **Resend**, deploys to **Vercel**.

Pages: Home · About · Services · Routes & Coverage · Track Shipment · Gallery · Contact.

---

## ⚠️ Important: project location

This project **cannot be built inside your Windows user folder** because the
username contains a `#` character (`C:\Users\GFDFDFGJ'#\…`), which breaks Astro's
build tools. Keep the project at a clean path like:

```
C:\dev\amanat-website
```

Deployment to Vercel is unaffected (it builds on Linux).

---

## Run it locally

```bash
npm install      # first time only
npm run dev      # preview at http://localhost:4321
npm run build    # production build into dist/ + .vercel/
```

---

## Admin panel — edit the site without code

Open **`/admin`** (e.g. `https://amanatlogistics.com/admin`) and sign in with your
admin password. From there you can edit — changes go live instantly, no redeploy:

- Home hero headline, sub-headline, and background photo
- Trust numbers (tons delivered, orders, countries…)
- Contact details (phones, email, location — also updates WhatsApp button)
- Export products (add/remove, with photos)
- Destination countries on the Routes page
- Gallery photos (upload, categorize, add/remove)
- Team members on the About page
- Shopping platform logos

**Setup (once):**
1. Set `ADMIN_PASSWORD` in `.env` (local) and in Vercel → Settings → Environment
   Variables (production). Local dev fallback password: `admin123`.
2. On Vercel: **Storage → Create → Blob → Connect to project.** That's where
   uploaded images and saved edits live in production. Locally, edits save to
   `.data/` and `public/uploads/` automatically — nothing to configure.

Security: the page is `noindex`, blocked in robots.txt, and every admin API
checks a signed HttpOnly session cookie (7-day expiry). Only someone with the
password can see or change anything.

---

## Shipment tracker

Customers track a consignment at **`/tracking`** by tracking number *or* invoice
number, and see its details plus an 8-stage progress timeline. Staff manage
shipments at **`/tracking/admin`**.

**The tracker admin is a separate panel from `/admin` above**, with its own
password. Whoever updates shipments cannot edit the website, and vice versa —
the two use different session cookies, so signing in to one never grants the
other.

**Setup (once):**

1. **Database.** On Vercel: **Storage → Create Database → Neon → Connect to
   project.** Neon's free plan is plenty for this. `DATABASE_URL` is then set
   automatically and the tracker creates its own tables on first use — there is
   no SQL to import. It also adds new columns to an existing database by itself,
   so upgrading never needs a manual migration. (`db/tracker-schema.sql` documents the tables if you ever
   want to create them by hand.)
2. **Password.** Set `TRACKER_ADMIN_PASSWORD` in Vercel → Settings →
   Environment Variables. Local dev fallback: `tracker123`.

For local development, put a Neon connection string in `.env` as `DATABASE_URL`.
Without one the site still runs: the tracking page tells customers tracking is
temporarily unavailable rather than erroring.

**Using it:**
- **Add a shipment** — enter the shipment details, pick the *current stage*, and
  fill in a date for each stage as it happens. Stages left blank show to the
  customer as "Pending". Stages carry a date only — no time of day.
- **Stage names are editable per shipment**, so you can match the real route
  ("In Salang", "Hairatan Customs Clearance") instead of generic labels.
- **Estimated vs actual delivery** — every shipment has both. *Estimated
  delivery* is required when you create it; *actual delivery* stays blank until
  the consignment arrives, and the "Received" button fills it in with today's
  date. You can also set or correct it by hand on the edit form.
- **WhatsApp button** — enter the number with country code (e.g.
  `923001234567`). Leave it blank to hide the button for that shipment.
- **Edit** a shipment as it moves along; **Delete** removes it and its timeline.

**The dashboard at a glance:**

- **Five counters across the top** — All / Pending / In Transit / Received /
  Overdue. Each one is also a **filter**: click "In Transit" to list only the
  shipments still moving. The counters always show the full picture, so you can
  see how many are in transit while looking at the received ones.
- **Nothing reloads.** The whole list is already in the page, so clicking a
  counter, typing in the search box, or sorting is instant. The address bar
  still updates, so a filtered view can be bookmarked or shared, and reloading
  it brings back the same view.
- **Filter and search together** — type a tracking number, invoice number, or
  customer name and pick a status; the two combine, and results appear as you
  type. "Clear filters" resets both. Press `/` to jump to the search box.
- **Sort** by newest, delivery date, how far along, or customer name.
- **"✓ Received"** on each row marks that shipment delivered in one click: it
  jumps to the final stage and records today as the actual delivery date. The
  row updates in place — green badge, full progress bar, button gone — without
  reloading. It asks for confirmation first, and re-clicking never overwrites
  the delivery date that is already there.
- **Two date columns side by side** — *Est. delivery* and *Actual delivery*,
  with the difference underneath ("5 days late", "3 days early", "on time"), so
  it is obvious at a glance which shipments ran to plan.
- **Status meanings** — *Pending* is stage 1 (booked, not moving yet), *In
  Transit* is stages 2–7, *Received* is the final stage 8. *Overdue* is any
  shipment past its estimated delivery date that has not been received; it also
  shows an orange badge on the row and highlights the date.
- **Delivery dates read plainly** ("15 Aug 2026"), with a note under the
  estimate when one needs attention — "10 days late", "due today", "due in 2 days". Anything
  further out, or already delivered, says nothing.
- **On a phone or tablet** each shipment becomes a card instead of a row, so
  nothing is cut off and there is no sideways scrolling.

These come from each shipment's current stage — there is no separate status to
keep up to date, so the dashboard can never disagree with the timeline the
customer sees.

The panel still works with JavaScript turned off: the counters are ordinary
links, `?status=` and `?q=` are applied by the server, and "Received" falls back
to a normal form submission. Only the live search, sorting, and the
no-reload behaviour need scripting.

### Pashto (پښتو)

The tracking page has an **English / پښتو** button in the top-right of the
tracking card. Switching flips the page to Pashto and lays it out right-to-left,
and the choice is remembered for the customer's next visit. Only the tracking
page is translated — the rest of the site stays English.

Everything a customer normally sees is translated in the code: all the labels
plus the eight standard shipment stages and their descriptions. **This needs no
setup and costs nothing.**

The one gap: a stage *you rename by hand* in the admin to something non-standard
has no written translation, so it stays in English. If you want those covered
too, add a free Azure Translator key:

```
AZURE_TRANSLATOR_KEY=…
AZURE_TRANSLATOR_REGION=westeurope
```

Azure portal → Create a **Translator** resource → *Keys and Endpoint*. The free
tier is 2 million characters a month, far beyond what this site uses — and
because the standard stages are already translated in code, they never hit the
API at all. If the key is missing or the service is unreachable, the page still
loads and simply shows that text in English.

> Replaces the old PHP/MySQL tracker that used to live in `src/Tracker/`. PHP
> cannot run on Vercel, so it was rewritten as Astro pages backed by Postgres.

---

## Orders — the shipment control sheet, in the tracker

A second, unlinked section of the tracker for the shipments recorded in the
**SHIPMENTS** sheet of *Amanat_Shipment_Control_Tracker* — one row per ACCI
invoice, fourteen stages from Kandahar to Delhi.

- **`/orders`** — the customer view. Look up a shipment by ACCI invoice number
  or tracking number and see its details and all fourteen stages.
- **`/orders/admin`** — the staff view. The list, filters and badges of
  `/tracking/admin`, filtered by the workbook's own seven legs (Booked,
  Kandahar, To Hairatan, Hairatan, Uzbekistan, Tashkent Airport, Delivered),
  plus a **Refresh** button that pulls the sheet again without reloading, and
  an edit form that writes back to it.

**It is reachable only by its direct URL.** It appears in no menu, nav bar or
sitemap, is marked `noindex`, and is blocked in `robots.txt`.

Both views are built from the shipment tracker's own layouts, stylesheet,
details panel, timeline and dashboard script, so the two sections look and
behave identically; only the data differs.

**How far along a shipment is** comes from the highest numbered stage date in
its row, never a count of filled cells — route KDR leaves stage 7 empty and
route HRTN leaves stages 1 and 2 empty, so counting would under-report both.

**Tracking numbers are built in code, never typed**: `AM-0031-INV-062` — a
four-digit running sequence plus the number out of the ACCI invoice (`RM-055`
gives `055`). Codes are written back to the sheet the first time it is read, so
they are fixed from then on and stay put when rows are sorted or deleted.

**Setup** is in **`google-apps-script/README.md`**: the one column to add to the
sheet (`Tracking No`), how to deploy `orders-api.gs`, and the three environment
variables (`SHEETS_API_URL`, `SHEETS_API_TOKEN`, `ORDERS_ADMIN_PASSWORD`). The
orders admin has its own password and cookie, so it is a third panel
independent of `/admin` and `/tracking/admin`.

The shipment tracker is untouched by any of this and keeps its Postgres
database; the Orders section never reads or writes it.

---

## 1. Add your real images

The site shows labelled placeholders until you add photos. Drop files into
`public/images/…` using the exact names in **`public/images/README.md`**.
No code changes needed — refresh and they appear.

Edit text content (phone numbers, stats, gallery captions, team names) in
**`src/consts.ts`** — one file, plain values.

Still to confirm before launch:
- Real stat numbers on the Home page (tons, orders, countries, "Since 20XX" year)
- Founder / team names + photos on the About page

---

## 2. Set up email (Resend)

The quote form sends every submission to **info@amanatlogistics.com**, plus an
automatic "we received your request" reply to the customer.

1. Create a free account at **https://resend.com**.
2. **Verify your domain**: Resend → *Domains* → *Add Domain* → `amanatlogistics.com`.
   Add the DNS records they give you (SPF, DKIM) at your domain registrar. This is
   what lets email send from `@amanatlogistics.com` and land in inboxes, not spam.
3. **Create an API key**: Resend → *API Keys* → *Create*. Copy it (starts `re_…`).
4. Locally, copy `.env.example` to `.env` and set:
   ```
   RESEND_API_KEY=re_your_key_here
   MAIL_FROM=Amanat Logistics <noreply@amanatlogistics.com>
   ```
   On Vercel, add these same values under *Project → Settings → Environment Variables*.

**Testing before the domain is verified:** leave `MAIL_FROM` unset. Resend's sandbox
sender only delivers to the email you signed up with — enough to test the flow.

---

## 3. Deploy to Vercel

1. Push this folder to a GitHub repo (private is fine).
2. Go to **https://vercel.com** → *Add New Project* → import the repo.
   Vercel auto-detects Astro; no config needed.
3. Add the environment variables from step 2.
4. Deploy. You get a temporary `*.vercel.app` URL immediately.

### Connect amanatlogistics.com
- Vercel → *Project → Settings → Domains* → add `amanatlogistics.com` and `www.amanatlogistics.com`.
- At your domain registrar, point DNS as Vercel instructs (usually an `A` record
  to Vercel's IP and a `CNAME` for `www`).
- **Don't touch your MX records** — those keep your email working. Only add the
  records Vercel asks for.

---

## Project structure

```
public/images/        ← your photos go here (see its README)
src/consts.ts         ← all editable text/contact/content
src/styles/global.css ← brand colors + fonts (Tailwind v4 theme)
src/layouts/          ← BaseLayout (head, SEO, header/footer)
src/components/        ← Header, Footer, Eyebrow, ImageFrame
src/pages/            ← one file per page (index, about, services, routes, gallery, contact)
src/pages/api/contact.ts ← form → Resend email (server route)

── shipment tracker ──
db/tracker-schema.sql       ← reference schema (created automatically at runtime)
src/lib/session.ts          ← signed-cookie sessions, shared by both admin panels
src/lib/tracker/            ← db connection, queries, auth, form parsing
src/lib/tracker/i18n.ts     ← English + Pashto wording (edit the Pashto here)
src/lib/tracker/translate.ts ← optional Azure fallback for renamed stages
src/pages/tracking/         ← public page + admin (index, new, [id])
src/pages/api/tracker/      ← tracker admin login / logout
src/components/tracker/     ← details panel, timeline, shipment form
```
