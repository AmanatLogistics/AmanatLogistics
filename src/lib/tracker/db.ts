/**
 * Shipment tracker — database connection (Neon Postgres).
 *
 * Replaces the PHP tracker's MySQL connection (src/Tracker/config.php). Neon is
 * a serverless Postgres with a permanent free tier; connect it from the Vercel
 * dashboard (Storage → Create Database → Neon) and the connection string is
 * injected automatically.
 *
 * The HTTP driver is used rather than a pooled TCP client: each query is a
 * single stateless fetch, so there are no idle connections to exhaust when
 * serverless functions scale up.
 */
import { neon } from '@neondatabase/serverless';
import { env } from '../store';

/** Shown to admins when no database is connected yet. */
export const DB_NOT_CONFIGURED =
  'Database not connected. On Vercel, go to Storage → Create Database → Neon (free plan), connect it to this project, then redeploy. Locally, set DATABASE_URL in .env.';

/**
 * The Vercel/Neon integration sets DATABASE_URL; some setups (and the older
 * Vercel Postgres integration) use POSTGRES_URL instead, so accept either.
 */
function connectionString(): string | undefined {
  return env('DATABASE_URL') || env('POSTGRES_URL');
}

export function isConfigured(): boolean {
  return Boolean(connectionString());
}

type SqlClient = ReturnType<typeof neon>;
let client: SqlClient | null = null;

/** Tagged-template query runner. Values are always sent as bound parameters. */
export function db(): SqlClient {
  if (!client) {
    const url = connectionString();
    if (!url) throw new Error(DB_NOT_CONFIGURED);
    client = neon(url);
  }
  return client;
}

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

let schemaReady: Promise<void> | null = null;

/**
 * Create the tracker tables if they don't exist. Idempotent, and memoised so it
 * costs one round-trip per cold start instead of one per request. This means a
 * fresh database needs no manual SQL import — see db/tracker-schema.sql if you
 * would rather create them by hand.
 */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = db();
      await sql`
        CREATE TABLE IF NOT EXISTS shipments (
          id                 SERIAL PRIMARY KEY,
          tracking_number    TEXT NOT NULL UNIQUE,
          invoice_number     TEXT NOT NULL,
          customer_name      TEXT NOT NULL,
          origin             TEXT NOT NULL DEFAULT '',
          destination        TEXT NOT NULL DEFAULT '',
          total_packages     INTEGER NOT NULL DEFAULT 1,
          total_weight       TEXT NOT NULL DEFAULT '',
          shipping_method    TEXT NOT NULL DEFAULT 'Sea Freight',
          booking_date       DATE NOT NULL,
          estimated_delivery DATE NOT NULL,
          whatsapp_number    TEXT,
          current_step       SMALLINT NOT NULL DEFAULT 1,
          created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS shipment_steps (
          id               SERIAL PRIMARY KEY,
          shipment_id      INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
          step_number      SMALLINT NOT NULL,
          step_title       TEXT NOT NULL,
          step_description TEXT NOT NULL DEFAULT '',
          step_date        DATE,
          step_time        TEXT,
          UNIQUE (shipment_id, step_number)
        )
      `;
      // Customers may search by invoice number; tracking_number is already
      // indexed by its UNIQUE constraint.
      await sql`CREATE INDEX IF NOT EXISTS shipments_invoice_idx ON shipments (invoice_number)`;
    })().catch((e) => {
      schemaReady = null; // let the next request retry a transient failure
      throw e;
    });
  }
  return schemaReady;
}
