/**
 * Machine-translation fallback for shipment text the written dictionary in
 * ./i18n.ts doesn't cover — i.e. a stage an admin renamed by hand.
 *
 * Uses Azure AI Translator, which supports Pashto (`ps`) and has a free tier of
 * 2 million characters a month — far beyond what a shipment tracker consumes.
 *
 * Set up (optional — everything degrades cleanly without it):
 *   Azure portal → Create a "Translator" resource → Keys and Endpoint
 *   AZURE_TRANSLATOR_KEY=<key 1>
 *   AZURE_TRANSLATOR_REGION=<the resource's region, e.g. westeurope>
 *
 * With no key set, text is returned unchanged in English. A translation failure
 * must never take the tracking page down, so every error path falls back to the
 * original string.
 */
import { env } from '../store';
import { lookupContent, type Lang } from './i18n';

const DEFAULT_ENDPOINT = 'https://api.cognitive.microsofttranslator.com/translate';
const TIMEOUT_MS = 3_000;

/** Overridable for Azure custom/regional endpoints (and for local testing). */
const endpoint = () => env('AZURE_TRANSLATOR_ENDPOINT') || DEFAULT_ENDPOINT;

/** Azure caps a single request; stay well under it. */
const MAX_BATCH = 25;

export const isTranslatorConfigured = (): boolean => Boolean(env('AZURE_TRANSLATOR_KEY'));

/**
 * Translations are stable, so cache them for the life of the instance. Keyed by
 * `lang\ntext`. Shipment stage names repeat constantly across shipments, so this
 * keeps API calls close to zero in practice.
 */
const cache = new Map<string, string>();
const CACHE_MAX = 500;

function remember(key: string, value: string): void {
  // Cheap bound: drop the oldest entry once full.
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

async function callAzure(texts: string[], to: Lang): Promise<string[] | null> {
  const key = env('AZURE_TRANSLATOR_KEY');
  if (!key) return null;
  const region = env('AZURE_TRANSLATOR_REGION');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${endpoint()}?api-version=3.0&from=en&to=${to}&textType=plain`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        ...(region ? { 'Ocp-Apim-Subscription-Region': region } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(texts.map((Text) => ({ Text }))),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`Azure Translator returned ${res.status}: ${await res.text()}`);
      return null;
    }

    const data = (await res.json()) as { translations?: { text?: string }[] }[];
    // Positional response — a length mismatch means we can't trust the mapping.
    if (!Array.isArray(data) || data.length !== texts.length) return null;

    return data.map((row, i) => row?.translations?.[0]?.text || texts[i]);
  } catch (e) {
    // Includes the abort on timeout. Never rethrow — the page must still render.
    console.error('Azure Translator call failed:', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Translate many strings at once.
 *
 * Order of resolution per string: written dictionary → cache → Azure → original.
 * Returns an array matching the input positions.
 */
export async function translateMany(texts: string[], lang: Lang): Promise<string[]> {
  if (lang === 'en') return texts;

  const out = [...texts];
  // Positions still needing the API, de-duplicated by text so a repeated string
  // costs one translation rather than one per occurrence.
  const needed = new Map<string, number[]>();

  texts.forEach((text, i) => {
    if (!text?.trim()) return;

    const written = lookupContent(text, lang);
    if (written !== null) {
      out[i] = written;
      return;
    }

    const cacheKey = `${lang}\n${text}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      out[i] = cached;
      return;
    }

    const slot = needed.get(text);
    if (slot) slot.push(i);
    else needed.set(text, [i]);
  });

  if (!needed.size || !isTranslatorConfigured()) return out;

  const unique = [...needed.keys()];
  for (let start = 0; start < unique.length; start += MAX_BATCH) {
    const chunk = unique.slice(start, start + MAX_BATCH);
    const translated = await callAzure(chunk, lang);
    if (!translated) continue; // leave these in English

    chunk.forEach((text, j) => {
      const value = translated[j];
      remember(`${lang}\n${text}`, value);
      for (const i of needed.get(text) ?? []) out[i] = value;
    });
  }

  return out;
}

/** Single-string convenience wrapper. */
export async function translateOne(text: string, lang: Lang): Promise<string> {
  return (await translateMany([text], lang))[0];
}
