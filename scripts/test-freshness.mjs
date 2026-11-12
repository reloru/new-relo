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
  ok(tags.every((t) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(t)), `${path}: a <time datetime> is not an ISO instant`);
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

// --- IndexNow ---------------------------------------------------------------
const key = await h.get(IX.INDEXNOW_KEY_PATH);
eq([key.status, await key.text()], [200, IX.INDEXNOW_KEY], "the key file serves the key");
ok(/^[a-f0-9]{32}$/.test(IX.INDEXNOW_KEY), "the key is 32 hex characters");

const posts = [];
let answer = 200;
const fakeEndpoints = () => {
  globalThis.fetch = async (u, init) => {
    posts.push({ url: String(u), body: JSON.parse(init.body) });
    if (answer === "throw") throw new Error("network unreachable");
    return new Response("", { status: answer });
  };
};
fakeEndpoints();
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
eq(posts.at(-1)?.body.urlList, [SITE + "/water", SITE + "/es/water", SITE + "/water/cedar-bayou-crosby", SITE + "/es/water/cedar-bayou-crosby"], "a gauge entering flood submits /water and that gauge's page, in both languages");
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
eq(posts.slice(-2).map((p) => new URL(p.url).host), ["api.indexnow.org", "www.bing.com"], "a refusal from the shared endpoint falls back to Bing's");
posts.length = 0;
eq(await IX.indexNowTick(h.env, lifted, cleared, T0), null, "a failed submission is not retried on the next tick");
eq(await IX.indexNowTick(h.env, lifted, cleared, "2026-11-11T05:45:00.000Z"), null, "…nor before an hour has passed");
answer = 200;
const retried = await IX.indexNowTick(h.env, lifted, cleared, "2026-11-11T06:01:00.000Z");
eq([retried?.ok, posts.at(-1)?.body.urlList], [true, [SITE + "/alerts", SITE + "/es/alerts"]], "after an hour the failed URLs are submitted again");
posts.length = 0;
eq(await IX.indexNowTick(h.env, lifted, cleared, "2026-11-11T08:00:00.000Z"), null, "a retry that succeeded leaves nothing pending");
answer = "throw";
const again = structuredClone(cleared);
again.weather.alerts = [{ id: "urn:x:another" }];
const down = await IX.indexNowTick(h.env, lifted, again, T0);
ok(down && down.ok === false && /unreachable/.test(down.error), "unreachable endpoints are recorded, not thrown");
for (let i = 0; i < 8; i++) await IX.indexNowTick(h.env, lifted, again, new Date(Date.parse(T0) + (i + 2) * 3600e3).toISOString());
posts.length = 0;
eq(await IX.indexNowTick(h.env, lifted, again, "2026-11-12T12:00:00.000Z"), null, "retries stop after a bounded number of tries");
const health = await (await h.get("/api/health")).json();
eq([health.indexNow?.ok, health.indexNow?.why], [false, "alerts"], "/api/health reports the last submission");
eq(health.indexNow?.attempts?.map((a) => a.endpoint), ["api.indexnow.org", "www.bing.com"], "/api/health lists every endpoint tried, not only the last");

// Both endpoints' answers survive when both refuse.
{
  const h2 = await createHarness();
  fakeEndpoints();
  const st2 = JSON.parse(h2.kv.store.get("cron_status"));
  posts.length = 0;
  answer = 429;
  const r = await IX.indexNowTick(h2.env, st2, seen(), T0);
  eq(r?.attempts, [{ endpoint: "api.indexnow.org", status: 429 }, { endpoint: "www.bing.com", status: 429 }], "a double refusal records each endpoint's status");
  answer = 200;

  // A new crest NOAA adds is a new line in that gauge's record.
  const withHistory = (counts) => ({ ...seen(), waterHistory: Object.entries(counts).map(([lid, n]) => ({ lid, crests: Array.from({ length: n }, () => ({})) })) });
  await IX.indexNowTick(h2.env, st2, withHistory({ HCDT2: 29, SHLT2: 35 }), "2026-11-11T07:00:00.000Z");
  posts.length = 0;
  eq(await IX.indexNowTick(h2.env, st2, withHistory({ HCDT2: 29, SHLT2: 35 }), "2026-11-11T07:15:00.000Z"), null, "unchanged crest lists submit nothing");
  const crest = await IX.indexNowTick(h2.env, st2, withHistory({ HCDT2: 30, SHLT2: 35 }), "2026-11-11T07:30:00.000Z");
  eq([crest?.why, posts.at(-1)?.body.urlList], ["crests", [SITE + "/water/cedar-bayou-crosby", SITE + "/es/water/cedar-bayou-crosby"]], "a new crest submits that gauge's page only");

  // A river flood warning filed for a gauge submits that gauge's page.
  await IX.indexNowTick(h2.env, st2, { ...withHistory({ HCDT2: 30, SHLT2: 35 }), gaugeWarnings: "NCET2:26|SHLT2:12" }, "2026-11-11T07:35:00.000Z");
  const warnedGauge = await IX.indexNowTick(h2.env, st2, { ...withHistory({ HCDT2: 30, SHLT2: 35 }), gaugeWarnings: "NCET2:26|SHLT2:13" }, "2026-11-11T07:40:00.000Z");
  eq([warnedGauge?.why, posts.at(-1)?.body.urlList], ["gaugeWarnings", [SITE + "/water/san-jacinto-sheldon", SITE + "/es/water/san-jacinto-sheldon"]], "a new river flood warning submits that gauge's page");

  // A row added to the record submits /history; the same count does not.
  const base = withHistory({ HCDT2: 30, SHLT2: 35 });
  await IX.indexNowTick(h2.env, st2, { ...base, gaugeWarnings: "NCET2:26|SHLT2:13", history: "1708|0" }, "2026-11-11T07:41:00.000Z");
  posts.length = 0;
  eq(await IX.indexNowTick(h2.env, st2, { ...base, gaugeWarnings: "NCET2:26|SHLT2:13", history: "1708|0" }, "2026-11-11T07:42:00.000Z"), null, "an unchanged record submits nothing");
  const grew = await IX.indexNowTick(h2.env, st2, { ...base, gaugeWarnings: "NCET2:26|SHLT2:13", history: "1709|1" }, "2026-11-11T07:43:00.000Z");
  eq([grew?.why, posts.at(-1)?.body.urlList], ["history", [SITE + "/history", SITE + "/es/history"]], "a new event in the record submits /history");

  // A page added after the first run is submitted once, and only once.
  const stored = JSON.parse(h2.kv.store.get(IX.INDEXNOW_STATE_KV_KEY));
  eq(stored.known, PAGES.map((p) => p.path), "the submitted page list is stored");
  stored.known = stored.known.filter((p) => p !== "/water/lake-houston");
  h2.kv.store.set(IX.INDEXNOW_STATE_KV_KEY, JSON.stringify(stored));
  posts.length = 0;
  const added = await IX.indexNowTick(h2.env, st2, withHistory({ HCDT2: 30, SHLT2: 35 }), "2026-11-11T07:45:00.000Z");
  eq([added?.why, posts.at(-1)?.body.urlList], ["new pages", [SITE + "/water/lake-houston", SITE + "/es/water/lake-houston"]], "a page never submitted is submitted once");
  posts.length = 0;
  eq(await IX.indexNowTick(h2.env, st2, withHistory({ HCDT2: 30, SHLT2: 35 }), "2026-11-11T08:00:00.000Z"), null, "…and not again");
}

if (failures.length) {
  console.error(`\nFreshness checks failed (${failures.length}):\n  ${[...new Set(failures)].slice(0, 40).join("\n  ")}\n`);
  process.exit(1);
}
console.log(`Freshness OK — ${PAGES.filter((p) => !p.custom).length * 4} representations revalidate by content, dates exist only where an instant does, and IndexNow fires on state changes alone.`);
process.exit(0);
