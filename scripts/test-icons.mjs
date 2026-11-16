// Guard the app-icon setup: the thing that decides whether Chrome on Android
// installs a real WebAPK and whether iOS Add to Home Screen shows the icon or a
// letter tile. Both failures are silent — every page still returns 200 and looks
// fine in a desktop browser — so nothing else in CI would see them.
//
//   1. The committed PNGs/ICO match the art in scripts/build-icons.mjs, and the
//      inlined touch-icon module matches its PNG.
//   2. Each file has the properties its platform needs, measured from the
//      decoded pixels: the touch icon and og:image are opaque (iOS and preview
//      renderers fill transparency with black), the maskable icon is navy
//      everywhere outside the 40% safe-zone circle, and the notification badge
//      is pure white on transparent (Android uses only its alpha).
//   3. The manifest lists PNG `any` icons at 192 and 512 plus a separate
//      maskable one, no SVG, and every size it declares is the file's real size.
//   4. Every page, in both languages, plus the /news?admin= view and the error
//      page, carries the shared head block once: viewport, theme-color, an
//      absolute og:image with its true width/height, PNG tab icons, and the
//      180px touch icon inline as a data URI whose bytes are the PNG's. No icon
//      link anywhere is an SVG. The manifest is linked on every page except the
//      admin view.
//   5. The service worker's notification icon and badge are PNGs that exist.
//   6. The Worker serves every icon path (and the -precomposed alias) through
//      env.ASSETS with the security headers, and the old SVG paths are gone.
//   7. wrangler.jsonc binds public/ as ASSETS with run_worker_first.
//
// Run: node scripts/test-icons.mjs   (pure node, no install, no network)

import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { checkIcons, decodePng, decodeIco, PUBLIC_DIR, ICONS } from "./build-icons.mjs";

const SRC = new URL("../src/", import.meta.url).pathname;
const SITE = "https://crosbynews.com";
const NAVY = [0x0b, 0x3d, 0x61];
const failures = [];
const fail = (msg) => failures.push(msg);

const { ICON_ASSET_PATHS, ICON_ALIASES, MANIFEST, OG_IMAGE } = await import(pathToFileURL(join(SRC, "assets/icons.js")).href);
const { APPLE_TOUCH_ICON_DATA_URI } = await import(pathToFileURL(join(SRC, "assets/apple-touch-icon.js")).href);
const { SW_SCRIPT } = await import(pathToFileURL(join(SRC, "assets/sw-script.js")).href);
const worker = (await import(pathToFileURL(join(SRC, "index.js")).href)).default;

const file = (p) => readFile(new URL(p.replace(/^\//, ""), PUBLIC_DIR));
const png = async (p) => decodePng(await file(p));
const opaque = (img) => img.rgba.every((v, i) => i % 4 !== 3 || v === 255);

// --- 1. committed files match the art --------------------------------------
for (const p of await checkIcons()) fail(p);

// --- 2. per-platform pixel properties --------------------------------------
const publicFiles = new Set((await readdir(PUBLIC_DIR)).map((f) => "/" + f));
for (const p of publicFiles) if (!ICON_ASSET_PATHS.has(p)) fail(`public${p} exists but the router does not serve it (ICON_ASSET_PATHS)`);
for (const p of ICON_ASSET_PATHS) if (!publicFiles.has(p)) fail(`ICON_ASSET_PATHS lists ${p} but public${p} does not exist`);
for (const { file: f, size } of ICONS) {
  const img = await png("/" + f);
  if (img.width !== size || img.height !== size) fail(`public/${f} is ${img.width}x${img.height}, declared ${size}`);
}

const touch = await png("/apple-touch-icon.png");
if (touch.width !== 180 || touch.height !== 180) fail(`apple-touch-icon.png is ${touch.width}x${touch.height}, iOS wants 180x180`);
if (!opaque(touch)) fail("apple-touch-icon.png has transparent pixels; iOS renders them black");

const og = await png(OG_IMAGE.path);
if (og.width !== OG_IMAGE.width || og.height !== OG_IMAGE.height) fail(`og:image is ${og.width}x${og.height} but declares ${OG_IMAGE.width}x${OG_IMAGE.height}`);
if (!opaque(og)) fail("og:image has transparent pixels; preview renderers fill them black");

const maskEntry = MANIFEST.icons.find((i) => i.purpose === "maskable");
if (maskEntry) {
  const m = await png(maskEntry.src);
  const c = m.width / 2, safe = 0.4 * m.width;
  let outside = 0;
  for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
    const i = (y * m.width + x) * 4;
    const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
    const navy = m.rgba[i] === NAVY[0] && m.rgba[i + 1] === NAVY[1] && m.rgba[i + 2] === NAVY[2] && m.rgba[i + 3] === 255;
    if (d > safe && !navy) outside++;
  }
  if (outside) fail(`${maskEntry.src}: ${outside} pixels outside the maskable safe zone are not solid navy`);
}

const badge = await png("/notification-badge.png");
let badgeInk = 0, badgeClear = 0, badgeColour = 0;
for (let i = 0; i < badge.rgba.length; i += 4) {
  const a = badge.rgba[i + 3];
  if (a === 0) badgeClear++;
  else { badgeInk++; if (badge.rgba[i] !== 255 || badge.rgba[i + 1] !== 255 || badge.rgba[i + 2] !== 255) badgeColour++; }
}
if (!badgeInk || !badgeClear) fail("notification-badge.png must be a silhouette: some transparent and some drawn pixels");
if (badgeColour) fail(`notification-badge.png has ${badgeColour} non-white pixels; Android uses only the alpha channel`);

const ico = decodeIco(await file("/favicon.ico"));
if (ico.map((e) => e.size).join(",") !== "16,32,48") fail(`favicon.ico holds ${ico.map((e) => e.size)} — expected 16,32,48`);
for (const e of ico) if (decodePng(e.png).width !== e.size) fail(`favicon.ico ${e.size}px entry decodes to the wrong size`);

// --- 3. manifest ------------------------------------------------------------
const purposes = (i) => (i.purpose ?? "any").split(/\s+/);
for (const i of MANIFEST.icons) {
  if (i.type !== "image/png" || !i.src.endsWith(".png")) fail(`manifest icon ${i.src} is not a PNG`);
  if (purposes(i).includes("any") && purposes(i).includes("maskable")) fail(`manifest icon ${i.src} is "any maskable"; keep the maskable icon separate`);
  if (!ICON_ASSET_PATHS.has(i.src)) { fail(`manifest icon ${i.src} is not served`); continue; }
  const img = await png(i.src);
  if (i.sizes !== `${img.width}x${img.height}`) fail(`manifest icon ${i.src} declares ${i.sizes}, file is ${img.width}x${img.height}`);
}
for (const size of ["192x192", "512x512"]) {
  if (!MANIFEST.icons.some((i) => i.sizes === size && purposes(i).includes("any"))) fail(`manifest has no purpose "any" PNG at ${size} (Chrome install criteria)`);
}
if (!maskEntry) fail(`manifest has no separate purpose "maskable" icon`);
for (const k of ["name", "short_name", "start_url"]) if (!MANIFEST[k]) fail(`manifest missing ${k}`);
if (!["standalone", "fullscreen", "minimal-ui"].includes(MANIFEST.display)) fail(`manifest display "${MANIFEST.display}" is not installable`);
if (MANIFEST.prefer_related_applications) fail("manifest prefer_related_applications would divert install to the Play Store");

// --- 4. every page's head --------------------------------------------------
// Every page in registry.js, in both languages, through the real Worker — so a
// new page is covered the moment it is registered, with no list to extend here.
const { createHarness } = await import("./lib/harness.mjs");
const { PAGES } = await import(pathToFileURL(join(SRC, "registry.js")).href);
const { esPath } = await import(pathToFileURL(join(SRC, "i18n.js")).href);
const harness = await createHarness();
const docs = [];
for (const page of PAGES) {
  for (const lang of ["en", "es"]) {
    const path = lang === "es" ? esPath(page.path) : page.path;
    const r = await harness.get(path, { headers: { accept: "text/html" } });
    if (r.status !== 200) { fail(`${path}: status ${r.status}`); continue; }
    docs.push({ label: path, html: await r.text(), manifest: true });
  }
}
for (const path of ["/news", "/es/news"]) {
  const r = await harness.get(`${path}?admin=${harness.env.ADMIN_KEY}`, { headers: { accept: "text/html" } });
  docs.push({ label: `${path} (admin)`, html: await r.text(), manifest: false });
}
const { renderError } = await import(pathToFileURL(join(SRC, "features/home.js")).href);
const origError = console.error;
console.error = () => {};
docs.push({ label: "renderError", html: renderError(new Error("probe")), manifest: true });
console.error = origError;

const touchBytes = await file("/apple-touch-icon.png");
const attr = (tag, a) => (tag.match(new RegExp(`\\s${a}="([^"]*)"`)) || [])[1];
for (const { label, html, manifest } of docs) {
  const head = (html.match(/<head>([\s\S]*?)<\/head>/) || [])[1];
  if (!head) { fail(`${label}: no <head>`); continue; }
  if (!/^\s*<meta charset="utf-8">/.test(head)) fail(`${label}: <meta charset> is not first in <head>`);
  const links = [...head.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]);
  const metas = [...head.matchAll(/<meta\b[^>]*>/g)].map((m) => m[0]);
  const count = (re) => metas.filter((m) => re.test(m)).length;
  const rels = (r) => links.filter((l) => (attr(l, "rel") || "").split(/\s+/).includes(r));

  if (count(/name="viewport"/) !== 1) fail(`${label}: ${count(/name="viewport"/)} viewport tags`);
  if (count(/name="theme-color"/) !== 1) fail(`${label}: ${count(/name="theme-color"/)} theme-color tags`);
  if (count(/property="og:site_name"/) !== 1) fail(`${label}: og:site_name not exactly once`);

  const touchLinks = [...rels("apple-touch-icon"), ...rels("apple-touch-icon-precomposed")];
  if (touchLinks.length !== 1) fail(`${label}: ${touchLinks.length} apple-touch-icon links, want 1`);
  for (const t of touchLinks) {
    if (attr(t, "sizes") !== "180x180") fail(`${label}: apple-touch-icon sizes="${attr(t, "sizes")}"`);
    const href = attr(t, "href") || "";
    const m = href.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!m) fail(`${label}: apple-touch-icon is not an inline PNG data URI`);
    else if (!Buffer.from(m[1], "base64").equals(touchBytes)) fail(`${label}: inline apple-touch-icon differs from public/apple-touch-icon.png`);
    if (href !== APPLE_TOUCH_ICON_DATA_URI) fail(`${label}: apple-touch-icon is not APPLE_TOUCH_ICON_DATA_URI`);
  }

  for (const l of links) {
    const rel = attr(l, "rel") || "", href = attr(l, "href") || "", type = attr(l, "type") || "";
    if (!/icon/.test(rel)) continue;
    if (/\.svg($|\?)/.test(href) || /svg/.test(type) || /^data:image\/svg/.test(href) || rel === "mask-icon") fail(`${label}: SVG icon link ${l}`);
    if (!href.startsWith("data:") && !ICON_ASSET_PATHS.has(href)) fail(`${label}: icon link to ${href}, which is not served`);
  }
  const tabIcons = rels("icon");
  if (!tabIcons.length) fail(`${label}: no rel="icon"`);
  for (const t of tabIcons) {
    if (attr(t, "type") !== "image/png") { fail(`${label}: rel="icon" ${attr(t, "href")} is not type image/png`); continue; }
    if (!ICON_ASSET_PATHS.has(attr(t, "href"))) continue;
    const img = await png(attr(t, "href"));
    if (attr(t, "sizes") !== `${img.width}x${img.height}`) fail(`${label}: rel="icon" ${attr(t, "href")} sizes="${attr(t, "sizes")}", file is ${img.width}x${img.height}`);
  }

  const manifests = rels("manifest");
  if (manifest && manifests.length !== 1) fail(`${label}: ${manifests.length} manifest links, want 1`);
  if (!manifest && manifests.length) fail(`${label}: links the manifest; iOS would pin start_url instead of the admin URL`);
  for (const mf of manifests) if (attr(mf, "href") !== "/manifest.json") fail(`${label}: manifest href ${attr(mf, "href")}`);

  const ogImg = metas.filter((m) => /property="og:image"/.test(m));
  if (ogImg.length !== 1) { fail(`${label}: ${ogImg.length} og:image tags`); continue; }
  const ogUrl = attr(ogImg[0], "content") || "";
  if (!ogUrl.startsWith(SITE + "/")) fail(`${label}: og:image "${ogUrl}" is not an absolute ${SITE} URL`);
  const ogPath = ogUrl.slice(SITE.length);
  if (!ICON_ASSET_PATHS.has(ogPath) || !ogPath.endsWith(".png")) { fail(`${label}: og:image ${ogPath} is not a served PNG`); continue; }
  const ogFile = await png(ogPath);
  const ogMeta = (p) => attr(metas.find((m) => m.includes(`property="og:image:${p}"`)) || "", "content");
  if (ogMeta("width") !== String(ogFile.width) || ogMeta("height") !== String(ogFile.height)) fail(`${label}: og:image:width/height ${ogMeta("width")}x${ogMeta("height")}, file is ${ogFile.width}x${ogFile.height}`);
  if (ogMeta("type") !== "image/png") fail(`${label}: og:image:type is ${ogMeta("type")}`);
  if (!ogMeta("alt")) fail(`${label}: og:image:alt missing`);
}

// --- 5. service worker ------------------------------------------------------
if (/\.svg/.test(SW_SCRIPT)) fail("SW_SCRIPT still references an .svg");
const swIcons = [...SW_SCRIPT.matchAll(/\b(icon|badge):\s*"([^"]+)"/g)];
if (!swIcons.length) fail("SW_SCRIPT: no notification icon/badge found");
for (const [, kind, p] of swIcons) {
  if (!p.endsWith(".png") || !ICON_ASSET_PATHS.has(p)) fail(`SW notification ${kind} ${p} is not a served PNG`);
  if (kind === "badge" && p !== "/notification-badge.png") fail(`SW badge is ${p}; it must be the monochrome silhouette`);
}
const precache = JSON.parse(SW_SCRIPT.match(/var PRECACHE = (\[[^\]]*\])/)[1]);
for (const p of precache) if (/\.[a-z]+$/.test(p) && p !== "/manifest.json" && !ICON_ASSET_PATHS.has(p)) fail(`SW PRECACHE ${p} is not served (addAll would reject)`);

// --- 6. the Worker serves the icons ----------------------------------------
const assets = {
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405 });
    if (!publicFiles.has(pathname)) return new Response("asset miss", { status: 404 });
    const type = pathname.endsWith(".ico") ? "image/x-icon" : "image/png";
    return new Response(req.method === "HEAD" ? null : await file(pathname), { headers: { "content-type": type } });
  },
};
const env = { ASSETS: assets };
const ctx = { waitUntil() {} };
for (const p of [...ICON_ASSET_PATHS, ...Object.keys(ICON_ALIASES)]) {
  const r = await worker.fetch(new Request(SITE + p), env, ctx);
  const expect = await file(ICON_ALIASES[p] ?? p);
  const body = Buffer.from(await r.arrayBuffer());
  if (r.status !== 200) { fail(`GET ${p} → ${r.status}`); continue; }
  if (!body.equals(expect)) fail(`GET ${p} body differs from public${ICON_ALIASES[p] ?? p}`);
  if (!/^image\/(png|x-icon|vnd\.microsoft\.icon)/.test(r.headers.get("content-type") || "")) fail(`GET ${p} content-type ${r.headers.get("content-type")}`);
  if (r.headers.get("x-content-type-options") !== "nosniff") fail(`GET ${p} missing the security headers`);
  if (!/max-age=\d+/.test(r.headers.get("cache-control") || "")) fail(`GET ${p} has no cache lifetime`);
}
for (const p of ["/favicon.svg", "/icon.svg"]) {
  const r = await worker.fetch(new Request(SITE + p), env, ctx);
  if (r.status !== 404) fail(`GET ${p} → ${r.status}; SVG icons should no longer be served`);
}
const manifestResp = await worker.fetch(new Request(SITE + "/manifest.json"), env, ctx);
if (JSON.stringify(await manifestResp.json()) !== JSON.stringify(MANIFEST)) fail("/manifest.json does not serve MANIFEST");

// --- 7. wrangler.jsonc ------------------------------------------------------
const wrangler = JSON.parse((await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8")).replace(/^\s*\/\/.*$/gm, ""));
const a = wrangler.assets || {};
if (a.directory !== "./public" || a.binding !== "ASSETS" || a.run_worker_first !== true) {
  fail(`wrangler.jsonc assets must be { directory: "./public", binding: "ASSETS", run_worker_first: true }, got ${JSON.stringify(a)}`);
}

if (failures.length) {
  console.error(`\nIcon setup broken (${failures.length}):\n  ${failures.join("\n  ")}\n`);
  process.exit(1);
}
console.log(`Icons OK — ${ICON_ASSET_PATHS.size} files match their art and platform rules; ${docs.length} page heads (both languages, admin and error views) carry the shared icon block; SW, manifest and routes agree.`);
