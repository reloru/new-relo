// What a crawler is told about WHEN: conditional GETs, Last-Modified, the
// and the sitemap's dates.
//
// Every one of these is a claim a search engine can check against the page,
// and stops trusting once it catches a wrong one. So each is tested as a
// claim: a 304 only for bytes that really match, a date only where there is a
// real instant behind it.
//
// Run: node scripts/test-freshness.mjs

import { createHarness, SITE } from "./lib/harness.mjs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = new URL("../src/", import.meta.url).pathname;
const { PAGES } = await import(pathToFileURL(join(SRC, "registry.js")).href);
const { esPath } = await import(pathToFileURL(join(SRC, "i18n.js")).href);

const failures = [];
const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (cond, what) => { if (!cond) failures.push(what); };

const h = await createHarness();
const status = JSON.parse(h.kv.store.get("cron_status"));
const fixtureGaugesLM = JSON.parse(h.kv.store.get("water")).gauges;

// --- conditional GET on every page, both representations --------------------
for (const page of PAGES) {
  // The /mcp explainers share a path with the protocol endpoint and are served
  // by their own branch of the router, which does not revalidate.
  if (page.custom) continue;
  for (const path of [page.path, esPath(page.path)]) {
    for (const accept of ["text/html", "text/markdown"]) {
      const where = `${path} (${accept})`;
      const first = await h.get(path, { headers: { accept } });
      const body = await first.text();
      const etag = first.headers.get("etag");
      if (first.status !== 200 || !etag) { failures.push(`${where}: status ${first.status}, etag ${etag}`); continue; }
      const again = await h.get(path, { headers: { accept, "if-none-match": etag } });
      eq(again.status, 304, `${where}: revalidation with the current ETag`);
      eq((await again.text()).length, 0, `${where}: a 304 carries no body`);
      eq(again.headers.get("etag"), etag, `${where}: the 304 repeats the ETag`);
      ok(/Accept/i.test(again.headers.get("vary") || ""), `${where}: the 304 keeps Vary: Accept`);
      const stale = await h.get(path, { headers: { accept, "if-none-match": 'W/"something-else"' } });
      eq(stale.status, 200, `${where}: a different ETag gets the page`);

      // Last-Modified exactly where the page shows cached data.
      const lm = first.headers.get("last-modified");
      if (page.gauge) eq(lm, new Date(fixtureGaugesLM.find((g) => g.lid === page.gauge).validTime).toUTCString(), `${where}: a gauge page is dated by its gauge's latest reading`);
      else if (page.feeds) ok(lm && !Number.isNaN(Date.parse(lm)), `${where}: a data page sends Last-Modified`);
      else if (page.path !== "/radar") ok(!lm, `${where}: a static page sends no Last-Modified (got ${lm})`);

      // A relative time is true only at the instant it is rendered.
      const content = accept === "text/html" ? body.slice(body.indexOf('<main id="main"'), body.lastIndexOf("</main>")) : body;
      ok(!/\b\d+\s*(min|hr|hours?|minutes?|days?)\s+ago\b|\bhace\s+\d+\s*(min|h|día)/i.test(content), `${where}: contains a relative time ("N min ago")`);
    }
  }
}
// The two representations of one URL must not share a validator.
{
  const a = (await h.get("/water", { headers: { accept: "text/html" } })).headers.get("etag");
  const b = (await h.get("/water", { headers: { accept: "text/markdown" } })).headers.get("etag");
  ok(a && b && a !== b, "HTML and Markdown of the same page have different ETags");
  const cross = await h.get("/water", { headers: { accept: "text/markdown", "if-none-match": a } });
  eq(cross.status, 200, "the HTML ETag does not validate the Markdown representation");
}
// The ETag follows the content: change the data, and the old one stops matching.
{
  const before = (await h.get("/burn-ban", { headers: { accept: "text/html" } })).headers.get("etag");
  const ban = JSON.parse(h.kv.store.get("burnban"));
  h.kv.store.set("burnban", JSON.stringify({ ...ban, status: "No", startDate: null }));
  const after = await h.get("/burn-ban", { headers: { accept: "text/html", "if-none-match": before } });
  eq(after.status, 200, "changed data invalidates the old ETag");
  h.kv.store.set("burnban", JSON.stringify(ban));
}
// The admin view is never revalidated.
{
  const r = await h.get(`/news?admin=${h.env.ADMIN_KEY}`, { headers: { accept: "text/html" } });
  ok(!r.headers.get("etag") && /no-store/.test(r.headers.get("cache-control")), "the admin view carries no validator and is no-store");
}
// Every stamp a person can read is also machine-readable.
for (const path of ["/", "/weather", "/hourly", "/alerts", "/water", "/fishing", "/tropics", "/traffic", "/calendar", "/burn-ban", "/news"]) {
  const body = await (await h.get(path, { headers: { accept: "text/html" } })).text();
  const tags = [...body.matchAll(/<time datetime="([^"]+)">/g)].map((m) => m[1]);
  ok(tags.length > 0, `${path}: no <time datetime> stamp`);
  // An instant for a stamp, or a bare calendar date for something that is a
  // date (a school holiday, a crest NOAA dated without a time): writing a
  // date as an instant would invent a time and a zone.
  ok(tags.every((t) => /^\d{4}-\d\d-\d\d(T\d\d:\d\d:\d\d\.\d{3}Z)?$/.test(t)), `${path}: a <time datetime> is neither an ISO instant nor a calendar date`);
}

// --- what a result snippet may quote ----------------------------------------
// data-nosnippet goes on what will be wrong by the time a crawler's copy is
// shown (a temperature, a gauge reading, an active alert) and comes off what
// will still be right (the guides, a dated status). Remove every nosnippet
// element, then look at what is left.
function snippetable(html) {
  let main = html.slice(html.indexOf('<main id="main"'), html.lastIndexOf("</main>"));
  for (;;) {
    const m = /<(div|section|span)\b[^>]*\sdata-nosnippet[^>]*>/.exec(main);
    if (!m) return main.replace(/<[^>]+>/g, " ");
    const open = new RegExp(`<${m[1]}\\b`, "g"), close = new RegExp(`</${m[1]}>`, "g");
    let depth = 1, at = m.index + m[0].length;
    while (depth > 0) {
      open.lastIndex = close.lastIndex = at;
      const o = open.exec(main), c = close.exec(main);
      if (!c) throw new Error("unbalanced nosnippet element");
      if (o && o.index < c.index) { depth++; at = o.index + 1; } else { depth--; at = c.index + c[0].length; }
    }
    main = main.slice(0, m.index) + main.slice(at);
  }
}
const quotable = async (path) => snippetable(await (await h.get(path, { headers: { accept: "text/html" } })).text());
for (const path of ["/", "/weather", "/hourly", "/es", "/es/weather"]) {
  ok(!/\d+\s*°/.test(await quotable(path)), `${path}: a temperature is quotable in a snippet`);
}
{
  const water = await quotable("/water");
  const g0 = JSON.parse(h.kv.store.get("water")).gauges[0];
  ok(!water.includes(`${g0.stage}`), "/water: a live gauge reading is quotable");
  ok(water.includes(`${g0.thresholds.action} ft`), "/water: flood stages stay quotable");
  const air = await quotable("/air");
  ok(!/Main pollutant/.test(air), "/air: the live AQI hero is quotable");
  ok(/How to read the AQI/.test(air), "/air: the guide is not quotable");
  ok(/Severe Weather Guide/.test(await quotable("/alerts")), "/alerts: the guide is not quotable");
  ok(!/No active weather alerts for Crosby/.test(await quotable("/alerts")), "/alerts: the live alert status is quotable");
  ok(/Hurricane season and Crosby/.test(await quotable("/tropics")), "/tropics: the guide is not quotable");
  ok(!/Nothing active/.test(await quotable("/tropics")), "/tropics: the live basin status is quotable");
  ok(/How to read the categories/.test(await quotable("/pollen")), "/pollen: the guide is not quotable");
  ok(/When water covers the road/.test(await quotable("/traffic")), "/traffic: the guide is not quotable");
  const ban = await quotable("/burn-ban");
  ok(/Burn ban in effect/.test(ban) && /In effect since/.test(ban), "/burn-ban: the dated status is not quotable");
  ok(!/Right now in Crosby/.test(ban), "/burn-ban: the live wind and humidity strip is quotable");
}

// --- sitemap dates ----------------------------------------------------------
const xml = await (await h.get("/sitemap.xml")).text();
ok(!/<changefreq>|<priority>/.test(xml), "sitemap carries no changefreq/priority");
const urls = Object.fromEntries([...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)].map((m) => [m[1].slice(SITE.length) || "/", m[2] || null]));
const fixtureGauges = JSON.parse(h.kv.store.get("water")).gauges;
for (const page of PAGES) {
  // A gauge page is dated by its own gauge's latest reading (no crests are
  // seeded here), not by the water feed as a whole.
  const want = page.gauge
    ? fixtureGauges.find((g) => g.lid === page.gauge).validTime
    : page.feeds ? page.feeds.map((f) => status.feeds[f]?.changedAt).filter(Boolean).sort().at(-1) : null;
  for (const path of [page.path, esPath(page.path)]) {
    eq(urls[path] ?? null, want ? new Date(want).toISOString() : null, `sitemap lastmod for ${path}`);
  }
}
// A feed that was re-fetched without changing must not move the date.
{
  const bumped = structuredClone(status);
  bumped.feeds.burnban.at = "2099-01-01T00:00:00.000Z"; // attempted later, content unchanged
  h.kv.store.set("cron_status", JSON.stringify(bumped));
  const x2 = await (await h.get("/sitemap.xml")).text();
  ok(!x2.includes("2099"), "a re-fetch without a content change does not move lastmod");
  h.kv.store.set("cron_status", JSON.stringify(status));
}

// IndexNow was removed (the owner links the site to search engines another
// way); its key file is an unknown path again.
eq((await h.get("/72a0e4671cc205122a446b7c49b06bff.txt")).status, 404, "the old IndexNow key file is gone");

if (failures.length) {
  console.error(`\nFreshness checks failed (${failures.length}):\n  ${[...new Set(failures)].slice(0, 40).join("\n  ")}\n`);
  process.exit(1);
}
console.log(`Freshness OK — ${PAGES.filter((p) => !p.custom).length * 4} representations revalidate by content, and dates exist only where an instant does.`);
process.exit(0);
