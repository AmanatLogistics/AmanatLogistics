/**
 * Content store — where admin edits live.
 *
 * Production:        Neon Postgres (the same free database the shipment
 *                    tracker uses, in its own tables — site_content for the
 *                    text, site_images for uploaded photos).
 * Local development: JSON in .data/content.json, images in public/uploads,
 *                    so the site runs with no database at all.
 *
 * Public pages call getContent(); admin APIs call saveContent()/saveImage().
 *
 * This used to be Vercel Blob, and Blob's free tier suspended the store. The
 * reason was the read path, not the amount stored: every page view ran a
 * list() — a metered "advanced operation", ~10k a month on the free plan — and
 * then re-downloaded the file with a cache-busting query string, so the CDN
 * could never serve it. A few hundred visitors a day was enough. Postgres has
 * no per-operation meter, the row is a few kilobytes, and the read below is a
 * single indexed SELECT behind a short cache.
 */
import { neon } from '@neondatabase/serverless';
import { DEFAULT_CONTENT, type SiteContent } from '../consts';

/** One row holds the whole content document. */
const CONTENT_ID = 'site';

export function env(name: string): string | undefined {
  // import.meta.env covers build-time; process.env covers Vercel runtime.
  return (import.meta.env[name] as string | undefined) ?? process.env[name];
}

/**
 * The Vercel/Neon integration sets DATABASE_URL; some setups (and the older
 * Vercel Postgres integration) use POSTGRES_URL instead, so accept either.
 * Deliberately read here rather than imported from lib/tracker/db.ts: the two
 * share a database but nothing else, so the tracker cannot be broken from here.
 */
function connectionString(): string | undefined {
  return env('DATABASE_URL') || env('POSTGRES_URL');
}

const hasDb = () => Boolean(connectionString());

let client: ReturnType<typeof neon> | null = null;
function db() {
  if (!client) {
    const url = connectionString();
    if (!url) throw new Error(DB_NOT_CONFIGURED);
    client = neon(url);
  }
  return client;
}

// On Vercel/serverless the filesystem is read-only, so writes need the database.
const isServerless = () =>
  Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);

/** Shown to the admin when no database is connected (message reaches the UI). */
export const DB_NOT_CONFIGURED =
  'Database not connected. On Vercel, go to Storage → Create Database → Neon (free plan), connect it to this project, then redeploy. Saving works locally without this.';

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

let schemaReady: Promise<void> | null = null;

/**
 * Create this module's own two tables if they are missing. Idempotent, and
 * memoised so it costs one round trip per cold start rather than one per
 * request. The tracker's tables are created by lib/tracker/db.ts and are not
 * touched here.
 */
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = db();
      await sql`
        CREATE TABLE IF NOT EXISTS site_content (
          id         TEXT PRIMARY KEY,
          data       JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await sql`
        CREATE TABLE IF NOT EXISTS site_images (
          id           TEXT PRIMARY KEY,
          content_type TEXT NOT NULL,
          -- base64 rather than bytea: it survives the HTTP driver unambiguously,
          -- and Postgres compresses the column anyway.
          bytes        TEXT NOT NULL,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
    })().catch((e) => {
      schemaReady = null; // let a later request try again
      throw e;
    });
  }
  return schemaReady;
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

/**
 * Per-instance cache. Eleven components ask for the content while one page
 * renders, so without this each page would query eleven times. Ten seconds is
 * short enough that a save shows up on the next refresh and long enough to
 * collapse a burst of traffic into one query; a save also refreshes this
 * directly, so the admin's own next request never waits for it to expire.
 */
let cache: { data: Partial<SiteContent>; at: number } | null = null;
const CACHE_MS = 10_000;

async function readOverrides(): Promise<Partial<SiteContent>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  let data: Partial<SiteContent> = {};
  try {
    if (hasDb()) {
      await ensureSchema();
      const rows = (await db()`
        SELECT data FROM site_content WHERE id = ${CONTENT_ID}
      `) as { data: Partial<SiteContent> }[];
      if (rows.length && rows[0].data) data = rows[0].data;
    } else {
      const { readFile } = await import('node:fs/promises');
      const raw = await readFile(new URL('../../.data/content.json', import.meta.url), 'utf8');
      data = JSON.parse(raw);
    }
  } catch (e) {
    // Defaults apply. Logged rather than swallowed: a site quietly serving its
    // built-in text because storage is unreachable looked exactly like a site
    // whose admin had never saved anything, and that cost a long time to spot.
    console.error('Reading site content failed — serving built-in defaults:', e);
  }
  cache = { data, at: Date.now() };
  return data;
}

/** Defaults merged with whatever the admin has saved. */
export async function getContent(): Promise<SiteContent> {
  const o = await readOverrides();
  return {
    brand: { ...DEFAULT_CONTENT.brand, ...o.brand },
    hero: { ...DEFAULT_CONTENT.hero, ...o.hero },
    contact: { ...DEFAULT_CONTENT.contact, ...o.contact },
    services: { ...DEFAULT_CONTENT.services, ...o.services },
    about: { ...DEFAULT_CONTENT.about, ...o.about },
    seo: { ...DEFAULT_CONTENT.seo, ...o.seo },
    images: { ...DEFAULT_CONTENT.images, ...o.images },
    shopping: { ...DEFAULT_CONTENT.shopping, ...o.shopping },
    pageHeaders: {
      services: { ...DEFAULT_CONTENT.pageHeaders.services, ...o.pageHeaders?.services },
      about: { ...DEFAULT_CONTENT.pageHeaders.about, ...o.pageHeaders?.about },
      routes: { ...DEFAULT_CONTENT.pageHeaders.routes, ...o.pageHeaders?.routes },
      gallery: { ...DEFAULT_CONTENT.pageHeaders.gallery, ...o.pageHeaders?.gallery },
      contact: { ...DEFAULT_CONTENT.pageHeaders.contact, ...o.pageHeaders?.contact },
      tracking: { ...DEFAULT_CONTENT.pageHeaders.tracking, ...o.pageHeaders?.tracking },
    },
    freightModes: o.freightModes ?? DEFAULT_CONTENT.freightModes,
    shoppingSteps: o.shoppingSteps ?? DEFAULT_CONTENT.shoppingSteps,
    stats: o.stats ?? DEFAULT_CONTENT.stats,
    exports: o.exports ?? DEFAULT_CONTENT.exports,
    destinations: o.destinations ?? DEFAULT_CONTENT.destinations,
    gallery: o.gallery ?? DEFAULT_CONTENT.gallery,
    team: o.team ?? DEFAULT_CONTENT.team,
    platforms: o.platforms ?? DEFAULT_CONTENT.platforms,
    why: o.why ?? DEFAULT_CONTENT.why,
    values: o.values ?? DEFAULT_CONTENT.values,
  };
}

/** One stored image, for the route that serves it. */
export async function readImage(
  id: string,
): Promise<{ contentType: string; bytes: ArrayBuffer } | null> {
  if (!hasDb()) return null;
  await ensureSchema();
  const rows = (await db()`
    SELECT content_type, bytes FROM site_images WHERE id = ${id}
  `) as { content_type: string; bytes: string }[];
  if (!rows.length) return null;

  // Buffer.from draws from a shared pool, so `.buffer` is usually a much larger
  // block with this image somewhere inside it. Slice to this image's own range —
  // handing back the whole pool would serve the wrong bytes.
  const buf = Buffer.from(rows[0].bytes, 'base64');
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

  return { contentType: rows[0].content_type, bytes };
}

/* ------------------------------------------------------------------ */
/* Write (admin only — routes verify the session first)                */
/* ------------------------------------------------------------------ */

export async function saveContent(patch: Partial<SiteContent>): Promise<void> {
  const current = await readOverrides();
  const next = { ...current, ...patch };

  if (hasDb()) {
    await ensureSchema();
    await db()`
      INSERT INTO site_content (id, data, updated_at)
      VALUES (${CONTENT_ID}, ${JSON.stringify(next)}::jsonb, now())
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()
    `;
  } else if (isServerless()) {
    throw new Error(DB_NOT_CONFIGURED);
  } else {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const dir = new URL('../../.data/', import.meta.url);
    await mkdir(dir, { recursive: true });
    await writeFile(new URL('content.json', dir), JSON.stringify(next, null, 2), 'utf8');
  }
  cache = { data: next, at: Date.now() };
}

/** Store an uploaded image; returns the URL the site should use for it. */
export async function saveImage(file: File): Promise<string> {
  const safe = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '');
  const name = `${Date.now()}-${safe || 'image'}`;

  if (hasDb()) {
    await ensureSchema();
    const bytes = Buffer.from(await file.arrayBuffer()).toString('base64');
    await db()`
      INSERT INTO site_images (id, content_type, bytes)
      VALUES (${name}, ${file.type || 'application/octet-stream'}, ${bytes})
      ON CONFLICT (id) DO UPDATE SET content_type = EXCLUDED.content_type, bytes = EXCLUDED.bytes
    `;
    // The id carries a timestamp and its bytes never change, so the route that
    // serves it can mark it immutable and let the CDN do the work from then on.
    return `/api/image/${encodeURIComponent(name)}`;
  }

  if (isServerless()) throw new Error(DB_NOT_CONFIGURED);

  const { mkdir, writeFile } = await import('node:fs/promises');
  const dir = new URL('../../public/uploads/', import.meta.url);
  await mkdir(dir, { recursive: true });
  await writeFile(new URL(name, dir), Buffer.from(await file.arrayBuffer()));
  return `/uploads/${name}`;
}

/* ------------------------------------------------------------------ */
/* Diagnostics                                                         */
/* ------------------------------------------------------------------ */

/**
 * Write a row, read it back, delete it.
 *
 * A failed save can mean no storage configured, or storage that is connected
 * but refusing the write — and both look identical from the browser. This runs
 * the same round trip a save does against whichever storage is actually in use
 * and reports what really happened, so it can be read off a URL rather than
 * guessed at. Called only from /api/admin/status?test=1, which is admin-only.
 */
export async function storageSelfTest(): Promise<{
  ok: boolean;
  backend: string;
  step: string;
  error?: string;
  errorName?: string;
}> {
  if (!hasDb()) {
    if (isServerless()) {
      return { ok: false, backend: 'none', step: 'configuration', error: DB_NOT_CONFIGURED, errorName: 'NoDatabase' };
    }
    let step = 'local file write';
    try {
      const { mkdir, writeFile, readFile, unlink } = await import('node:fs/promises');
      const dir = new URL('../../.data/', import.meta.url);
      await mkdir(dir, { recursive: true });
      const file = new URL(`.selftest-${Date.now()}.txt`, dir);
      await writeFile(file, 'ok', 'utf8');
      step = 'local file read';
      await readFile(file, 'utf8');
      await unlink(file);
      return { ok: true, backend: 'local files', step: 'done' };
    } catch (e) {
      return {
        ok: false, backend: 'local files', step,
        error: e instanceof Error ? e.message : String(e),
        errorName: e instanceof Error ? e.name : 'Unknown',
      };
    }
  }

  const id = `.selftest-${Date.now()}`;
  let step = 'connect';
  try {
    await ensureSchema();
    const sql = db();

    step = 'write';
    await sql`INSERT INTO site_content (id, data) VALUES (${id}, ${'{"ok":true}'}::jsonb)`;

    step = 'read back';
    const rows = (await sql`SELECT data FROM site_content WHERE id = ${id}`) as { data: unknown }[];
    if (!rows.length) throw new Error('The row was written but could not be read back.');

    return { ok: true, backend: 'Neon Postgres', step: 'done' };
  } catch (e) {
    return {
      ok: false, backend: 'Neon Postgres', step,
      error: e instanceof Error ? e.message : String(e),
      errorName: e instanceof Error ? e.name : 'Unknown',
    };
  } finally {
    // In a finally, because a test that fails halfway is exactly when this runs —
    // leaving its scratch row behind every time would slowly fill the table.
    try {
      await db()`DELETE FROM site_content WHERE id = ${id}`;
    } catch {
      /* nothing more to do; the row is harmless and ignored by getContent() */
    }
  }
}
