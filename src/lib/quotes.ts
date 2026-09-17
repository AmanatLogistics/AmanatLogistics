/**
 * Quote requests — every enquiry the contact form receives.
 *
 * They used to exist only as an email. If that mail was missed, filtered or
 * deleted, the enquiry was gone: nobody could say who had asked, for what, or
 * whether anyone had replied. They are now recorded in the same free Neon
 * Postgres the rest of the site uses, in a table of their own, and the email is
 * still sent as well — the mail is a notification, this is the record.
 *
 * Deliberately independent of lib/store.ts and lib/tracker/db.ts: they share a
 * database and nothing else, so none of them can break the others.
 */
import { neon } from '@neondatabase/serverless';
import { env } from './store';

export const DB_NOT_CONFIGURED =
  'Database not connected. On Vercel, go to Storage → Create Database → Neon (free plan), connect it to this project, then redeploy.';

/** How far along an enquiry is. Ordered as the office works through one. */
export const STATUSES = ['new', 'contacted', 'quoted', 'closed'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  new: 'New',
  contacted: 'Contacted',
  quoted: 'Quoted',
  closed: 'Closed',
};

/** Maps onto the tones already in the admin stylesheet. */
export const STATUS_TONE: Record<Status, string> = {
  new: 'late',
  contacted: 'transit',
  quoted: 'teal',
  closed: 'done',
};

export interface QuoteRequest {
  id: number;
  created_at: string;
  name: string;
  email: string;
  company: string;
  phone: string;
  service: string;
  departure: string;
  destination: string;
  product: string;
  message: string;
  status: Status;
  emailed: boolean;
}

function connectionString(): string | undefined {
  return env('DATABASE_URL') || env('POSTGRES_URL');
}

export const isConfigured = (): boolean => Boolean(connectionString());

let client: ReturnType<typeof neon> | null = null;
function db() {
  if (!client) {
    const url = connectionString();
    if (!url) throw new Error(DB_NOT_CONFIGURED);
    client = neon(url);
  }
  return client;
}

let schemaReady: Promise<void> | null = null;

/** Create the table if it is missing. Memoised: one round trip per cold start. */
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db()`
        CREATE TABLE IF NOT EXISTS quote_requests (
          id          BIGSERIAL PRIMARY KEY,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          name        TEXT NOT NULL,
          email       TEXT NOT NULL,
          company     TEXT NOT NULL DEFAULT '',
          phone       TEXT NOT NULL DEFAULT '',
          service     TEXT NOT NULL DEFAULT '',
          departure   TEXT NOT NULL DEFAULT '',
          destination TEXT NOT NULL DEFAULT '',
          product     TEXT NOT NULL DEFAULT '',
          message     TEXT NOT NULL DEFAULT '',
          status      TEXT NOT NULL DEFAULT 'new',
          emailed     BOOLEAN NOT NULL DEFAULT false
        )`;
      // The list is always newest first; this keeps that cheap as it grows.
      await db()`
        CREATE INDEX IF NOT EXISTS quote_requests_created_idx
        ON quote_requests (created_at DESC)`;
    })().catch((e) => {
      schemaReady = null; // let a later request try again
      throw e;
    });
  }
  return schemaReady;
}

const text = (v: unknown) => (v == null ? '' : String(v));

function normalise(raw: any): QuoteRequest {
  const status = STATUSES.includes(raw?.status) ? (raw.status as Status) : 'new';
  return {
    id: Number(raw?.id) || 0,
    created_at: text(raw?.created_at),
    name: text(raw?.name),
    email: text(raw?.email),
    company: text(raw?.company),
    phone: text(raw?.phone),
    service: text(raw?.service),
    departure: text(raw?.departure),
    destination: text(raw?.destination),
    product: text(raw?.product),
    message: text(raw?.message),
    status,
    emailed: raw?.emailed === true || raw?.emailed === 't' || raw?.emailed === 'true',
  };
}

/**
 * Record an enquiry. Returns its id, or null when there is no database — the
 * caller still sends the email either way, so a missing database loses the
 * record but never the enquiry itself.
 */
export async function saveRequest(
  fields: Omit<QuoteRequest, 'id' | 'created_at' | 'status' | 'emailed'> & { emailed?: boolean },
): Promise<number | null> {
  if (!isConfigured()) return null;
  await ensureSchema();
  const rows = (await db()`
    INSERT INTO quote_requests
      (name, email, company, phone, service, departure, destination, product, message, emailed)
    VALUES
      (${fields.name}, ${fields.email}, ${fields.company}, ${fields.phone}, ${fields.service},
       ${fields.departure}, ${fields.destination}, ${fields.product}, ${fields.message},
       ${fields.emailed === true})
    RETURNING id
  `) as { id: number }[];
  return rows.length ? Number(rows[0].id) : null;
}

/** Newest first. `limit` guards against the page growing without bound. */
export async function listRequests(limit = 500): Promise<QuoteRequest[]> {
  if (!isConfigured()) throw new Error(DB_NOT_CONFIGURED);
  await ensureSchema();
  const rows = (await db()`
    SELECT id, created_at, name, email, company, phone, service,
           departure, destination, product, message, status, emailed
    FROM quote_requests
    ORDER BY created_at DESC
    LIMIT ${limit}
  `) as any[];
  return rows.map(normalise);
}

export async function setStatus(id: number, status: Status): Promise<void> {
  if (!isConfigured()) throw new Error(DB_NOT_CONFIGURED);
  await ensureSchema();
  await db()`UPDATE quote_requests SET status = ${status} WHERE id = ${id}`;
}

export async function deleteRequest(id: number): Promise<void> {
  if (!isConfigured()) throw new Error(DB_NOT_CONFIGURED);
  await ensureSchema();
  await db()`DELETE FROM quote_requests WHERE id = ${id}`;
}

export type StatusCounts = Record<Status | 'total', number>;

export function countByStatus(rows: QuoteRequest[]): StatusCounts {
  const counts = { total: rows.length } as StatusCounts;
  for (const s of STATUSES) counts[s] = 0;
  for (const r of rows) counts[r.status]++;
  return counts;
}

/** '2026-09-17T08:31:00Z' -> '17 Sep 2026, 08:31' in the office's timezone. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kabul',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}
