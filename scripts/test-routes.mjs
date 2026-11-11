// Request every page and listed endpoint through the real Worker, in both
// languages and both representations, and check the registry's promises.
//
// registry.js is the one list of pages. This test is what makes that list
// binding: a page that is registered but not served, served but not
// registered, missing from a generated list, or linking a Spanish reader to an
// English page fails here rather than in production.
//
// It runs twice: once on the snapshot as captured (a quiet day) and once with
// things happening (an active warning, a gauge in flood, a named storm, a road
// incident, no burn ban), because roughly half the render branches only
// execute in one state or the other.
//
// Run: node scripts/test-routes.mjs

import { createHarness, SITE } from "./lib/harness.mjs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = new URL("../src/", import.meta.url).pathname;
const { PAGES, ENDPOINTS, PAGE_PATHS } = await import(pathToFileURL(join(SRC, "registry.js")).href);
const { esPath } = await import(pathToFileURL(join(SRC, "i18n.js")).href);
const { openApiSpec, apiCatalog } = await import(pathToFileURL(join(SRC, "api/openapi.js")).href);

// English links that belong on a Spanish page, each a decision, not a miss.
const ES_LINK_ALLOW = [
  // The Spanish MCP explainer exists to say the protocol is English-only and
  // lives at /mcp, never /es/mcp.
  { page: "/mcp", href: "/mcp" },
  // /developers names /mcp as the ENDPOINT (a POST to /es/mcp 404s), and
  // carries a separate, labelled /es/mcp link beside it for the explainer.
  { page: "/developers", href: "/mcp" },
];
// Documented in the OpenAPI spec without a line in the public lists.
const SPEC_ONLY = new Set([]);

const failures = [];
const fail = (m) => failures.push(m);
let requests = 0;

// What "things happening" looks like. Field names follow the real payloads.
function busy(v) {
  const now = Date.parse(v.weather.updated);
  const iso = (h) => new Date(now + h * 3600e3).toISOString();
  v.weather.alerts = [{
    id: "urn:oid:2.49.0.1.840.0.test", event: "Tornado Warning", severity: "Extreme", urgency: "Immediate", certainty: "Observed",
    headline: "Tornado Warning issued November 10 at 9:58PM CST until November 10 at 10:30PM CST by NWS Houston/Galveston TX",
    description: "At 957 PM CST, a severe thunderstorm capable of producing a tornado was located near Crosby, moving northeast at 25 mph.",
    instruction: "TAKE COVER NOW! Move to a basement or an interior room on the lowest floor of a sturdy building.",
    areaDesc: "Harris, TX", senderName: "NWS Houston/Galveston TX",
    sent: iso(-0.1), effective: iso(-0.1), onset: iso(-0.1), expires: iso(0.5), ends: iso(0.5),
    parameters: { VTEC: ["/O.NEW.KHGX.TO.W.0042.261111T0358Z-261111T0430Z/"] },
  }];
  v.water.gauges[0].category = "moderate";
  v.water.gauges[0].stage = 56.1;
  v.tropics.storms = [{ id: "al142026", name: "Testa", classification: "HU", intensityKt: 90, pressureMb: 970, lat: 25.1, lon: -88.4, movementDeg: 330, lastUpdate: iso(-1), advisoryUrl: "https://www.nhc.noaa.gov/" }];
  v.tropics.disturbances = [{ area: "Central Tropical Atlantic", id: "AL95", chance48: 30, category48: "low", chance7: 60, category7: "medium" }];
  v.traffic.incidents = [{ location: "US-90 Eastbound at FM-2100", type: "Accident", status: "Verified", lanes: "Right Lane" }];
  v.burnban.status = "No";
  v.burnban.startDate = null;
}

for (const [label, mutate] of [["quiet", undefined], ["busy", busy]]) {
  const h = await createHarness({ mutate });
  const text = async (path, init) => {
    requests++;
    const r = await h.get(path, init);
    return { r, body: await r.text() };
  };

  for (const page of PAGES) {
    for (const lang of ["en", "es"]) {
      const path = lang === "es" ? esPath(page.path) : page.path;
      const where = `[${label}] ${path}`;
      const canonical = SITE + path;

      // --- HTML ---
      const { r, body } = await text(path, { headers: { accept: "text/html" } });
      if (r.status !== 200) { fail(`${where}: HTML status ${r.status}`); continue; }
      if (!/^text\/html/.test(r.headers.get("content-type") || "")) fail(`${where}: content-type ${r.headers.get("content-type")}`);
      if (!/\bAccept\b/i.test(r.headers.get("vary") || "")) fail(`${where}: no Vary: Accept`);
      if (!(r.headers.get("link") || "").includes(`<${canonical}>; rel="canonical"`)) fail(`${where}: Link header lacks the canonical`);
      if (!body.includes(`<link rel="canonical" href="${canonical}">`)) fail(`${where}: <link rel="canonical"> is not ${canonical}`);
      if (!body.includes(`hreflang="en-US" href="${SITE + page.path}"`) || !body.includes(`hreflang="es-MX" href="${SITE + esPath(page.path)}"`)) fail(`${where}: hreflang pair missing or wrong`);
      if (!new RegExp(`<html lang="${lang === "es" ? "es-MX" : "en"}"`).test(body)) fail(`${where}: wrong <html lang>`);
      if (!/<title>[^<]{5,}<\/title>/.test(body)) fail(`${where}: no <title>`);
      if (!/<meta name="description" content="[^"]{20,}"/.test(body)) fail(`${where}: no meta description`);
      if ((body.match(/<h1[\s>]/g) || []).length !== 1) fail(`${where}: expected exactly one <h1>`);
      if (!body.includes('<main id="main"')) fail(`${where}: no <main id="main">`);
      // Only the content region is scanned, located by position: inline
      // scripts legitimately contain the word "undefined".
      const main = body.slice(body.indexOf('<main id="main"'), body.lastIndexOf("</main>"));
      if (/\bundefined\b|\bNaN\b|\[object Object\]/.test(main)) fail(`${where}: page text contains undefined / NaN / [object Object]`);

      // A Spanish page links to Spanish pages. The language switcher is the
      // one anchor meant to cross over, and it is marked by its hreflang.
      if (lang === "es") {
        for (const m of body.matchAll(/<a\s[^>]*href="(\/[^"#?]*)"[^>]*>/g)) {
          if (/hreflang="en-US"/.test(m[0])) continue;
          const p = m[1].replace(/\/$/, "") || "/";
          if (PAGE_PATHS.has(p) && !p.startsWith("/es") && !ES_LINK_ALLOW.some((a) => a.page === page.path && a.href === p)) {
            fail(`${where}: links the English page "${p}" instead of its /es form`);
          }
        }
      }

      // --- Markdown, by header and by query ---
      for (const [how, mp, init] of [["Accept", path, { headers: { accept: "text/markdown" } }], ["?format=md", path + "?format=md", {}]]) {
        const md = await text(mp, init);
        if (md.r.status !== 200) { fail(`${where}: Markdown (${how}) status ${md.r.status}`); continue; }
        if (!/^text\/markdown/.test(md.r.headers.get("content-type") || "")) fail(`${where}: Markdown (${how}) content-type ${md.r.headers.get("content-type")}`);
        if (!/^#\s+\S/m.test(md.body)) fail(`${where}: Markdown (${how}) has no heading`);
        if (/<html|<body/i.test(md.body)) fail(`${where}: Markdown (${how}) is HTML`);
        if (/\bundefined\b|\bNaN\b|\[object Object\]/.test(md.body)) fail(`${where}: Markdown (${how}) contains undefined / NaN / [object Object]`);
      }

      // Documents are read-only (the MCP path keeps its own method handling).
      if (!page.custom) {
        requests++;
        const post = await h.get(path, { method: "POST" });
        if (post.status !== 405) fail(`${where}: POST answered ${post.status}, want 405`);
      }
    }
  }

  // --- listed endpoints answer ---
  for (const e of ENDPOINTS) {
    const { r } = await text(e.path);
    if (r.status !== 200) fail(`[${label}] ${e.path}: status ${r.status}`);
  }

  // --- generated lists agree with the registry ---
  const sitemap = (await text("/sitemap.xml")).body;
  const locs = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].slice(SITE.length) || "/"));
  for (const p of PAGE_PATHS) if (!locs.has(p)) fail(`[${label}] /sitemap.xml omits ${p}`);
  for (const p of locs) if (!PAGE_PATHS.has(p)) fail(`[${label}] /sitemap.xml lists ${p}, which is not a registered page`);

  const llms = (await text("/llms.txt")).body;
  for (const page of PAGES) if (!llms.includes(`(${SITE}${page.path})`)) fail(`[${label}] /llms.txt omits ${page.path}`);
  for (const e of ENDPOINTS) if (e.group !== "self" && !llms.includes(SITE + e.path)) fail(`[${label}] /llms.txt omits ${e.path}`);

  for (const lang of ["en", "es"]) {
    const base = lang === "es" ? "/es/sitemap" : "/sitemap";
    const html = (await text(base, { headers: { accept: "text/html" } })).body;
    const md = (await text(base + "?format=md")).body;
    for (const page of PAGES) {
      const href = lang === "es" ? esPath(page.path) : page.path;
      if (!html.includes(`href="${href}"`)) fail(`[${label}] ${base} (HTML) omits ${href}`);
      if (!md.includes(`(${SITE}${href})`)) fail(`[${label}] ${base} (Markdown) omits ${href}`);
    }
    for (const e of ENDPOINTS) {
      if (!html.includes(`href="${e.path}"`)) fail(`[${label}] ${base} (HTML) omits ${e.path}`);
      if (!md.includes(`(${SITE}${e.path})`)) fail(`[${label}] ${base} (Markdown) omits ${e.path}`);
    }
  }

  // --- the edges of the route table ---
  for (const [path, want] of [["/nope", 404], ["/es/nope", 404], ["/es/es", 404], ["/es/api/weather", 404], ["/weather/", 301], ["/es/", 301]]) {
    requests++;
    const r = await h.get(path, { redirect: "manual" });
    if (r.status !== want) fail(`[${label}] ${path}: status ${r.status}, want ${want}`);
  }

  // With the cache empty and every upstream unreachable, a page must still
  // be a page: either its own "unavailable" state (the loaders that degrade)
  // or the 502 error page (weather, which has nothing to degrade to). Never a
  // crash and never an empty body.
  const broken = await createHarness({ mutate: (v) => { for (const k of Object.keys(v)) delete v[k]; } });
  const quietLog = console.error;
  console.error = () => {};
  for (const page of PAGES) {
    if (page.custom) continue;
    requests++;
    const r = await broken.get(page.path, { headers: { accept: "text/html" } });
    const b = await r.text();
    if (![200, 502].includes(r.status) || !/<h1[\s>]/.test(b)) fail(`[${label}] ${page.path} with the cache empty and upstreams down: status ${r.status}, want a rendered page or the 502 error page`);
  }
  console.error = quietLog;
}

// --- every JSON API route in the registry is documented in both specs ---
const specPaths = new Set(Object.keys(openApiSpec().paths || {}));
const catalog = JSON.stringify(apiCatalog());
for (const e of ENDPOINTS) {
  if (!e.path.startsWith("/api/")) continue;
  if (!specPaths.has(e.path)) fail(`${e.path} is in the registry but not in openApiSpec()`);
  if (!catalog.includes(SITE + e.path)) fail(`${e.path} is in the registry but not in apiCatalog()`);
}
for (const p of specPaths) {
  if (!ENDPOINTS.some((e) => e.path === p) && !SPEC_ONLY.has(p)) fail(`openApiSpec() documents ${p}, which registry.js ENDPOINTS does not list`);
}

if (failures.length) {
  console.error(`\nRoute checks failed (${failures.length}):\n  ${[...new Set(failures)].join("\n  ")}\n`);
  process.exit(1);
}
console.log(`Routes OK — ${PAGES.length} pages in both languages and both representations, ${ENDPOINTS.length} endpoints, quiet and busy data; ${requests} requests.`);
