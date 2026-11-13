// TCEQ water samples on /fishing and the gauge pages: the Water Quality Portal
// CSV parser and unit rules, the 24-hour oxygen rule, the D1 writer, the
// pages in both languages and formats, the D1-failure rules and the IndexNow
// signal. The CSV below is written by hand in the portal's format, from real
// rows (activity ids, values and comments as TCEQ published them), with two
// constructed cases marked; every expected value is written out by hand.
//
// Run: node scripts/test-water-samples.mjs

import { createHarness, SITE } from "./lib/harness.mjs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = new URL("../src/", import.meta.url).pathname;
const WQ = await import(pathToFileURL(join(SRC, "features/waterquality.js")).href);
const R = await import(pathToFileURL(join(SRC, "record.js")).href);
const IX = await import(pathToFileURL(join(SRC, "indexnow.js")).href);

const failures = [];
const ok = (cond, what) => { if (!cond) failures.push(what); };
const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const has = (body, text, what) => ok(body.includes(text), `${what}: expected ${JSON.stringify(text)}`);
const lacks = (body, text, what) => ok(!body.includes(text), `${what}: must not contain ${JSON.stringify(text)}`);

const HEAD = "OrganizationIdentifier,ActivityIdentifier,ActivityTypeCode,ActivityStartDate,ActivityStartTime/Time,ProjectIdentifier,MonitoringLocationIdentifier,CharacteristicName,ResultSampleFractionText,ResultMeasureValue,ResultMeasure/MeasureUnitCode,ResultStatusIdentifier,ResultCommentText,ResultAnalyticalMethod/MethodName";
const CSV = `${HEAD}
TCEQMAIN,TCEQMAIN-15166387,Field Msr/Obs,2026-05-13,,1949,TCEQMAIN-11212,Escherichia coli,,59,None,Final,TCEQ Unit: MPN/100ml.,
TCEQMAIN,TCEQMAIN-15166387,Field Msr/Obs,2026-05-13,,1949,TCEQMAIN-11212,Oxygen,Dissolved,10.2,mg/L,Final,,
TCEQMAIN,TCEQMAIN-15166387,Field Msr/Obs,2026-05-13,,1949,TCEQMAIN-11212,"Depth, Secchi disk depth",,.22,m,Final,,
TCEQMAIN,TCEQMAIN-15166386,Field Msr/Obs,2026-04-08,,1949,TCEQMAIN-11212,Escherichia coli,,5,None,Final,TCEQ Unit: MPN/100ml.,
TCEQMAIN,TCEQMAIN-15166386,Field Msr/Obs,2026-04-08,,1949,TCEQMAIN-11212,Oxygen,Dissolved,9.9,mg/L,Final,,
TCEQMAIN,TCEQMAIN-15166386,Field Msr/Obs,2026-04-08,,1949,TCEQMAIN-11212,"Depth, Secchi disk depth",,.42,m,Final,,
TCEQMAIN,TCEQMAIN-900001,Sample-Routine,2001-06-13,,100,TCEQMAIN-11212,Escherichia coli,,595,#/100mL,Final,,
TCEQMAIN,TCEQMAIN-900001,Sample-Routine,2001-06-13,,100,TCEQMAIN-11212,Oxygen,Dissolved,3.7,mg/L,Final,,
TCEQMAIN,TCEQMAIN-900002,Sample-Routine,2001-07-11,,100,TCEQMAIN-11212,Escherichia coli,,1588,None,Final,"TCEQ Unit: MPN/100ml., ""resampled"", see
field sheet",
TCEQMAIN,TCEQMAIN-900002,Sample-Routine,2001-07-11,,100,TCEQMAIN-11212,Oxygen,Total,1.7,mg/L,Final,,
TCEQMAIN,TCEQMAIN-13489799,Field Msr/Obs,2012-05-30,,487,TCEQMAIN-11123,Oxygen,Dissolved,4.1,mg/L,Final,,
TCEQMAIN,TCEQMAIN-13489798,Field Msr/Obs,2012-05-30,,487,TCEQMAIN-11123,Oxygen,Dissolved,4.9,mg/L,Final,,
TCEQMAIN,TCEQMAIN-13489803,Field Msr/Obs,2012-05-30,,487,TCEQMAIN-11123,Oxygen,Dissolved,3.7,mg/L,Final,,
TCEQMAIN,TCEQMAIN-13489803,Field Msr/Obs,2012-05-30,,487,TCEQMAIN-11123,Oxygen,Dissolved,5.4,mg/L,Final,,
TCEQMAIN,TCEQMAIN-13489803,Field Msr/Obs,2012-05-30,,487,TCEQMAIN-11123,Oxygen,Dissolved,6.5,mg/L,Final,,
TCEQMAIN,TCEQMAIN-13489803,Field Msr/Obs,2012-05-30,,487,TCEQMAIN-11123,Oxygen,Dissolved,96,nu,Final,,N/A Calculation
TCEQMAIN,TCEQMAIN-13489799,Sample-Routine,2012-05-30,,487,TCEQMAIN-11123,Escherichia coli,,3900,None,Final,TCEQ Unit: MPN/100ml.,
TCEQMAIN,TCEQMAIN-2700001,Field Msr/Obs,2008-12-04,,300,TCEQMAIN-11120,Oxygen,Dissolved,7.1,mg/L,Final,,
TCEQMAIN,TCEQMAIN-2700002,Field Msr/Obs,2008-12-04,,300,TCEQMAIN-11120,Oxygen,Dissolved,8.3,mg/L,Final,,
TCEQMAIN,TCEQMAIN-2700001,Field Msr/Obs,2008-12-04,,300,TCEQMAIN-11120,"Depth, Secchi disk depth",,14,in,Final,,
TCEQMAIN,TCEQMAIN-2700001,Sample-Routine,2008-12-04,,300,TCEQMAIN-11120,Escherichia coli,,6.5,hours,Final,,
TCEQMAIN,TCEQMAIN-2700001,Sample-Routine,2008-12-04,,300,TCEQMAIN-11120,Escherichia coli,,,None,Final,,
TCEQMAIN,TCEQMAIN-15166720,Field Msr/Obs,2026-05-12,,1949,TCEQMAIN-22429,Oxygen,Dissolved,6.1,mg/L,Final,,N/A Calculation
TCEQMAIN,TCEQMAIN-15166721,Field Msr/Obs,2026-05-12,,1949,TCEQMAIN-22429,Oxygen,Dissolved,6.1,mg/L,Final,,N/A Calculation
TCEQMAIN,TCEQMAIN-15166722,Field Msr/Obs,2026-05-12,,1949,TCEQMAIN-22429,Oxygen,Dissolved,6.1,mg/L,Final,,N/A Calculation
TCEQMAIN,TCEQMAIN-15166738,Field Msr/Obs,2026-05-12,,1949,TCEQMAIN-22429,Oxygen,Dissolved,6.1,mg/L,Final,,N/A Calculation
TCEQMAIN,TCEQMAIN-15166738,Field Msr/Obs,2026-05-12,,1949,TCEQMAIN-22429,Escherichia coli,,3100,None,Final,TCEQ Unit: MPN/100ml.,
TCEQMAIN,TCEQMAIN-15166738,Field Msr/Obs,2026-05-12,,1949,TCEQMAIN-22429,"Depth, Secchi disk depth",,.12,m,Final,,
`;
// Constructed: 900001/900002 (a 2001 year mixing a count with an MPN) and
// 2700001/2700002 (two same-day activities whose oxygen differs).

// --- the parser -------------------------------------------------------------
const rows = WQ.parseCsv(CSV);
eq(rows.length, 28, "every data row parsed, the one holding a newline counted once");
eq(rows[8].ResultCommentText, 'TCEQ Unit: MPN/100ml., "resampled", see\nfield sheet', "a quoted field keeps its comma, escaped quotes and newline");
eq(rows[2].CharacteristicName, "Depth, Secchi disk depth", "a quoted name with a comma stays one field");
eq(WQ.parseCsv(`${HEAD}\nTCEQMAIN,TCEQMAIN-1,Field Msr/Obs,2026-01-01\n`).length, 0, "a row cut short is dropped, not misaligned");

// --- unit rules ---------------------------------------------------------------
const pick = (r) => { const s = WQ.sampleFromRow(r); return s && [s.station, s.activity, s.day, s.measure, s.value, s.unit]; };
eq(pick(rows[0]), ["TCEQMAIN-11212", "TCEQMAIN-15166387", "2026-05-13", "ecoli", 59, "MPN/100mL"], "E. coli in unit None is labeled by TCEQ's comment");
eq(pick(rows[6]), ["TCEQMAIN-11212", "TCEQMAIN-900001", "2001-06-13", "ecoli", 595, "#/100mL"], "E. coli as a count keeps its unit");
eq(pick(rows[8])?.[5], "MPN/100mL", "the comment labels the unit even with more text after it");
eq(pick(rows[9]), null, "oxygen in a Total fraction is left out");
eq(pick(rows[15]), null, "the unitless count of readings is left out");
eq(pick(rows[20]), null, "E. coli holding time in hours is left out");
eq(pick(rows[21]), null, "an empty result is left out");
eq(pick(rows[19]), ["TCEQMAIN-11120", "TCEQMAIN-2700001", "2008-12-04", "clarity", 14, "in"], "Secchi depth in inches is kept as published");

// --- the fetcher, with the 24-hour oxygen rule --------------------------------
let calls = [];
const portal = (body, headers) => async (u) => { calls.push(String(u)); return new Response(body, { headers: { "content-type": "text/csv", ...headers } }); };
globalThis.fetch = portal(CSV, { "total-result-count": "28" });
const samples = await WQ.fetchWaterSamples();
const u = new URL(calls[0]);
eq([u.origin + u.pathname, u.searchParams.getAll("siteid"), u.searchParams.getAll("characteristicName"), u.searchParams.get("startDateLo"), u.searchParams.get("dataProfile")],
  ["https://www.waterqualitydata.us/data/Result/search", ["TCEQMAIN-11212", "TCEQMAIN-11123", "TCEQMAIN-11120", "TCEQMAIN-22429"], ["Escherichia coli", "Oxygen", "Depth, Secchi disk depth"], "01-01-1960", "resultPhysChem"], "asks the portal for the four stations' full history of the three measures");
eq(samples.length, 19, "19 results kept");
eq(samples.filter((s) => s.station === "TCEQMAIN-11123").map((s) => [s.measure, s.value]), [["ecoli", 3900]], "a day with a three-value oxygen activity loses ALL its oxygen, single readings too; its E. coli stays");
eq(samples.filter((s) => s.station === "TCEQMAIN-11120").map((s) => [s.measure, s.value]), [["oxygen", 7.1], ["oxygen", 8.3], ["clarity", 14]], "two same-day activities with one oxygen each are both kept");
calls = [];
globalThis.fetch = portal(CSV, { "total-result-count": "29" });
let threw = await WQ.fetchWaterSamples().then(() => null, (e) => e.message);
eq(threw, "Water Quality Portal: 28 of 29 results parsed", "a response short of the stated count throws");
globalThis.fetch = portal(CSV.replace("ResultCommentText", "Comment"), {});
threw = await WQ.fetchWaterSamples().then(() => null, (e) => e.message);
eq(threw, "Water Quality Portal: missing columns ResultCommentText", "a response missing a column throws");
globalThis.fetch = async () => new Response("busy", { status: 503 });
threw = await WQ.fetchWaterSamples().then(() => null, (e) => e.message);
eq(threw, "Water Quality Portal: HTTP 503", "an HTTP error throws");

// --- the D1 writer ------------------------------------------------------------
const h = await createHarness();
eq(await WQ.waterSampleCounts(h.env), undefined, "no IndexNow signal while the table is empty");
eq(await R.hasWaterSamples(h.env), false, "the cron sees an empty table");
const emptyFishing = await (await h.get("/fishing")).text();
lacks(emptyFishing, '<section class="wq">', "/fishing shows no samples section while the record is empty");
eq(await R.recordWaterSamples(h.env, samples, "2026-11-13T11:00:00.000Z"), 19, "19 rows filed");
const snapshot = () => h.env.DB.raw.prepare("SELECT * FROM water_samples ORDER BY station, activity, measure").all().map((r) => ({ ...r }));
const first = snapshot();
const writes = () => h.env.DB.raw.prepare("SELECT total_changes() AS n").get().n;
const before = writes();
await R.recordWaterSamples(h.env, samples, "2026-11-14T11:00:00.000Z");
eq(snapshot(), first, "replaying the history changes nothing, not even the filing time");
eq(writes() - before, 0, "...and writes no row: the daily replay costs reads, not writes");
await R.recordWaterSamples(h.env, [{ ...samples[0], value: 61 }], "2026-11-15T11:00:00.000Z");
eq(h.env.DB.raw.prepare("SELECT value, recorded FROM water_samples WHERE activity = 'TCEQMAIN-15166387' AND measure = 'ecoli'").get(), { value: 61, recorded: "2026-11-13T11:00:00.000Z" }, "a revised result is updated in place");
await R.recordWaterSamples(h.env, [samples[0]]);
eq(await WQ.waterSampleCounts(h.env), "TCEQMAIN-11120:1|TCEQMAIN-11123:1|TCEQMAIN-11212:4|TCEQMAIN-22429:1", "sampling days per station");

// --- the gauge pages: recent days and every year --------------------------------
const lake = await (await h.get("/water/lake-houston")).text();
has(lake, '<section class="wq">', "the samples section is not marked data-nosnippet: it is the record");
has(lake, "4 sampling days from Jun 13, 2001 to May 13, 2026.", "Lake Houston's span");
has(lake, '<tr><td><time datetime="2026-05-13">May 13, 2026</time></td><td class="num">59</td><td class="num">10.2</td><td class="num">9</td></tr>', "the latest day: E. coli, oxygen, and 0.22 m as 9 in");
has(lake, '<td class="num">5</td><td class="num">9.9</td><td class="num">17</td>', "0.42 m as 17 in");
has(lake, '<time datetime="2001-07-11">Jul 11, 2001</time></td><td class="num">1,588</td><td class="num">—</td><td class="num">—</td>', "a Total-fraction oxygen is not shown");
has(lake, '<td class="num">595 (#)</td><td class="num">3.7</td>', "a count is marked (#)");
has(lake, '<tr><td>2001</td><td class="num">2</td><td class="num">2</td><td class="num">1,588 · 595 (#)</td><td class="num">3.7</td></tr>', "a year mixing a count with an MPN shows both, apart");
has(lake, '<tr><td>2026</td><td class="num">2</td><td class="num">2</td><td class="num">59</td><td class="num">9.9</td></tr>', "the 2026 summary");
has(lake, "that suggests a meter left in the water for a day", "the limits are printed");
has(lake, 'href="https://www.waterqualitydata.us/provider/STORET/TCEQMAIN/TCEQMAIN-11212/"', "the station links to the portal");
lacks(lake, "Cedar Bayou at US 90", "Lake Houston's page shows only its own station");
lacks(lake, "Luce Bayou at the Grand Parkway", "Luce Bayou has no gauge page");
has(lake, "Water samples from the <a href=\"https://www.tceq.texas.gov/\">Texas Commission on Environmental Quality</a>", "the footer credits TCEQ");

const cedar = await (await h.get("/water/cedar-bayou-crosby")).text();
has(cedar, '<time datetime="2012-05-30">May 30, 2012</time></td><td class="num">3,900</td><td class="num">—</td><td class="num">—</td>', "a 24-hour oxygen day shows its E. coli and no oxygen");
has(cedar, '<time datetime="2008-12-04">Dec 4, 2008</time></td><td class="num">—</td><td class="num">7.1–8.3</td><td class="num">14</td>', "same-day oxygen that differs is a range");
has(cedar, "Cedar Bayou at FM 1960", "both Cedar Bayou stations");
has(cedar, "Cedar Bayou at US 90", "both Cedar Bayou stations (2)");
lacks(await (await h.get("/water/san-jacinto-sheldon")).text(), "Water samples", "a gauge with no station shows no samples");

const cedarEs = await (await h.get("/es/water/cedar-bayou-crosby")).text();
has(cedarEs, "<h2>Muestras de agua</h2>", "Spanish heading");
has(cedarEs, '<time datetime="2012-05-30">30 may 2012</time></td><td class="num">3,900</td>', "Spanish dates");
has(cedarEs, "E. coli (NMP/100 mL)", "Spanish unit");

const lakeMd = await (await h.get("/water/lake-houston?format=md")).text();
has(lakeMd, "| May 13, 2026 | 59 | 10.2 | 9 |", "Markdown: latest day");
has(lakeMd, "| 2001 | 2 | 2 | 1,588 · 595 (#) | 3.7 |", "Markdown: the year table");
has(lakeMd, "### About these samples", "Markdown: the limits");
const lakeMdEs = await (await h.get("/es/water/lake-houston?format=md")).text();
has(lakeMdEs, "| 13 may 2026 | 59 | 10.2 | 9 |", "Spanish Markdown: latest day");
has(lakeMdEs, "4 días de muestreo del 13 jun 2001 al 13 may 2026.", "Spanish Markdown: span");

// --- /fishing: every station, latest days only ---------------------------------
const fish = await (await h.get("/fishing")).text();
for (const name of ["Lake Houston at FM 1960 East", "Cedar Bayou at FM 1960", "Cedar Bayou at US 90", "Luce Bayou at the Grand Parkway (SH-99)"]) has(fish, `>${name}</a></h3>`, `/fishing shows ${name}`);
has(fish, '<time datetime="2026-05-12">May 12, 2026</time></td><td class="num">3,100</td><td class="num">6.1</td><td class="num">5</td>', "four equal same-day oxygen readings show once; 0.12 m as 5 in");
lacks(fish, "Every year on record", "/fishing carries no year table");
has(fish, '<article class="fcard', "the live USGS cards are still there");
const fishMdEs = await (await h.get("/es/fishing?format=md")).text();
has(fishMdEs, "## Muestras de agua", "Spanish Markdown /fishing");
has(fishMdEs, "| 12 may 2026 | 3,100 | 6.1 | 5 |", "Spanish Markdown /fishing row");

// --- D1 failures: /fishing drops only the section; gauge pages answer 502 ---------
{
  const real = h.env.DB;
  h.env.DB = { ...real, prepare: (sql) => { if (sql.includes("water_samples")) throw new Error("D1 down"); return real.prepare(sql); } };
  const quiet = console.error;
  console.error = () => {};
  const r = await h.get("/fishing");
  const b = await r.text();
  eq(r.status, 200, "/fishing still answers 200 when the sample record fails");
  lacks(b, '<section class="wq">', "...without the samples section");
  has(b, '<article class="fcard', "...with its live conditions");
  eq((await h.get("/water/lake-houston")).status, 502, "a gauge page answers 502 when the sample record fails");
  console.error = quiet;
  h.env.DB = real;
}

// --- IndexNow: a new sampling day submits /fishing and that station's gauge page ----
{
  const posts = [];
  globalThis.fetch = async (url, init) => { posts.push(JSON.parse(init.body)); return new Response("", { status: 200 }); };
  const at = (m) => `2026-11-13T11:${String(m).padStart(2, "0")}:00.000Z`;
  await IX.indexNowTick(h.env, null, {}, at(0)); // first run: every page once
  posts.length = 0;
  const base = "TCEQMAIN-11120:282|TCEQMAIN-11123:73|TCEQMAIN-11212:838|TCEQMAIN-22429:11";
  eq(await IX.indexNowTick(h.env, null, { waterSamples: base }, at(1)), null, "a first count is stored quietly");
  eq(await IX.indexNowTick(h.env, null, { waterSamples: base }, at(2)), null, "an unchanged count submits nothing");
  const cedarNew = await IX.indexNowTick(h.env, null, { waterSamples: base.replace("11120:282", "11120:283") }, at(3));
  eq([cedarNew?.why, posts.at(-1)?.urlList], ["waterSamples", [SITE + "/fishing", SITE + "/es/fishing", SITE + "/water/cedar-bayou-crosby", SITE + "/es/water/cedar-bayou-crosby"]], "a new day at Cedar Bayou submits /fishing and the Cedar Bayou page");
  const luceNew = await IX.indexNowTick(h.env, null, { waterSamples: base.replace("11120:282", "11120:283").replace("22429:11", "22429:12") }, at(4));
  eq([luceNew?.why, posts.at(-1)?.urlList], ["waterSamples", [SITE + "/fishing", SITE + "/es/fishing"]], "a new day at Luce Bayou submits /fishing only");
}

if (failures.length) {
  console.error(`\nWater-sample checks failed (${failures.length}):\n  ${failures.join("\n  ")}\n`);
  process.exit(1);
}
console.log("Water samples OK — parser, unit rules, the 24-hour oxygen rule, replay-safe writes, both pages in both languages and formats, the D1-failure rules and the IndexNow signal.");
process.exit(0);
