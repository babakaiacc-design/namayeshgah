import { existsSync, statSync, unlinkSync } from 'node:fs';
import process from 'node:process';

import sharp from 'sharp';

/**
 * Prepares the unicorn theme backdrop.
 *
 * Anything dropped into public/ ships verbatim and is precached by the service
 * worker, so a full-resolution photo there is not a cosmetic problem: it is
 * megabytes every visitor downloads before the app works offline. The original
 * supplied here was 4416x9804 and 10.4 MB.
 *
 * The image is drawn at low opacity behind the whole page, so a phone at 3x
 * never resolves more than about 1080 across and the quality bar is low.
 *
 *   npm run optimize:backdrop [source]
 */

const SOURCE = process.argv[2] ?? 'public/unicorn.png';
const TARGET = 'public/unicorn.jpg';
const MAX_WIDTH = 1080;
const QUALITY = 72;

if (!existsSync(SOURCE)) {
  console.error(`no source image at ${SOURCE}`);
  console.error('save the picture there, or pass a path as the first argument');
  process.exit(1);
}

const meta = await sharp(SOURCE).metadata();
const sourceBytes = statSync(SOURCE).size;

console.log(`source: ${meta.format} ${meta.width}x${meta.height} ${mb(sourceBytes)}`);

// JPEG rather than PNG: this is a photograph, and PNG would be several times
// larger for no visible gain. Metadata is dropped, which also removes any EXIF
// location the original may have carried.
await sharp(SOURCE)
  .resize({ width: MAX_WIDTH, withoutEnlargement: true })
  .jpeg({ quality: QUALITY, mozjpeg: true })
  .toFile(TARGET);

const outputBytes = statSync(TARGET).size;
const output = await sharp(TARGET).metadata();

console.log(`output: ${output.format} ${output.width}x${output.height} ${kb(outputBytes)}`);
console.log(`saved : ${(100 - (outputBytes / sourceBytes) * 100).toFixed(1)}%`);

// The oversized original must not remain in public/, or it ships anyway.
if (SOURCE.startsWith('public/') && SOURCE !== TARGET) {
  unlinkSync(SOURCE);
  console.log(`removed: ${SOURCE}`);
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}
