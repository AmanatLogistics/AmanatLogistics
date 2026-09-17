/**
 * Generate a WebP sibling for every image in public/images, and record each
 * one's real pixel size.
 *
 * Two problems this solves:
 *   • weight — the gallery was shipping 3.4 MB of JPEG on first load;
 *   • layout shift — no <img> declared its size, so the gallery jumped as
 *     pictures arrived (CLS 0.107, above Google's 0.1 "good" threshold).
 *
 * The originals stay exactly where they are and are still what <img src> points
 * at, so nothing breaks if a browser cannot take WebP and nothing depends on
 * this script having been run.
 *
 * Run it after adding or replacing a photo:   npm run images
 */
import sharp from 'sharp';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = 'public/images';
const MANIFEST = 'src/lib/image-manifest.json';
const QUALITY = 78; // visually indistinguishable here, ~40% smaller than the JPEG
/**
 * A narrow variant for pictures that are only ever shown small — the product
 * tiles run five across and are about 215px wide, so an 800px file is four
 * times more than the screen can use, even allowing for a retina display.
 */
const SMALL_WIDTH = 480;

const walk = async (dir) => {
  const out = [];
  for (const name of await readdir(dir)) {
    const p = path.join(dir, name);
    if ((await stat(p)).isDirectory()) out.push(...(await walk(p)));
    else if (/\.(jpe?g|png)$/i.test(name)) out.push(p);
  }
  return out;
};

const files = (await walk(ROOT)).sort();
const manifest = {};
let before = 0;
let after = 0;

for (const file of files) {
  const buf = await readFile(file);
  const meta = await sharp(buf).metadata();
  const webpPath = file.replace(/\.(jpe?g|png)$/i, '.webp');
  const webp = await sharp(buf).webp({ quality: QUALITY }).toBuffer();

  // Only keep the WebP when it is actually smaller — a few small PNGs are not.
  const useWebp = webp.length < buf.length * 0.95;
  if (useWebp) await writeFile(webpPath, webp);

  // Worth a narrow variant only when the original is comfortably wider than it.
  let small;
  if (useWebp && (meta.width ?? 0) > SMALL_WIDTH * 1.35) {
    const smallPath = file.replace(/\.(jpe?g|png)$/i, `-${SMALL_WIDTH}.webp`);
    await writeFile(
      smallPath,
      await sharp(buf).resize({ width: SMALL_WIDTH }).webp({ quality: QUALITY }).toBuffer(),
    );
    small = '/' + path.relative('public', smallPath).split(path.sep).join('/');
  }

  before += buf.length;
  after += useWebp ? webp.length : buf.length;

  manifest['/' + path.relative('public', file).split(path.sep).join('/')] = {
    w: meta.width,
    h: meta.height,
    ...(useWebp ? { webp: '/' + path.relative('public', webpPath).split(path.sep).join('/') } : {}),
    ...(small ? { small, smallW: SMALL_WIDTH } : {}),
  };
}

await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

const kb = (n) => Math.round(n / 1024) + ' KB';
console.log(`${files.length} images — ${kb(before)} → ${kb(after)} (${Math.round((1 - after / before) * 100)}% smaller)`);
console.log(`manifest: ${MANIFEST}`);
