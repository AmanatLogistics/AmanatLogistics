/**
 * Content store — where admin edits live.
 *
 * Production (Vercel):   JSON + uploaded images in Vercel Blob
 *                        (BLOB_READ_WRITE_TOKEN is auto-set when a Blob
 *                        store is connected to the project).
 * Local development:     JSON in .data/content.json, images in public/uploads.
 *
 * Public pages call getContent(); admin APIs call saveContent()/saveImage().
 */
import { DEFAULT_CONTENT, type SiteContent } from '../consts';

const CONTENT_KEY = 'amanat/content.json';

export function env(name: string): string | undefined {
  // import.meta.env covers build-time; process.env covers Vercel runtime.
  return (import.meta.env[name] as string | undefined) ?? process.env[name];
}

const hasBlob = () => Boolean(env('BLOB_READ_WRITE_TOKEN'));

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

// Per-instance micro-cache so one page render doesn't fetch repeatedly.
let cache: { data: Partial<SiteContent>; at: number } | null = null;
const CACHE_MS = 3_000;

async function readOverrides(): Promise<Partial<SiteContent>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  let data: Partial<SiteContent> = {};
  try {
    if (hasBlob()) {
      const { list } = await import('@vercel/blob');
      const { blobs } = await list({ prefix: CONTENT_KEY, limit: 1 });
      if (blobs.length) {
        const res = await fetch(`${blobs[0].url}?t=${Date.now()}`);
        if (res.ok) data = await res.json();
      }
    } else {
      const { readFile } = await import('node:fs/promises');
      const raw = await readFile(new URL('../../.data/content.json', import.meta.url), 'utf8');
      data = JSON.parse(raw);
    }
  } catch {
    // No overrides yet (first run) — defaults apply.
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

/* ------------------------------------------------------------------ */
/* Write (admin only — routes verify the session first)                */
/* ------------------------------------------------------------------ */

export async function saveContent(patch: Partial<SiteContent>): Promise<void> {
  const current = await readOverrides();
  const next = { ...current, ...patch };

  if (hasBlob()) {
    const { put } = await import('@vercel/blob');
    await put(CONTENT_KEY, JSON.stringify(next, null, 2), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 0,
    });
  } else {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const dir = new URL('../../.data/', import.meta.url);
    await mkdir(dir, { recursive: true });
    await writeFile(new URL('content.json', dir), JSON.stringify(next, null, 2), 'utf8');
  }
  cache = { data: next, at: Date.now() };
}

/** Store an uploaded image; returns its public URL. */
export async function saveImage(file: File): Promise<string> {
  const safe = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '');
  const name = `${Date.now()}-${safe || 'image'}`;

  if (hasBlob()) {
    const { put } = await import('@vercel/blob');
    const blob = await put(`amanat/uploads/${name}`, file, { access: 'public' });
    return blob.url;
  }

  const { mkdir, writeFile } = await import('node:fs/promises');
  const dir = new URL('../../public/uploads/', import.meta.url);
  await mkdir(dir, { recursive: true });
  await writeFile(new URL(name, dir), Buffer.from(await file.arrayBuffer()));
  return `/uploads/${name}`;
}
