// Draw the site's app icons and write them to public/, plus the inline
// apple-touch-icon data URI module. An authoring tool, not a build step: run it
// by hand after changing the art below, and commit what it writes. Deploys
// serve the committed files; nothing runs this at deploy time.
//
//   node scripts/build-icons.mjs           write public/*.png, public/favicon.ico,
//                                          src/assets/apple-touch-icon.js
//   node scripts/build-icons.mjs --check   write nothing; exit 1 if any committed
//                                          file's PIXELS differ from the art here
//
// No dependencies: the art is two filled shapes on a background, so it is
// rasterized here with 8x8 supersampling and encoded with node:zlib. The check
// compares decoded pixels rather than file bytes, so a different zlib build
// (another Node version) cannot fail it on identical images.
//
// No icon on this site is an SVG — not the tab icon, not the manifest, not the
// touch icon. iOS cannot use an SVG for Add to Home Screen and falls back to a
// letter tile; Chrome's WebAPK install wants raster 192 and 512 icons.

import { writeFile, readFile, readdir } from "node:fs/promises";
import { deflateSync, inflateSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const ROOT = new URL("../", import.meta.url);
export const PUBLIC_DIR = new URL("public/", ROOT);
export const TOUCH_MODULE = new URL("src/assets/apple-touch-icon.js", ROOT);

const NAVY = [0x0b, 0x3d, 0x61];
const SUN = [0xf5, 0xb3, 0x01];
const CLOUD = [0xdf, 0xe7, 0xee];
const WHITE = [0xff, 0xff, 0xff];

// Shapes are in a 512-unit square (the favicon art in a 32-unit one) and are
// scaled to the output size. Painted in order; later shapes cover earlier ones.
const rect = (color) => ({ color, inside: () => true });
const roundRect = (color, size, r) => ({
  color,
  inside: (x, y) => {
    const dx = Math.max(r - x, 0, x - (size - r));
    const dy = Math.max(r - y, 0, y - (size - r));
    return dx * dx + dy * dy <= r * r;
  },
});
const ellipse = (color, cx, cy, rx, ry) => ({
  color,
  inside: (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1,
});
const circle = (color, cx, cy, r) => ellipse(color, cx, cy, r, r);
const minus = (a, b) => ({ color: a.color, inside: (x, y) => a.inside(x, y) && !b.inside(x, y) });

// Full-bleed: opaque navy to every edge. Used where the platform cuts its own
// shape (maskable icons, the iOS touch icon) or where transparency would render
// black (link-preview images). The art sits inside the maskable safe zone, a
// centred circle of radius 40% (204.8 units); its farthest point is ~156 units
// out, which scripts/test-icons.mjs re-measures from the pixels.
const FULL_BLEED = { unit: 512, shapes: [rect(NAVY), circle(SUN, 216, 240, 92), ellipse(CLOUD, 286, 298, 118, 68)] };

// `purpose: "any"`: shown as-is (desktop install, splash screen), so a rounded
// navy tile with the art 1.2x larger, scaled about the centre.
const ANY = {
  unit: 512,
  shapes: [roundRect(NAVY, 512, 96), circle(SUN, 208, 236.8, 110.4), ellipse(CLOUD, 292, 306.4, 141.6, 81.6)],
};

// Tab icon: the original favicon art, sun behind cloud, transparent background.
const TAB = { unit: 32, shapes: [circle(SUN, 13, 15, 8), ellipse(CLOUD, 19, 20, 10, 6)] };

// Notification badge: Android draws only the alpha channel, in its own colour,
// in the status bar. One white silhouette, with a transparent gap cut around the
// cloud so the sun still reads as a separate shape.
const BADGE = {
  unit: 32,
  shapes: [
    minus(circle(WHITE, 13, 15, 8), ellipse(WHITE, 19, 20, 11.4, 7.4)),
    ellipse(WHITE, 19, 20, 10, 6),
  ],
};

// Every file in public/. The test asserts public/ holds exactly these.
export const ICONS = [
  { file: "favicon-32.png", size: 32, art: TAB },
  { file: "icon-192.png", size: 192, art: ANY },
  { file: "icon-512.png", size: 512, art: ANY },
  { file: "icon-maskable-512.png", size: 512, art: FULL_BLEED },
  { file: "apple-touch-icon.png", size: 180, art: FULL_BLEED },
  { file: "og-image.png", size: 512, art: FULL_BLEED },
  { file: "notification-badge.png", size: 96, art: BADGE },
];
export const FAVICON_ICO = { file: "favicon.ico", sizes: [16, 32, 48], art: TAB };

const SS = 8; // samples per axis per pixel

// RGBA, straight (non-premultiplied) alpha, row-major.
export function rasterize(art, size) {
  const out = new Uint8Array(size * size * 4);
  const scale = art.unit / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) * scale;
          const y = (py + (sy + 0.5) / SS) * scale;
          let c = null;
          for (const s of art.shapes) if (s.inside(x, y)) c = s.color;
          if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
        }
      }
      const i = (py * size + px) * 4;
      if (a) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
        out[i + 3] = Math.round((a * 255) / (SS * SS));
      }
    }
  }
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

// 8-bit truecolour; RGB when every pixel is opaque, else RGBA. Per-row filter
// chosen by the usual minimum-sum-of-absolute-differences heuristic.
export function encodePng(rgba, size) {
  let opaque = true;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) { opaque = false; break; }
  const bpp = opaque ? 3 : 4;
  const stride = size * bpp;
  const raw = Buffer.alloc(size * stride);
  for (let p = 0, o = 0; p < rgba.length; p += 4) {
    raw[o++] = rgba[p]; raw[o++] = rgba[p + 1]; raw[o++] = rgba[p + 2];
    if (!opaque) raw[o++] = rgba[p + 3];
  }
  const filtered = Buffer.alloc(size * (stride + 1));
  const cand = Buffer.alloc(stride);
  for (let y = 0; y < size; y++) {
    const row = raw.subarray(y * stride, (y + 1) * stride);
    const up = y ? raw.subarray((y - 1) * stride, y * stride) : null;
    let best = null, bestScore = Infinity, bestType = 0;
    for (let t = 0; t < 5; t++) {
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0, b = up ? up[i] : 0, c = up && i >= bpp ? up[i - bpp] : 0;
        const pred = t === 0 ? 0 : t === 1 ? a : t === 2 ? b : t === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const v = (row[i] - pred) & 0xff;
        cand[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) { bestScore = score; bestType = t; best = Buffer.from(cand); }
    }
    const o = y * (stride + 1);
    filtered[o] = bestType;
    best.copy(filtered, o + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6; // bit depth, colour type
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(filtered, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Decode the PNGs this script writes (8-bit RGB/RGBA, non-interlaced) back to
// RGBA. Verifies the signature and every chunk CRC on the way.
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw new Error("not a PNG");
  let off = 8, width, height, depth, type, interlace;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const kind = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (crc32(buf.subarray(off + 4, off + 8 + len)) !== buf.readUInt32BE(off + 8 + len)) throw new Error(`bad CRC in ${kind}`);
    if (kind === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; type = data[9]; interlace = data[12];
    } else if (kind === "IDAT") idat.push(data);
    off += 12 + len;
    if (kind === "IEND") break;
  }
  if (depth !== 8 || (type !== 2 && type !== 6) || interlace !== 0) throw new Error(`unsupported PNG: depth ${depth} type ${type} interlace ${interlace}`);
  const bpp = type === 6 ? 4 : 3, stride = width * bpp;
  const data = inflateSync(Buffer.concat(idat));
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const t = data[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const x = data[y * (stride + 1) + 1 + i];
      const a = i >= bpp ? raw[y * stride + i - bpp] : 0;
      const b = y ? raw[(y - 1) * stride + i] : 0;
      const c = y && i >= bpp ? raw[(y - 1) * stride + i - bpp] : 0;
      const pred = t === 0 ? 0 : t === 1 ? a : t === 2 ? b : t === 3 ? (a + b) >> 1 : t === 4 ? paeth(a, b, c) : NaN;
      if (Number.isNaN(pred)) throw new Error(`bad filter type ${t}`);
      raw[y * stride + i] = (x + pred) & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let p = 0, o = 0; p < rgba.length; p += 4) {
    rgba[p] = raw[o++]; rgba[p + 1] = raw[o++]; rgba[p + 2] = raw[o++];
    rgba[p + 3] = bpp === 4 ? raw[o++] : 255;
  }
  return { width, height, colorType: type, rgba };
}

// ICO with PNG-compressed entries (supported by every browser that matters).
export function encodeIco(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, png }, i) => {
    const e = 6 + 16 * i;
    head[e] = size >= 256 ? 0 : size; head[e + 1] = size >= 256 ? 0 : size;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.png)]);
}

export function decodeIco(buf) {
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error("not an ICO");
  const n = buf.readUInt16LE(4);
  return Array.from({ length: n }, (_, i) => {
    const e = 6 + 16 * i;
    const size = buf[e] || 256;
    const png = buf.subarray(buf.readUInt32LE(e + 12), buf.readUInt32LE(e + 12) + buf.readUInt32LE(e + 8));
    return { size, png };
  });
}

export const touchModuleSource = (png) => `// GENERATED by scripts/build-icons.mjs from public/apple-touch-icon.png — do not
// edit. Rerun the script after changing the icon art; scripts/test-icons.mjs
// fails if this drifts from the PNG.
//
// The 180x180 touch icon, inlined into every page's
// <link rel="apple-touch-icon" sizes="180x180">. Inline rather than a URL because
// iOS Add to Home Screen then has the icon without a second fetch, on every page
// including the /news?admin= view, which does not link the manifest.
export const APPLE_TOUCH_ICON_DATA_URI =
  "data:image/png;base64,${png.toString("base64")}";
`;

const samePixels = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

async function write() {
  const outputs = new Map();
  for (const { file, size, art } of ICONS) outputs.set(file, encodePng(rasterize(art, size), size));
  const icoParts = FAVICON_ICO.sizes.map((size) => ({ size, png: encodePng(rasterize(FAVICON_ICO.art, size), size) }));
  for (const [file, png] of outputs) await writeFile(new URL(file, PUBLIC_DIR), png);
  await writeFile(new URL(FAVICON_ICO.file, PUBLIC_DIR), encodeIco(icoParts));
  await writeFile(TOUCH_MODULE, touchModuleSource(outputs.get("apple-touch-icon.png")));
  for (const [file, png] of outputs) console.log(`wrote public/${file} (${png.length} bytes)`);
  console.log(`wrote public/${FAVICON_ICO.file}, src/assets/apple-touch-icon.js`);
}

// Returns a list of problems; empty means every committed file matches the art.
export async function checkIcons() {
  const problems = [];
  for (const { file, size, art } of ICONS) {
    let got;
    try { got = decodePng(await readFile(new URL(file, PUBLIC_DIR))); } catch (err) { problems.push(`public/${file}: ${err.message}`); continue; }
    if (got.width !== size || got.height !== size) problems.push(`public/${file}: ${got.width}x${got.height}, expected ${size}x${size}`);
    else if (!samePixels(got.rgba, rasterize(art, size))) problems.push(`public/${file}: pixels differ from the art in build-icons.mjs`);
  }
  try {
    const parts = decodeIco(await readFile(new URL(FAVICON_ICO.file, PUBLIC_DIR)));
    const sizes = parts.map((p) => p.size).join(",");
    if (sizes !== FAVICON_ICO.sizes.join(",")) problems.push(`public/favicon.ico: sizes ${sizes}, expected ${FAVICON_ICO.sizes}`);
    for (const p of parts) {
      const got = decodePng(p.png);
      if (got.width !== p.size || !samePixels(got.rgba, rasterize(FAVICON_ICO.art, p.size))) problems.push(`public/favicon.ico: ${p.size}px entry differs from the art`);
    }
  } catch (err) { problems.push(`public/favicon.ico: ${err.message}`); }
  const expected = new Set([...ICONS.map((i) => i.file), FAVICON_ICO.file]);
  for (const f of await readdir(PUBLIC_DIR)) if (!expected.has(f)) problems.push(`public/${f}: not produced by build-icons.mjs`);
  const touch = await readFile(new URL("apple-touch-icon.png", PUBLIC_DIR));
  if ((await readFile(TOUCH_MODULE, "utf8")) !== touchModuleSource(touch)) problems.push("src/assets/apple-touch-icon.js does not match public/apple-touch-icon.png");
  return problems;
}

async function main(check) {
  if (!check) return write();
  const problems = await checkIcons();
  if (problems.length) {
    console.error(`Icons out of date (${problems.length}):\n  ${problems.join("\n  ")}\nRun: node scripts/build-icons.mjs`);
    process.exit(1);
  }
  console.log(`Icons OK — ${ICONS.length} PNGs + favicon.ico match the art; touch-icon module matches its PNG.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.includes("--check"));
