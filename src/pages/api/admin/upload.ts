import type { APIRoute } from 'astro';
import { isAdmin } from '../../../lib/auth';
import { saveImage } from '../../../lib/store';

export const prerender = false;

const MAX_BYTES = 4.4 * 1024 * 1024; // Vercel function body limit is 4.5MB
const OK_TYPES = /^image\/(jpeg|png|webp|avif|gif|svg\+xml)$/;

// Trim blank/transparent padding around a logo so it fills its space on the site.
// SVGs are passed through untouched (already vector, no padding to trim).
async function trimLogo(file: File): Promise<File> {
  if (file.type === 'image/svg+xml') return file;
  try {
    const { default: sharp } = await import('sharp');
    const input = Buffer.from(await file.arrayBuffer());
    const out = await sharp(input)
      .trim({ threshold: 12 }) // remove uniform border (white or transparent)
      .png() // keep transparency
      .toBuffer();
    const base = file.name.replace(/\.\w+$/, '') || 'logo';
    return new File([out], `${base}.png`, { type: 'image/png' });
  } catch (e) {
    console.error('Logo trim skipped (sharp unavailable):', e);
    return file; // graceful fallback — store the original
  }
}

export const POST: APIRoute = async ({ request }) => {
  if (!(await isAdmin(request))) {
    return new Response(JSON.stringify({ error: 'Not authorized.' }), { status: 401 });
  }

  const wantsTrim = new URL(request.url).searchParams.get('trim') === '1';

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get('file');
    if (f instanceof File) file = f;
  } catch {
    /* fallthrough */
  }

  if (!file) return new Response(JSON.stringify({ error: 'No file received.' }), { status: 400 });
  if (!OK_TYPES.test(file.type)) {
    return new Response(JSON.stringify({ error: 'Only image files are allowed.' }), { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return new Response(
      JSON.stringify({ error: 'Image is over 4MB. Please compress it first (try squoosh.app).' }),
      { status: 400 },
    );
  }

  try {
    if (wantsTrim) file = await trimLogo(file);
    const url = await saveImage(file);
    return new Response(JSON.stringify({ ok: true, url }), { status: 200 });
  } catch (e) {
    console.error('Upload failed:', e);
    const msg = e instanceof Error && e.message.startsWith('Storage not connected') ? e.message : 'Upload failed. Try again.';
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
};
