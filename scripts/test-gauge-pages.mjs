// The river-gauge pages: what each one says, checked against values written
// out by hand from NOAA's published lists — never recomputed with the page's
// own helpers, which would only prove the code agrees with itself.
//
// Rows are seeded into the harness's real SQLite database exactly as the cron
// stores them (gauge_crests, gauge_meta, nws_events, gauge_daily), using
// production values from 2026-11-11.
//
// Run: node scripts/test-gauge-pages.mjs

import { createHarness, SITE } from "./lib/harness.mjs";

const failures = [];
const ok = (cond, what) => { if (!cond) failures.push(what); };
const has = (body, text, what) => ok(body.includes(text), `${what}: expected to find ${JSON.stringify(text)}`);
const lacks = (body, text, what) => ok(!body.includes(text), `${what}: must not contain ${JSON.stringify(text)}`);

const h = await createHarness();
const db = h.env.DB.raw;
db.exec(`
  INSERT INTO gauge_crests (lid, occurred, stage, flow, quality, old_datum) VALUES
    ('HCDT2', '2017-08-28T07:15:00.000Z', 58.99, 45125, 'R', 0),
    ('HCDT2', '2019-09-19T21:00:00.000Z', 56.93, 5654, 'P', 0),
    ('HCDT2', '2016-06-04T00:00:00.000Z', 50.4, NULL, 'O', 0),
    ('HCDT2', '2013-09-21T00:00:00.000Z', 44.55, 845, 'O', 0),
    ('HCDT2', '1994-10-18T11:00:00.000Z', 28.33, NULL, 'O', 1),
    ('HSJT2', '2017-08-29T00:00:00.000Z', 53.12, NULL, 'R', 0),
    ('SHLT2', '2017-08-29T00:00:00.000Z', 28.72, 389000, 'R', 0);
  INSERT INTO gauge_meta (lid, name, usgs_id, impacts, updated) VALUES
    ('SHLT2', 'San Jacinto River near Sheldon', '08072050', '[{"stage":10,"statement":"Minor lowland flooding begins."},{"stage":15,"statement":"Major lowland flooding begins."}]', '2026-11-11T12:30:17.843Z'),
    ('HSJT2', 'San Jacinto River at Lake Houston', '08072000', '[]', '2026-11-11T12:30:17.843Z');
  INSERT INTO nws_events (year, wfo, phenomena, significance, etn, scope, name, issued, expires, source, nwsli, tags) VALUES
    (2019, 'HGX', 'FL', 'W', 98, 'gauge', 'Flood Warning', '2019-09-19T19:00:00.000Z', '2019-09-22T13:43:00.000Z', 'iem', 'SHLT2', NULL),
    (2008, 'HGX', 'FL', 'W', 3, 'gauge', 'Flood Warning', '2008-02-18T17:04:00.000Z', '2008-02-20T00:00:00.000Z', 'iem', 'NCET2', NULL),
    (2024, 'HGX', 'SV', 'W', 200, 'point', 'Severe Thunderstorm Warning', '2024-05-16T23:00:00.000Z', '2024-05-17T00:00:00.000Z', 'iem', NULL, NULL);
  INSERT INTO gauge_crests (lid, occurred, stage, flow, quality, old_datum) VALUES
    ('NCET2', '2021-05-25T03:00:00.000Z', 60.5, NULL, 'O', 0);
  INSERT INTO gauge_peaks (lid, usgs_id, day, water_year, flow, stage, flow_qualifier, stage_qualifier, recorded) VALUES
    ('HCDT2', '08067500', '2017-08-28', 2017, 10600, 59.06, '["EVENT"]', NULL, '2026-11-12T10:00:00Z'),
    ('HCDT2', '08067500', '2019-09-19', 2019, 5890, 57.07, NULL, NULL, '2026-11-12T10:00:00Z'),
    ('HCDT2', '08067500', '2018-03-01', 2018, 999, 40.0, NULL, NULL, '2026-11-12T10:00:00Z'),
    ('SHLT2', '08072050', '2017-08-29', 2017, 270000, 28.72, NULL, NULL, '2026-11-12T10:00:00Z'),
    ('NCET2', '08070200', '2021-05-24', 2021, 7777, 60.5, NULL, NULL, '2026-11-12T10:00:00Z'),
    ('NCET2', '08070200', '2021-05-25', 2021, 8888, 60.5, NULL, NULL, '2026-11-12T10:00:00Z');
  INSERT INTO gauge_daily (lid, day, max_stage, max_at, min_stage, last_stage, last_at, max_flow, max_rank, readings) VALUES
    ('HCDT2', '2026-11-10', 36.61, '2026-11-10T15:00:00.000Z', 36.5, 36.53, '2026-11-11T03:30:00.000Z', 0.1, 0, 38),
    ('HCDT2', '2026-11-09', 54.0, '2026-11-09T12:00:00.000Z', 53.0, 53.5, '2026-11-09T23:00:00.000Z', 2.0, 2, 40);
`);

// The table row whose crest cell holds `stage` (the lede repeats some stages).
const rowOf = (html, stage) => {
  const at = html.indexOf(`<td class="num">${stage}</td>`);
  return at < 0 ? "" : html.slice(at, html.indexOf("</tr>", at));
};
const get = async (path, accept = "text/html") => {
  const r = await h.get(path, { headers: { accept } });
  const body = await r.text();
  return { r, body, main: accept === "text/html" ? body.slice(body.indexOf('<main id="main"'), body.lastIndexOf("</main>")) : body };
};

// --- Cedar Bayou: crests against today's stages (action 50.4, minor 53.4) ---
{
  const { r, main } = await get("/water/cedar-bayou-crosby");
  ok(r.status === 200, `cedar bayou: status ${r.status}`);
  has(main, "5.59 ft above minor flood stage", "Harvey (58.99) against minor 53.4");
  has(main, "3.53 ft above minor flood stage", "Imelda (56.93) against minor 53.4");
  has(main, "at action stage", "a crest exactly at action stage (50.4)");
  has(main, "5.85 ft below action stage", "a crest below every stage (44.55 vs 50.4)");
  has(main, '<time datetime="2016-06-04">Jun 4, 2016</time>', "a date-only crest keeps NOAA's calendar date");
  has(main, "Aug 28, 2017, 2:15 AM CT", "a timed crest is shown in Central time");
  has(main, "45,125", "crest flow in cfs");
  // The old-datum crest is listed, and never compared with today's stages.
  const old = main.slice(main.indexOf("Crests on an older gauge datum"));
  has(old, "28.33 ft", "old-datum crest listed");
  lacks(old.slice(0, old.indexOf("River flood warnings")), "below action stage", "old-datum crest compared with today's stages");
  const ranked = main.slice(main.indexOf("Highest recorded crests"), main.indexOf("Crests on an older gauge datum"));
  lacks(ranked, "28.33 ft", "old-datum crest ranked among current-datum crests");
  lacks(main, "25.07 ft below action stage", "old-datum crest (28.33) compared with action stage (50.4)");
  has(main, "since 1994, 1 of them measured on an older gauge datum", "intro counts the old-datum crest");
  // Status words, NOAA's flow and USGS's peak flow side by side.
  const harvey = rowOf(main, "58.99 ft");
  has(harvey, '<td class="num">45,125</td><td class="num">10,600</td><td>Record</td>', "Harvey: NOAA flow, USGS flow, Record");
  const imelda = rowOf(main, "56.93 ft");
  has(imelda, '<td class="num">5,654</td><td class="num">5,890</td><td>Preliminary</td>', "Imelda: both flows, Preliminary");
  const jun2016 = rowOf(main, "50.4 ft");
  has(jun2016, '<td class="num">—</td><td class="num">—</td><td>Official</td>', "no flows on record: two dashes, Official");
  lacks(main, "999", "a USGS peak on a date with no crest is not shown");
  lacks(main, "NOAA code", "the old code column");
  lacks(main, "one-letter code", "the old letter note");
  has(main, "USGS flow is the annual peak flow USGS publishes", "the USGS column is explained");
  const oldTable = main.slice(main.indexOf("Crests on an older gauge datum"), main.indexOf("River flood warnings"));
  lacks(oldTable, "USGS flow (cfs)", "no USGS column on a table with no USGS peaks");
  // The site's own daily record, newest first, with a flood day labelled.
  ok(main.indexOf("Nov 10, 2026") < main.indexOf("Nov 9, 2026"), "daily rows newest first");
  has(main, "Minor flooding", "a daily max_rank of 2 reads as minor flooding");
  has(main, "holds 2 days", "daily record size");
  // The live reading is not quotable; the record is.
  has(main, '<span class="gauge-badge" data-nosnippet>', "the live category badge is nosnippet");
  const live = main.slice(main.indexOf('<div data-nosnippet>'), main.indexOf("</div>", main.indexOf('<div data-nosnippet>')));
  has(live, "36.53", "the live stage sits inside the nosnippet block");
  // No river flood warning for this gauge in the seeded archive.
  has(main, "The record holds no river flood warnings for this gauge.", "empty warning list says so");
  has(main, "Since Thu, Nov 12, 2026 this site records river flood warnings itself", "says when live recording began");
  has(main, "dated Feb 18, 2008", "archive start is the earliest gauge warning (17:04 UTC = 11:04 AM CT, same day)");
  // Every link on the page that points at a page stays English here.
  has(main, 'href="/water"', "breadcrumb to /water");
}

// --- Spanish: same facts, Spanish wording, Spanish links ---
{
  const { main } = await get("/es/water/cedar-bayou-crosby");
  has(main, "5.59 ft por encima de la etapa de inundación menor", "Spanish comparison");
  has(main, 'href="/es/water"', "Spanish breadcrumb");
  lacks(main, 'href="/water"', "English page link on a Spanish page");
}

// --- Sheldon: impacts highest first, warnings listed, no flow column ---
{
  const { main } = await get("/water/san-jacinto-sheldon");
  ok(main.indexOf("Major lowland flooding begins.") < main.indexOf("Minor lowland flooding begins."), "impacts sorted highest stage first");
  has(main, "No. 98 of 2019", "the gauge's river flood warning");
  has(main, "1 in the record, newest first", "warning count");
  lacks(main, "389,000", "NOAA's flow shown for a gauge where it is not a measured flow");
  lacks(main, "NOAA flow (cfs)", "NOAA flow column on a no-flow gauge");
  has(main, '<td class="num">270,000</td><td>Record</td>', "USGS's own peak flow is shown on a no-flow gauge");
  const es = (await get("/es/water/san-jacinto-sheldon")).main;
  has(es, '<span lang="en">Major lowland flooding begins.</span>', "NOAA's statement stays in English, marked as English");
}

// --- Lake Houston: no flood stages, no impacts, no warnings ---
{
  const { main } = await get("/water/lake-houston");
  has(main, "defines no flood stages for this gauge", "says no stages are defined");
  has(main, '<time datetime="2017-08-29">Aug 29, 2017</time>', "Harvey crest stays on Aug 29 (midnight UTC is not shifted to Aug 28)");
  lacks(main, "Against today's flood stages", "comparison column with no stages");
  lacks(main, "What NOAA says happens", "impacts heading with no impacts");
  lacks(main, "older gauge datum", "old-datum heading with no old-datum crests");
}

// --- Markdown mirrors the page ---
{
  const { r, body } = await get("/water/cedar-bayou-crosby", "text/markdown");
  ok(/^text\/markdown/.test(r.headers.get("content-type") || ""), "markdown content-type");
  has(body, "| 1 | 58.99 ft | Aug 28, 2017, 2:15 AM CT | 5.59 ft above minor flood stage | 45,125 | 10,600 | Record |", "markdown crest row");
  has((await get("/es/water/cedar-bayou-crosby")).main, "<td>Récord</td>", "Spanish status");
  // A timed crest matches the USGS peak on its Central date, not its UTC date.
  const nc = (await get("/water/east-fork-new-caney")).main;
  const may = rowOf(nc, "60.5 ft");
  ok(may.includes("7,777") && !may.includes("8,888"), "03:00 UTC May 25 is May 24 in Central time: matched to the May 24 peak");
}

// --- /water links each card with a page, and only those ---
{
  const { main } = await get("/water");
  for (const p of ["/water/cedar-bayou-crosby", "/water/san-jacinto-sheldon", "/water/lake-houston", "/water/east-fork-new-caney"]) has(main, `href="${p}"`, `/water links ${p}`);
  ok((main.match(/class="gauge-more"/g) || []).length === 4, "only the four gauges with pages get a history link");
  has((await get("/es/water")).main, 'href="/es/water/cedar-bayou-crosby"', "/es/water links the Spanish gauge page");
  has((await get("/water", "text/markdown")).body, `Flood history: ${SITE}/water/cedar-bayou-crosby`, "/water markdown links the page");
}

// --- the record must be reachable: a database failure is a 502, not a page
//     with its history silently missing ---
{
  const real = h.env.DB;
  h.env.DB = { prepare: () => { throw new Error("D1 down"); } };
  const quiet = console.error;
  console.error = () => {};
  const r = await h.get("/water/cedar-bayou-crosby", { headers: { accept: "text/html" } });
  console.error = quiet;
  ok(r.status === 502, `a database failure answers 502, got ${r.status}`);
  h.env.DB = real;
}

// --- Last-Modified follows the newest crest when it is newer than the reading ---
{
  db.exec(`INSERT INTO gauge_crests VALUES ('NCET2', '2026-11-11T09:00:00.000Z', 70.1, NULL, 'P', 0)`);
  const { r } = await get("/water/east-fork-new-caney");
  ok(r.headers.get("last-modified") === "Wed, 11 Nov 2026 09:00:00 GMT", `a newer crest dates the page (got ${r.headers.get("last-modified")})`);
  const xml = await (await h.get("/sitemap.xml")).text();
  has(xml, `<loc>${SITE}/water/east-fork-new-caney</loc>\n    <lastmod>2026-11-11T09:00:00.000Z</lastmod>`, "sitemap carries the same date");
}

// --- the MCP tool reads the same record ---
{
  const r = await h.get("/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_flood_history", arguments: {} } }) });
  const res = (await r.json()).result;
  ok(!res.isError, "get_flood_history answers");
  const cedar = res.structuredContent.gauges.find((g) => g.id === "HCDT2");
  ok(cedar.highestCrests[0].againstTodaysStages === "5.59 ft above minor flood stage", "the tool states Harvey at Cedar Bayou as the page does");
  ok(JSON.stringify([cedar.highestCrests[0].status, cedar.highestCrests[0].noaaFlowCfs, cedar.highestCrests[0].usgsFlowCfs]) === JSON.stringify(["Record", 45125, 10600]), "the tool carries status and both flows");
  ok(res.structuredContent.gauges.find((g) => g.id === "SHLT2").highestCrests[0].noaaFlowCfs === null, "no NOAA flow from a no-flow gauge in the tool either");
  ok(cedar.crestCount === 5 && cedar.oldDatumCrestCount === 1, `crest counts include the old-datum crest once (got ${cedar.crestCount}/${cedar.oldDatumCrestCount})`);
  ok(res.structuredContent.gauges.find((g) => g.id === "HSJT2").highestCrests[0].date === "2017-08-29", "a date-only crest stays a date");
  ok(res.structuredContent.gauges.find((g) => g.id === "SHLT2").riverFloodWarnings === 1, "warning count per gauge");
}

if (failures.length) {
  console.error(`\nGauge page checks failed (${failures.length}):\n  ${failures.join("\n  ")}\n`);
  process.exit(1);
}
console.log("Gauge pages OK — crests against today's stages, NOAA's dates as given, old-datum crests never compared, warnings and the site's own record, both languages.");
process.exit(0);
