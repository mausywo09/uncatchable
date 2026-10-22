// Turns the X images in brand/src into the web images in img/.
// White backgrounds are removed by a flood fill from the border, so white inside the dark outlines stays.
// Usage: node brand/prep.mjs
// sharp is borrowed from another project (SHARP_FROM) so this folder needs no node_modules.
// Not part of the site: never deploy the brand/ folder.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'src');
const OUT = join(HERE, '..', 'img');
const require = createRequire(process.env.SHARP_FROM || 'C:/Project/truckpad/package.json');
const sharp = require('sharp');
mkdirSync(OUT, { recursive: true });

// Background = bright, unsaturated pixels connected to the image border
const BG_MIN = 222;
const BG_SAT = 34;
// Outline colour assumed when un-mixing anti-aliased edge pixels from white
const INK = 40;

async function cutout(file) {
  const { data, info } = await sharp(join(SRC, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const bg = new Uint8Array(w * h);
  const isBg = (i) => {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const lo = Math.min(r, g, b), hi = Math.max(r, g, b);
    return lo >= BG_MIN && hi - lo <= BG_SAT;
  };
  const stack = [];
  const seed = (i) => { if (!bg[i] && isBg(i)) { bg[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i / w) | 0;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (y > 0) seed(i - w);
    if (y < h - 1) seed(i + w);
  }
  for (let i = 0; i < w * h; i++) {
    if (bg[i]) { data[i * 4 + 3] = 0; continue; }
    // Soften pixels that touch the background: un-mix them from white
    const x = i % w, y = (i / w) | 0;
    let edge = false;
    for (let dy = -2; dy <= 2 && !edge; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && bg[ny * w + nx]) { edge = true; break; }
      }
    }
    if (!edge) continue;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const a = Math.min(1, Math.max(0, (255 - lum) / (255 - INK)));
    if (a >= 1) continue;
    if (a < 0.04) { data[i * 4 + 3] = 0; continue; }
    for (let c = 0; c < 3; c++) {
      data[i * 4 + c] = Math.max(0, Math.min(255, Math.round((data[i * 4 + c] - (1 - a) * 255) / a)));
    }
    data[i * 4 + 3] = Math.round(a * 255);
  }
  return { data, w, h };
}

// Bounding boxes of the n largest opaque blobs, left to right
function blobs(img, n) {
  const { data, w, h } = img;
  const label = new Int32Array(w * h).fill(-1);
  const boxes = [];
  for (let start = 0; start < w * h; start++) {
    if (label[start] !== -1 || data[start * 4 + 3] < 24) continue;
    const box = { x0: w, y0: h, x1: 0, y1: 0, area: 0 };
    const stack = [start];
    label[start] = boxes.length;
    while (stack.length) {
      const i = stack.pop();
      const x = i % w, y = (i / w) | 0;
      box.area++;
      if (x < box.x0) box.x0 = x; if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y; if (y > box.y1) box.y1 = y;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && label[j] === -1 && data[j * 4 + 3] >= 24) { label[j] = boxes.length; stack.push(j); }
      }
    }
    boxes.push(box);
  }
  img.label = label;
  img.boxes = boxes;
  return [...boxes].sort((a, b) => b.area - a.area).slice(0, n).sort((a, b) => a.x0 - b.x0);
}

const raw = (img) => sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } });

async function save(img, box, name, width, pad = 12) {
  const left = Math.max(0, box.x0 - pad), top = Math.max(0, box.y0 - pad);
  const cw = Math.min(img.w - left, box.x1 - box.x0 + 1 + pad * 2);
  const ch = Math.min(img.h - top, box.y1 - box.y0 + 1 + pad * 2);
  // Keep only blobs that lie wholly inside the crop (sparkles yes, a neighbour's elbow no)
  const crop = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = (top + y) * img.w + left + x, o = (y * cw + x) * 4;
      const b = img.boxes[img.label[i]];
      if (!b || b.x0 < left || b.y0 < top || b.x1 >= left + cw || b.y1 >= top + ch) continue;
      img.data.copy(crop, o, i * 4, i * 4 + 4);
    }
  }
  const buf = await sharp(crop, { raw: { width: cw, height: ch, channels: 4 } }).png().toBuffer();
  await sharp(buf).resize({ width: Math.min(width, cw) }).webp({ quality: 88, alphaQuality: 95 }).toFile(join(OUT, name));
  console.log(name, `${cw}x${ch}`);
}

const crew = await cutout('crew.png');
const crewBoxes = blobs(crew, 4);
const crewNames = ['collector', 'holder', 'scalper', 'rugger'];
for (let k = 0; k < crewBoxes.length; k++) await save(crew, crewBoxes[k], `${crewNames[k]}.webp`, 560);

const myth = await cutout('myth.png');
const mythBoxes = blobs(myth, 3);
const mythNames = ['myth-card', 'myth', 'coin'];
for (let k = 0; k < mythBoxes.length; k++) await save(myth, mythBoxes[k], `${mythNames[k]}.webp`, 560, 40);

const logo = await cutout('logo.png');
const all = blobs(logo, 400).reduce((b, c) => ({
  x0: Math.min(b.x0, c.x0), y0: Math.min(b.y0, c.y0), x1: Math.max(b.x1, c.x1), y1: Math.max(b.y1, c.y1)
}), { x0: logo.w, y0: logo.h, x1: 0, y1: 0 });
await save(logo, all, 'logo.webp', 1100, 8);

// Photos stay as they are, just sized for the web
await sharp(join(SRC, 'scene.jpg')).resize({ width: 1280 }).webp({ quality: 82 }).toFile(join(OUT, 'scene.webp'));
await sharp(join(SRC, 'banner.jpg')).webp({ quality: 82 }).toFile(join(OUT, 'shelf.webp'));

// Icons: the avatar in a circle
const circle = Buffer.from('<svg width="512" height="512"><circle cx="256" cy="256" r="256"/></svg>');
const round = await sharp(join(SRC, 'avatar.jpg')).resize(512, 512).composite([{ input: circle, blend: 'dest-in' }]).png().toBuffer();
await sharp(round).resize(64, 64).png().toFile(join(HERE, '..', 'favicon.png'));
await sharp(join(SRC, 'avatar.jpg')).resize(180, 180).png().toFile(join(HERE, '..', 'apple-touch-icon.png'));
await sharp(round).resize(96, 96).webp({ quality: 90 }).toFile(join(OUT, 'avatar.webp'));

// Share card 1200x630: the shop scene, darkened, with the logo on top
const logoPng = await sharp(join(OUT, 'logo.webp')).resize({ height: 470 }).png().toBuffer();
const shade = Buffer.from('<svg width="1200" height="630"><defs><radialGradient id="g" cx="50%" cy="50%" r="70%"><stop offset="0" stop-color="#0b1030" stop-opacity=".35"/><stop offset="1" stop-color="#060a20" stop-opacity=".88"/></radialGradient></defs><rect width="1200" height="630" fill="url(#g)"/></svg>');
await sharp(join(SRC, 'scene.jpg')).resize(1200, 630, { fit: 'cover' }).blur(2)
  .composite([{ input: shade }, { input: logoPng, gravity: 'center' }])
  .png({ palette: true, quality: 90, compressionLevel: 9 }).toFile(join(HERE, '..', 'og-image.png'));
console.log('done');
