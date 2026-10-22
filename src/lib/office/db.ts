/**
 * Amanat Office — database connection.
 *
 * The staff system uses node-postgres (`pg`) rather than the Neon HTTP driver
 * the website uses, for two reasons: money records need real transactions
 * (a payment and its activity-log line succeed or fail together), and the same
 * driver then works against Neon in production and a plain local Postgres in
 * development, so what is tested locally is what runs live.
 *
 * Connection: OFFICE_DATABASE_URL if set, otherwise the site's DATABASE_URL
 * (Neon, set by the Vercel integration). The office tables all start with
 * `office_`, so they share the database with the tracker without touching it.
 */
import pg from 'pg';
import { env } from '../store';
import { MIGRATIONS } from './schema';

const { Pool, types } = pg;

// NUMERIC arrives as a string by default; money here is two decimals and well
// inside double precision, so read it as a number (every sum is re-rounded).
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)) as unknown as string);
// COUNT(*) and other int8 results.
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)) as unknown as string);
// DATE stays a plain 'YYYY-MM-DD' string: turning it into a JS Date would shift
// it by the server's time zone and an invoice dated the 1st could print the 31st.
types.setTypeParser(1082, (v) => v);

export const DB_NOT_CONFIGURED =
  'The office database is not connected. On Vercel the site\'s Neon database (DATABASE_URL) is used automatically; locally set OFFICE_DATABASE_URL or DATABASE_URL in .env.';

function connectionString(): string | undefined {
  return env('OFFICE_DATABASE_URL') || env('DATABASE_URL') || env('POSTGRES_URL');
}

export function isConfigured(): boolean {
  return Boolean(connectionString());
}

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    const url = connectionString();
    if (!url) throw new Error(DB_NOT_CONFIGURED);
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    pool = new Pool({
      connectionString: url,
      // Neon requires TLS; a local Postgres usually has none.
      ssl: local ? undefined : { rejectUnauthorized: false },
      // Serverless: each function instance keeps only a couple of connections.
      max: 5,
      idleTimeoutMillis: 10_000,
      // A request that cannot get a connection fails with an error after 10 s
      // instead of waiting forever.
      connectionTimeoutMillis: 10_000,
      // A transaction left open by a crashed request releases its locks after
      // a minute rather than blocking everyone behind it.
      options: '-c idle_in_transaction_session_timeout=60000',
    });
    // An idle connection the server drops (Neon restart) must not crash the process.
    pool.on('error', (e) => console.error('Office DB pool error:', e.message));
  }
  return pool;
}

/** Anything that can run a query: the pool, or a client inside a transaction. */
export interface Runner {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

/** Run a query, return all rows. Values are always bound parameters ($1, $2…). */
export async function q<T = any>(text: string, params: unknown[] = [], runner?: Runner): Promise<T[]> {
  await ensureSchema();
  const r = await (runner ?? getPool()).query(text, params);
  return r.rows as T[];
}

/** Run a query, return the first row or null. */
export async function one<T = any>(text: string, params: unknown[] = [], runner?: Runner): Promise<T | null> {
  const rows = await q<T>(text, params, runner);
  return rows[0] ?? null;
}

/**
 * Run `fn` inside a transaction. Everything it does through the `tx` runner
 * commits together or not at all — use it for every write that touches more
 * than one row.
 */
export async function tx<T>(fn: (tx: Runner) => Promise<T>): Promise<T> {
  await ensureSchema();
  const client = await getPool().connect();
  // Without a listener, a connection dropped mid-transaction would throw an
  // unhandled 'error' event and take the whole server down.
  const onErr = (e: Error) => console.error('Office DB connection error:', e.message);
  client.on('error', onErr);
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.off('error', onErr);
    client.release();
  }
}

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

let schemaReady: Promise<void> | null = null;

/**
 * Apply any migrations not yet applied. Numbered and recorded in
 * office_migrations, so a later change to the tables is a new entry in
 * schema.ts rather than an edit to an old one. An advisory lock stops two cold
 * starts racing each other on a fresh database.
 */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(724519)');
        await client.query(
          'CREATE TABLE IF NOT EXISTS office_migrations (id INT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
        );
        const done = new Set(
          (await client.query('SELECT id FROM office_migrations')).rows.map((r: { id: number }) => r.id),
        );
        for (const m of MIGRATIONS) {
          if (done.has(m.id)) continue;
          await client.query(m.sql);
          await client.query('INSERT INTO office_migrations (id) VALUES ($1)', [m.id]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    })().catch((e) => {
      schemaReady = null; // let the next request try again
      throw e;
    });
  }
  return schemaReady;
}
