// What a crawler is told about WHEN: conditional GETs, Last-Modified, the
// sitemap's dates, and IndexNow submissions.
//
// Every one of these is a claim a search engine can check against the page,
// and stops trusting once it catches a wrong one. So each is tested as a
// claim: a 304 only for bytes that really match, a date only where there is a
// real instant behind it, a submission only when a page's state changed.
//
// Run: node scripts/test-freshness.mjs

import { createHarness, SITE } from "./lib/harness.mjs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = new URL("../src/", import.meta.url).pathname;
const { PAGES } = await import(pathToFileURL(join(SRC, "registry.js")).href);
const { esPath } = await import(pathToFileURL(join(SRC, "i18n.js")).href);
const IX = await import(pathToFileURL(join(SRC, "indexnow.js")).href);

const failures = [];
const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (cond, what) => { if (!cond) failures.push(what); };

const h = await createHarness();
const status = JSON.parse(h.kv.store.get("cron_status"));

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
      if (page.feeds) ok(lm && !Number.isNaN(Date.parse(lm)), `${where}: a data page sends Last-Modified`);
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
  ok(tags.every((t) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(t)), `${path}: a <time datetime> is not an ISO instant`);
}

// --- sitemap dates ----------------------------------------------------------
const xml = await (await h.get("/sitemap.xml")).text();
ok(!/<changefreq>|<priority>/.test(xml), "sitemap carries no changefreq/priority");
const urls = Object.fromEntries([...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)].map((m) => [m[1].slice(SITE.length) || "/", m[2] || null]));
for (const page of PAGES) {
  const want = page.feeds ? page.feeds.map((f) => status.feeds[f]?.changedAt).filter(Boolean).sort().at(-1) : null;
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

// --- IndexNow ---------------------------------------------------------------
const key = await h.get(IX.INDEXNOW_KEY_PATH);
eq([key.status, await key.text()], [200, IX.INDEXNOW_KEY], "the key file serves the key");
ok(/^[a-f0-9]{32}$/.test(IX.INDEXNOW_KEY), "the key is 32 hex characters");

const posts = [];
let answer = 200;
globalThis.fetch = async (u, init) => {
  posts.push({ url: String(u), body: JSON.parse(init.body) });
  if (answer === "throw") throw new Error("network unreachable");
  return new Response("", { status: answer });
};
const fx = (await import("./lib/harness.mjs")).loadFixtures;
const data = await fx();
const seen = () => ({ weather: structuredClone(data.weather), water: structuredClone(data.water), tropics: structuredClone(data.tropics) });
const T0 = "2026-11-11T05:00:00.000Z";

const first = await IX.indexNowTick(h.env, status, seen(), T0);
eq([first?.ok, first?.why, first?.urls], [true, "first run", PAGES.length * 2], "the first run submits every page in both languages");
eq(posts[0].url, "https://api.indexnow.org/indexnow", "submitted to the shared IndexNow endpoint");
eq([posts[0].body.host, posts[0].body.key, posts[0].body.keyLocation], ["crosbynews.com", IX.INDEXNOW_KEY, SITE + IX.INDEXNOW_KEY_PATH], "submission names the host, key and key location");

posts.length = 0;
eq(await IX.indexNowTick(h.env, status, seen(), T0), null, "nothing changed, nothing submitted");
// Numbers moved, state did not: a gauge rose within the same category.
const rose = seen();
rose.water.gauges[0].stage += 3;
rose.weather.updated = "2026-11-11T05:15:00.000Z";
eq(await IX.indexNowTick(h.env, status, rose, T0), null, "a level change within a flood category is not a state change");
eq(posts.length, 0, "…and makes no request");

// State changes: one each, and only its own page.
const flood = seen();
flood.water.gauges[0].category = "minor";
const r1 = await IX.indexNowTick(h.env, status, flood, T0);
eq(posts.at(-1)?.body.urlList, [SITE + "/water", SITE + "/es/water"], "a gauge entering flood submits /water in both languages");
eq(r1?.why, "water", "…and says why");

const lifted = structuredClone(status);
lifted.feeds.burnban.hash = "changed";
await IX.indexNowTick(h.env, lifted, flood, T0);
eq(posts.at(-1)?.body.urlList, [SITE + "/burn-ban", SITE + "/es/burn-ban"], "a burn-ban change submits /burn-ban only");

const warned = structuredClone(flood);
warned.weather.alerts = [{ id: "urn:x:new", event: "Tornado Warning" }];
await IX.indexNowTick(h.env, lifted, warned, T0);
eq(posts.at(-1)?.body.urlList, [SITE + "/alerts", SITE + "/es/alerts"], "a new alert submits /alerts");

// A feed not fetched this tick is "no information", not "changed to empty".
posts.length = 0;
eq(await IX.indexNowTick(h.env, lifted, {}, T0), null, "a tick that fetched nothing reports no change");

// A refusal is recorded and not retried on the next tick.
answer = 403;
const cleared = structuredClone(warned);
cleared.weather.alerts = [];
const refused = await IX.indexNowTick(h.env, lifted, cleared, T0);
eq([refused?.ok, refused?.status], [false, 403], "a refused submission is recorded as failed");
posts.length = 0;
eq(await IX.indexNowTick(h.env, lifted, cleared, T0), null, "a failed submission is not retried every tick");
answer = "throw";
const again = structuredClone(cleared);
again.weather.alerts = [{ id: "urn:x:another" }];
const down = await IX.indexNowTick(h.env, lifted, again, T0);
ok(down && down.ok === false && /unreachable/.test(down.error), "an unreachable endpoint is recorded, not thrown");
const health = await (await h.get("/api/health")).json();
eq([health.indexNow?.ok, health.indexNow?.why], [false, "alerts"], "/api/health reports the last submission");

if (failures.length) {
  console.error(`\nFreshness checks failed (${failures.length}):\n  ${[...new Set(failures)].slice(0, 40).join("\n  ")}\n`);
  process.exit(1);
}
console.log(`Freshness OK — ${PAGES.filter((p) => !p.custom).length * 4} representations revalidate by content, dates exist only where an instant does, and IndexNow fires on state changes alone.`);
process.exit(0);
