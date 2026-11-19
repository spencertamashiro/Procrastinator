// Draws the app and tray icons (a soft crescent on a violet disc) and writes them as
// PNGs into resources/. No image libraries: pixels are computed and encoded by hand.
//   node scripts/make-icons.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources');
mkdirSync(outDir, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const mix = (a, b, t) => a + (b - a) * t;

/** Coverage (0..1) of a disc at (cx, cy) with radius r, anti-aliased over about one pixel. */
const disc = (x, y, cx, cy, r) => clamp01(r - Math.hypot(x - cx, y - cy) + 0.5);

/** Crescent coverage: a disc with an offset disc removed. */
function crescent(x, y, s) {
  const outer = disc(x, y, s * 0.5, s * 0.5, s * 0.27);
  const cut = disc(x, y, s * 0.6, s * 0.42, s * 0.23);
  return clamp01(outer - cut);
}

function appIcon(size) {
  return png(size, (px, py) => {
    const x = px + 0.5;
    const y = py + 0.5;
    const bg = disc(x, y, size / 2, size / 2, size * 0.47);
    const t = clamp01((x + y) / (2 * size));
    // violet gradient, top-left lighter
    const r = mix(124, 62, t);
    const g = mix(113, 54, t);
    const b = mix(214, 150, t);
    const moon = crescent(x, y, size);
    return [Math.round(mix(r, 246, moon)), Math.round(mix(g, 243, moon)), Math.round(mix(b, 255, moon)), Math.round(bg * 255)];
  });
}

function trayIcon(size, template) {
  return png(size, (px, py) => {
    const x = px + 0.5;
    const y = py + 0.5;
    if (template) {
      // macOS template image: black with alpha, the system tints it.
      const s = size * 1.5;
      const off = (s - size) / 2;
      return [0, 0, 0, Math.round(crescent(x + off, y + off, s) * 255)];
    }
    const bg = disc(x, y, size / 2, size / 2, size * 0.48);
    const moon = crescent(x, y, size);
    return [Math.round(mix(104, 246, moon)), Math.round(mix(94, 243, moon)), Math.round(mix(196, 255, moon)), Math.round(bg * 255)];
  });
}

const files = {
  'icon.png': appIcon(512),
  'tray.png': trayIcon(32, false),
  'trayTemplate.png': trayIcon(18, true),
  'trayTemplate@2x.png': trayIcon(36, true),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(path.join(outDir, name), data);
  console.log(`wrote resources/${name} (${data.length} bytes)`);
}
