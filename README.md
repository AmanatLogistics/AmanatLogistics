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
   no SQL to import. (`db/tracker-schema.sql` documents the tables if you ever
   want to create them by hand.)
2. **Password.** Set `TRACKER_ADMIN_PASSWORD` in Vercel → Settings →
   Environment Variables. Local dev fallback: `tracker123`.

For local development, put a Neon connection string in `.env` as `DATABASE_URL`.
Without one the site still runs: the tracking page tells customers tracking is
temporarily unavailable rather than erroring.

**Using it:**
- **Add a shipment** — enter the shipment details, pick the *current stage*, and
  fill in a date/time for each stage as it happens. Stages left blank show to the
  customer as "Pending".
- **Stage names are editable per shipment**, so you can match the real route
  ("In Salang", "Hairatan Customs Clearance") instead of generic labels.
- **WhatsApp button** — enter the number with country code (e.g.
  `923001234567`). Leave it blank to hide the button for that shipment.
- **Edit** a shipment as it moves along; **Delete** removes it and its timeline.

> Replaces the old PHP/MySQL tracker that used to live in `src/Tracker/`. PHP
> cannot run on Vercel, so it was rewritten as Astro pages backed by Postgres.

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
src/pages/tracking/         ← public page + admin (index, new, [id])
src/pages/api/tracker/      ← tracker admin login / logout
src/components/tracker/     ← details panel, timeline, shipment form
```
