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
      // An SVG is a document, and it can carry <script>. These files used to be
      // served from Vercel Blob — a different origin, where such a script could
      // do nothing to this site. They are served from our own origin now, so
      // the protection has to be here instead: the sandbox and the empty
      // default-src stop anything in the file from executing or fetching, and
      // nosniff stops a mislabelled file being treated as HTML.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
