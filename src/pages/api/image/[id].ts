import type { APIRoute } from 'astro';
import { readImage } from '../../../lib/store';

export const prerender = false;

/**
 * Serve a photo uploaded through /admin.
 *
 * Public on purpose — these are the site's own images. The id carries the
 * upload timestamp and a stored image's bytes never change, so the response is
 * marked immutable and Vercel's CDN serves it from then on; the database is
 * touched about once per image, not once per visitor.
 */
export const GET: APIRoute = async ({ params }) => {
  const id = decodeURIComponent(params.id ?? '');
  if (!id) return new Response('Not found', { status: 404 });

  let image: Awaited<ReturnType<typeof readImage>> = null;
  try {
    image = await readImage(id);
  } catch (e) {
    console.error('Reading image failed:', e);
    return new Response('Image unavailable', { status: 503 });
  }
  if (!image) return new Response('Not found', { status: 404 });

  return new Response(image.bytes, {
    headers: {
      'Content-Type': image.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Length': String(image.bytes.byteLength),
    },
  });
};
