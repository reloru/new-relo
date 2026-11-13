// /rain: what the page says from a seeded set of 15-minute readings, with the
// expected values written out by hand, plus the fetcher's parsing and the cron
// step against a stubbed USGS.
//
// Run: node scripts/test-rain.mjs

import { createHarness, SITE } from "./lib/harness.mjs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = new URL("../src/", import.meta.url).pathname;
const RAIN = await import(pathToFileURL(join(SRC, "features/rain.js")).href);
const R = await import(pathToFileURL(join(SRC, "record.js")).href);

const failures = [];
const ok = (cond, what) => { if (!cond) failures.push(what); };
const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const has = (body, text, what) => ok(body.includes(text), `${what}: expected ${JSON.stringify(text)}`);

// --- readings a day should hold ---
eq(["2026-03-08", "2026-11-01", "2025-03-09", "2025-11-02", "2026-06-01"].map(RAIN.expectedReadings), [92, 100, 92, 100, 96], "15-minute readings per Central day, DST days included");

// --- the fetcher: null and negative amounts dropped, `next` links followed, empty window free ---
{
  const calls = [];
  globalThis.fetch = async (u) => {
    calls.push(String(u));
    const page2 = String(u).includes("page=2");
    return new Response(JSON.stringify({
      features: page2
        ? [{ properties: { time: "2026-05-01T00:30:00+00:00", value: "0.10", approval_status: "Provisional" } }]
        : [
            { properties: { time: "2026-05-01T00:00:00+00:00", value: "0.25", approval_status: "Provisional" } },
            { properties: { time: "2026-05-01T00:15:00+00:00", value: null } },
            { properties: { time: "2026-05-01T00:20:00+00:00", value: "-1" } },
          ],
      links: page2 ? [] : [{ rel: "next", href: "https://api.waterdata.usgs.gov/next?page=2" }],
    }), { headers: { "content-type": "application/json" } });
  };
  const got = await RAIN.fetchRainReadings({}, "2026-05-01T00:00:00Z", "2026-05-02T00:00:00Z");
  eq(got, [{ at: "2026-05-01T00:00:00.000Z", inches: 0.25, approval: "Provisional" }, { at: "2026-05-01T00:30:00.000Z", inches: 0.1, approval: "Provisional" }], "parsed readings across two pages");
  ok(calls[0].includes("time_series_id=" + RAIN.RAIN_SERIES) && calls[0].includes("parameter_code=00045"), "asks for the primary rain series only");
  calls.length = 0;
  eq(await RAIN.fetchRainReadings({}, "2026-05-02T00:00:00Z", "2026-05-02T00:00:00Z"), [], "an empty window returns nothing");
  eq(calls.length, 0, "...without a request");
}

// --- the page from seeded readings ---
const h = await createHarness();
const at = (iso) => new Date(iso).toISOString();
const seed = [];
// Thursday Nov 5, 2026 (Central): 96 readings, 0.40 + 7 x 0.10 = 1.10 in, heaviest 15 min 0.40.
for (let i = 0; i < 96; i++) seed.push({ at: at(Date.parse("2026-11-05T06:15:00Z") + i * 900e3), inches: i === 10 ? 0.4 : i < 18 && i > 10 ? 0.1 : 0 });
// Friday Nov 6: only 50 readings, 0.30 in -> incomplete.
for (let i = 0; i < 50; i++) seed.push({ at: at(Date.parse("2026-11-06T06:15:00Z") + i * 900e3), inches: i < 3 ? 0.1 : 0 });
// Sunday Nov 1 (fall back, 100 readings expected): 100 readings, one 0.004 in
// trace: under 0.01 in, so not a rain day.
for (let i = 0; i < 100; i++) seed.push({ at: at(Date.parse("2026-11-01T05:15:00Z") + i * 900e3), inches: i === 20 ? 0.004 : 0 });
// October 31: one reading of 0.05.
seed.push({ at: "2026-10-31T15:00:00.000Z", inches: 0.05 });
await R.recordRain(h.env, RAIN.RAIN_STATION, seed.map((r) => ({ ...r, approval: "Provisional" })));
eq(await h.env.DB.prepare("SELECT at, day FROM rain_readings WHERE at IN ('2026-11-05T06:15:00.000Z', '2026-11-06T06:00:00.000Z', '2026-11-06T06:15:00.000Z') ORDER BY at").all().then((r) => r.results.map((x) => x.day)), ["2026-11-05", "2026-11-05", "2026-11-06"], "00:15 CST opens a day, the reading stamped midnight closes the day before, 00:15 opens the next");

{
  const r = await h.get("/rain", { headers: { accept: "text/html" } });
  const body = await r.text();
  const main = body.slice(body.indexOf('<main id="main"'), body.lastIndexOf("</main>"));
  ok(r.status === 200, `status ${r.status}`);
  has(main, "since Sat, Oct 31, 2026", "the record's first day");
  // Latest reading: Nov 6, 2026 18:30 UTC = 12:30 PM CST.
  has(main, "Nov 6, 2026, 12:30 PM CT", "the latest reading's time");
  has(main, "<dt>Last 24 hours</dt><dd>0.30 in</dd>", "the last 24 hours end at the latest reading (Nov 5's rain fell before the window)");
  has(main, "<dt>Fri, Nov 6, 2026 so far</dt><dd>0.30 in</dd>", "today so far, dated");
  has(main, "<tr><td>November 2026</td><td class=\"num\">1.40 in</td><td class=\"num\">2</td><td class=\"num\">1.10 in</td><td class=\"num\">3 / 30 <span class=\"inc\">(1 incomplete)</span></td></tr>", "the month row");
  has(main, "<tr><td>October 2026</td><td class=\"num\">0.05 in</td><td class=\"num\">1</td><td class=\"num\">0.05 in</td><td class=\"num\">1 / 31 <span class=\"inc\">(1 incomplete)</span></td></tr>", "a partial first month says so");
  has(main, "<tr><td>1</td><td><time datetime=\"2026-11-05\">Thu, Nov 5, 2026</time></td><td class=\"num\">1.10 in</td><td class=\"num\">0.40 in</td></tr>", "the wettest day, with its heaviest 15 minutes");
  has(main, "<time datetime=\"2026-11-06\">Fri, Nov 6, 2026</time> <span class=\"inc\">(incomplete)</span>", "a day missing readings is marked");
  has(main, "<td class=\"num\">100 / 100</td>", "the fall-back Sunday expects 100 readings");
  ok(main.indexOf('<section class="now" data-nosnippet>') > 0, "the live block is not quotable");
  ok(r.headers.get("last-modified") === "Fri, 06 Nov 2026 18:30:00 GMT", `Last-Modified is the latest reading (got ${r.headers.get("last-modified")})`);
}
{
  const es = await (await h.get("/es/rain", { headers: { accept: "text/html" } })).text();
  has(es, "Noviembre de 2026", "Spanish month");
  has(es, "(incompleto)", "Spanish incomplete mark");
  const md = await (await h.get("/rain?format=md")).text();
  has(md, "| November 2026 | 1.40 in | 2 | 1.10 in | 3 / 30 (1 incomplete) |", "Markdown month row");
  const xml = await (await h.get("/sitemap.xml")).text();
  has(xml, `<loc>${SITE}/rain</loc>\n    <lastmod>2026-11-06T18:30:00.000Z</lastmod>`, "sitemap date is the latest reading");
  has(await (await h.get("/weather", { headers: { accept: "text/html" } })).text(), 'href="/rain"', "/weather links /rain");
  has(await (await h.get("/es/water", { headers: { accept: "text/html" } })).text(), 'href="/es/rain"', "/es/water links /es/rain");
}
eq(await R.rainDayCount(h.env, RAIN.RAIN_STATION), "3", "rain days on record (>= 0.01 in) for IndexNow");
{
  const real = h.env.DB;
  h.env.DB = { prepare: () => { throw new Error("D1 down"); } };
  const quiet = console.error;
  console.error = () => {};
  const r = await h.get("/rain", { headers: { accept: "text/html" } });
  console.error = quiet;
  ok(r.status === 502, `a database failure answers 502, got ${r.status}`);
  h.env.DB = real;
}

if (failures.length) {
  console.error(`\nRain checks failed (${failures.length}):\n  ${failures.join("\n  ")}\n`);
  process.exit(1);
}
console.log("Rain OK — USGS 15-minute amounts parsed and filed by Central day, totals summed at request time, incomplete days marked, both languages.");
process.exit(0);
