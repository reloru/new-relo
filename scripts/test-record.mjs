// The record writers (src/record.js) against real SQL with the repo's
// migrations applied, plus the cron end to end.
//
// What matters here is that the record is TRUE and STABLE: replaying an
// observation changes nothing, a day's maximum is the maximum, an event that
// was cancelled early ends when it was cancelled, and a database failure
// neither stops the cache refresh nor goes unreported.
//
// Run: node scripts/test-record.mjs

import { createHarness } from "./lib/harness.mjs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = new URL("../src/", import.meta.url).pathname;
const R = await import(pathToFileURL(join(SRC, "record.js")).href);

const failures = [];
const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (cond, what) => { if (!cond) failures.push(what); };

const h = await createHarness();
const db = h.env.DB;
const all = async (sql, ...a) => (await db.prepare(sql).bind(...a).all()).results;
const one = async (sql, ...a) => db.prepare(sql).bind(...a).first();

// --- VTEC -------------------------------------------------------------------
eq(R.parseVtec("/O.NEW.KHGX.TO.W.0042.261111T0358Z-261111T0430Z/"), { action: "NEW", wfo: "HGX", phenomena: "TO", significance: "W", etn: 42, begins: "2026-11-11T03:58:00Z", ends: "2026-11-11T04:30:00Z" }, "parse a new tornado warning");
eq(R.parseVtec("/O.CON.KHGX.HU.W.1009.000000T0000Z-000000T0000Z/")?.begins, null, "an event already in effect has no begin time");
eq(R.parseVtec("not vtec"), null, "non-VTEC text");
eq(R.scopeOf({ phenomena: "TO", significance: "W" }, {}), "point", "a tornado warning is a polygon");
eq(R.scopeOf({ phenomena: "HU", significance: "W" }, { geocode: { UGC: ["TXZ213", "TXZ214"] } }), "zone", "a hurricane warning is zone-based");
eq(R.scopeOf({ phenomena: "TO", significance: "A" }, { geocode: { UGC: ["TXC201"] } }), "county", "a tornado watch is county-based");

// --- alerts and events ------------------------------------------------------
const tor = (over = {}) => ({
  id: "urn:oid:2.49.0.1.840.0.aaa", event: "Tornado Warning", severity: "Extreme", urgency: "Immediate", certainty: "Observed",
  headline: "Tornado Warning issued November 10 at 9:58PM CST", description: "A tornado was located near Crosby.", instruction: "TAKE COVER NOW!",
  areaDesc: "Harris, TX", sent: "2026-11-11T03:58:00Z", onset: "2026-11-11T03:58:00Z", expires: "2026-11-11T04:30:00Z", ends: "2026-11-11T04:30:00Z",
  parameters: { VTEC: ["/O.NEW.KHGX.TO.W.0042.261111T0358Z-261111T0430Z/"] }, geocode: { UGC: ["TXC201"] }, ...over,
});
await R.recordAlerts(h.env, [tor()], "2026-11-11T04:00:00Z");
await R.recordAlerts(h.env, [tor()], "2026-11-11T04:15:00Z");
eq((await one("SELECT COUNT(*) AS c FROM alerts")).c, 1, "the same alert seen twice is one row");
eq(await one("SELECT first_seen, last_seen FROM alerts"), { first_seen: "2026-11-11T04:00:00Z", last_seen: "2026-11-11T04:15:00Z" }, "first and last sighting");
eq(await one("SELECT year, wfo, phenomena, significance, etn, scope, name, issued, expires, source FROM nws_events"),
  { year: 2026, wfo: "HGX", phenomena: "TO", significance: "W", etn: 42, scope: "point", name: "Tornado Warning", issued: "2026-11-11T03:58:00.000Z", expires: "2026-11-11T04:30:00.000Z", source: "observed" }, "the event row");
ok((await one("SELECT description FROM alerts")).description.includes("near Crosby"), "the official text is kept");

// A continuation with a later end extends the event; it is a new message.
await R.recordAlerts(h.env, [tor({ id: "urn:oid:2.49.0.1.840.0.bbb", sent: "2026-11-11T04:20:00Z", expires: "2026-11-11T04:45:00Z", ends: "2026-11-11T04:45:00Z", parameters: { VTEC: ["/O.CON.KHGX.TO.W.0042.000000T0000Z-261111T0445Z/"] } })], "2026-11-11T04:21:00Z");
eq((await one("SELECT COUNT(*) AS c FROM alerts")).c, 2, "a continuation is a second message");
eq((await one("SELECT COUNT(*) AS c FROM nws_events")).c, 1, "…of the same event");
eq((await one("SELECT issued, expires FROM nws_events")), { issued: "2026-11-11T03:58:00.000Z", expires: "2026-11-11T04:45:00.000Z" }, "extended end, original start");
// A cancellation ends it when it was sent, earlier than the last stated end.
await R.recordAlerts(h.env, [tor({ id: "urn:oid:2.49.0.1.840.0.ccc", sent: "2026-11-11T04:31:00Z", parameters: { VTEC: ["/O.CAN.KHGX.TO.W.0042.000000T0000Z-261111T0445Z/"] } })], "2026-11-11T04:32:00Z");
eq((await one("SELECT expires FROM nws_events")).expires, "2026-11-11T04:31:00.000Z", "a cancellation ends the event at the time it was sent");

// An event issued in December and continued in January keeps its year.
const cold = (over) => ({ id: "urn:x:1", event: "Flood Warning", sent: "2026-12-30T12:00:00Z", onset: "2026-12-30T12:00:00Z", expires: "2027-01-03T12:00:00Z", parameters: { VTEC: ["/O.NEW.KHGX.FA.W.0099.261230T1200Z-270103T1200Z/"] }, ...over });
await R.recordAlerts(h.env, [cold()], "2026-12-30T12:05:00Z");
await R.recordAlerts(h.env, [cold({ id: "urn:x:2", sent: "2027-01-01T06:00:00Z", parameters: { VTEC: ["/O.CON.KHGX.FA.W.0099.000000T0000Z-270103T1200Z/"] } })], "2027-01-01T06:05:00Z");
eq(await all("SELECT year FROM nws_events WHERE etn = 99"), [{ year: 2026 }], "a continuation across New Year stays with the year the event was issued");
// …while a NEW event with the same number in January is next year's.
await R.recordAlerts(h.env, [cold({ id: "urn:x:3", sent: "2027-01-20T06:00:00Z", onset: "2027-01-20T06:00:00Z", parameters: { VTEC: ["/O.NEW.KHGX.FA.W.0099.270120T0600Z-270121T0600Z/"] } })], "2027-01-20T06:05:00Z");
eq((await all("SELECT year FROM nws_events WHERE etn = 99 ORDER BY year")).map((r) => r.year), [2026, 2027], "a new event reusing the number next year is a separate event");

// An alert with no VTEC (a Special Weather Statement) is kept as a message only.
await R.recordAlerts(h.env, [{ id: "urn:x:sps", event: "Special Weather Statement", sent: "2026-11-11T05:00:00Z", description: "Strong storms." }], "2026-11-11T05:01:00Z");
ok(await one("SELECT 1 AS x FROM alerts WHERE id = 'urn:x:sps' AND vtec IS NULL"), "a statement without VTEC is recorded as a message");
// Malformed input is skipped, not thrown on.
await R.recordAlerts(h.env, [null, {}, { id: 5 }, { id: "x" }], "2026-11-11T05:01:00Z");

// --- gauges -----------------------------------------------------------------
const g = (stage, validTime, category = "no_flooding", flow = 2) => ({ gauges: [{ lid: "HCDT2", stage, validTime, category, flow }] });
await R.recordGauges(h.env, g(36.5, "2026-11-11T08:00:00Z"));
await R.recordGauges(h.env, g(36.5, "2026-11-11T08:00:00Z")); // same reading again
await R.recordGauges(h.env, g(51.2, "2026-11-11T12:00:00Z", "action", 3.1));
await R.recordGauges(h.env, g(54.0, "2026-11-11T15:00:00Z", "minor", 4.4));
await R.recordGauges(h.env, g(49.0, "2026-11-11T20:00:00Z", "no_flooding", 1.9));
eq(await one("SELECT max_stage, max_at, min_stage, last_stage, last_at, max_flow, max_rank, readings FROM gauge_daily WHERE lid = 'HCDT2' AND day = '2026-11-11'"),
  { max_stage: 54, max_at: "2026-11-11T15:00:00.000Z", min_stage: 36.5, last_stage: 49, last_at: "2026-11-11T20:00:00.000Z", max_flow: 4.4, max_rank: 2, readings: 4 }, "a day's summary: true maximum, its time, the highest category, distinct readings");
// A late-arriving older reading must not overwrite "last".
await R.recordGauges(h.env, g(40.0, "2026-11-11T10:00:00Z"));
eq((await one("SELECT last_stage, readings FROM gauge_daily WHERE lid = 'HCDT2' AND day = '2026-11-11'")), { last_stage: 49, readings: 5 }, "an out-of-order reading does not become the latest");
// A reading at 03:30 UTC belongs to the previous Central day.
await R.recordGauges(h.env, g(37.0, "2026-11-12T03:30:00Z"));
ok(!(await one("SELECT 1 AS x FROM gauge_daily WHERE day = '2026-11-12'")), "days are Central days, not UTC days");
await R.recordGauges(h.env, { gauges: [{ lid: "X", stage: null, validTime: "2026-11-11T08:00:00Z" }, { lid: "Y", stage: 3 }, null] });
eq((await one("SELECT COUNT(DISTINCT lid) AS c FROM gauge_daily")).c, 1, "a gauge with no stage or no reading time is not recorded");

const history = [{ lid: "HCDT2", name: "Cedar Bayou near Crosby", usgsId: "08067500",
  crests: [{ occurredTime: "2017-08-28T07:15:00Z", stage: 58.99, flow: 45125, preliminary: "R", olddatum: false }, { occurredTime: "2016-06-04T00:00:00Z", stage: 50.4, flow: 0, preliminary: "O", olddatum: false }, { occurredTime: null, stage: 40 }, { stage: 41 }],
  impacts: [{ stage: 15, statement: " Major lowland flooding begins. " }, { stage: "x", statement: "bad" }] }];
await R.recordGaugeHistory(h.env, history, "2026-11-11T10:00:00Z");
await R.recordGaugeHistory(h.env, history, "2026-11-12T10:00:00Z");
eq(await all("SELECT occurred, stage, flow, quality FROM gauge_crests ORDER BY stage DESC"), [{ occurred: "2017-08-28T07:15:00.000Z", stage: 58.99, flow: 45125, quality: "R" }, { occurred: "2016-06-04T00:00:00.000Z", stage: 50.4, flow: null, quality: "O" }], "crests: replay-safe, undated ones skipped, a published flow of 0 kept as unknown");
eq(JSON.parse((await one("SELECT impacts FROM gauge_meta WHERE lid = 'HCDT2'")).impacts), [{ stage: 15, statement: "Major lowland flooding begins." }], "impact statements, cleaned of malformed entries");
ok(await R.hasGaugeHistory(h.env), "hasGaugeHistory sees the rows");

// --- pollen, air, burn ban --------------------------------------------------
const pollen = { countDate: "2026-11-10", url: "https://www.houstonhealth.org/x", groups: { tree: { category: "Low", count: 2 }, weed: { category: "Low", count: 4 }, grass: { category: "None", count: 0 }, mold: { category: "Heavy", count: 15096 } }, species: { tree: [{ name: "Cedar", count: 2 }] } };
await R.recordPollen(h.env, pollen);
await R.recordPollen(h.env, { ...pollen, groups: { ...pollen.groups, mold: { category: "Heavy", count: 15100 } } });
eq(await all("SELECT day, tree_count, weed_cat, grass_count, mold_count FROM pollen_daily"), [{ day: "2026-11-10", tree_count: 2, weed_cat: "Low", grass_count: 0, mold_count: 15100 }], "one row per count date; a corrected count replaces it");
eq(await R.recordPollen(h.env, { groups: {}, countDate: "soon" }), 0, "a pollen entry without a real count date is not recorded");

const aqi = (usAqi, observed, measured = true, dominant = "pm25") => ({ updated: "2026-11-11T04:15:00Z", aqi: { usAqi, observed, measured, dominant, time: "2026-11-11T04:15:00Z" } });
await R.recordAqi(h.env, aqi(60, "2026-11-10 22:00 CST"));
await R.recordAqi(h.env, aqi(112, "2026-11-10 15:00 CST", true, "ozone"));
await R.recordAqi(h.env, aqi(80, "2026-11-10 23:00 CST"));
eq(await one("SELECT max_aqi, max_at, dominant, measured, readings FROM aqi_daily WHERE day = '2026-11-10'"), { max_aqi: 112, max_at: "2026-11-10 15:00 CST", dominant: "ozone", measured: 1, readings: 3 }, "the day's highest index keeps its own time and pollutant");
eq(await R.recordAqi(h.env, { aqi: null }), 0, "no AQI, nothing recorded");

await R.recordBurnBan(h.env, { status: "Yes", startDate: "2026-09-17T06:00:00.000Z" }, "2026-11-11T02:00:00Z");
await R.recordBurnBan(h.env, { status: "Yes", startDate: "2026-09-17T06:00:00.000Z" }, "2026-11-11T06:00:00Z");
eq(await all("SELECT started, ended, start_source FROM burnban_periods"), [{ started: "2026-09-17", ended: null, start_source: "tfs" }], "an active ban is one open period dated by the Forest Service");
await R.recordBurnBan(h.env, { status: "No", startDate: null }, "2026-12-16T15:00:00Z");
await R.recordBurnBan(h.env, { status: "No", startDate: null }, "2026-12-20T15:00:00Z");
eq(await all("SELECT started, ended, end_source FROM burnban_periods"), [{ started: "2026-09-17", ended: "2026-12-16", end_source: "observed" }], "lifting closes it on the day first seen lifted, once");
await R.recordBurnBan(h.env, { status: "Yes", startDate: null }, "2027-03-02T15:00:00Z");
eq((await all("SELECT started, start_source FROM burnban_periods ORDER BY started")).at(-1), { started: "2027-03-02", start_source: "observed" }, "a ban with no official start date is dated by observation and says so");
eq(await R.recordBurnBan(h.env, { status: null }), 0, "an unknown status records nothing");

// --- river flood warnings from NWS products -----------------------------------
// The product text written out the way NWS publishes it: each segment's VTEC
// line, then the hydrologic VTEC line naming the forecast point.
const FLW = [
  "FLWHGX", "",
  "TXC201-121200-",
  "/O.NEW.KHGX.FL.W.0101.261112T0900Z-261115T1200Z/",
  "/HCDT2.1.ER.261112T0900Z.261113T1800Z.261114T1200Z.NO/",
  "Cedar Bayou Near Crosby affecting Harris County.", "",
  "TXC339-121200-",
  "/O.NEW.KHGX.FL.W.0102.261112T0900Z-261116T0000Z/",
  "/XXXT2.1.ER.261112T0900Z.261113T1800Z.261114T1200Z.NO/",
  "A point this site does not track.", "",
  "/O.NEW.KHGX.FL.Y.0103.261112T0900Z-261113T0000Z/",
  "/NCET2.N.ER.261112T0900Z.261112T1800Z.261113T0000Z.NO/",
].join("\n");
const FLS_CAN = "FLSHGX\n/O.CAN.KHGX.FL.W.0101.000000T0000Z-261115T1200Z/\n/HCDT2.1.ER.261112T0900Z.261113T1800Z.261114T0300Z.NR/\n";
const products = new Map([["p1", { issuanceTime: "2026-11-12T09:00:00+00:00", productText: FLW }]]);
const listing = { FLW: [{ id: "p1", issuanceTime: "2026-11-12T09:00:00+00:00" }], FLS: [] };
let productFetches = 0;
const fetchJson = async (url) => {
  const t = url.match(/types\/(FLW|FLS)\/locations\/HGX$/);
  if (t) return { "@graph": listing[t[1]] };
  const id = url.split("/").pop();
  productFetches++;
  if (!products.has(id)) throw new Error("HTTP 503");
  return products.get(id);
};
const tracked = new Set(["HCDT2", "SHLT2", "HSJT2", "HFFT2", "GMKT2", "NCET2"]);
const gaugeRows = () => all("SELECT year, etn, scope, nwsli, issued, expires, source FROM nws_events WHERE phenomena = 'FL' ORDER BY etn");
eq(R.parseRiverProduct(FLW).map((x) => [x.vtec.phenomena + "." + x.vtec.significance, x.vtec.etn, x.nwsli]), [["FL.W", 101, "HCDT2"], ["FL.W", 102, "XXXT2"], ["FL.Y", 103, "NCET2"]], "every VTEC line is paired with the forecast point that follows it");
eq(await R.recordRiverWarnings(h.env, tracked, { fetchJson, nowIso: "2026-11-12T09:10:00Z" }), 1, "only a warning for a tracked gauge is filed");
eq(await gaugeRows(), [{ year: 2026, etn: 101, scope: "gauge", nwsli: "HCDT2", issued: "2026-11-12T09:00:00.000Z", expires: "2026-11-15T12:00:00.000Z", source: "observed" }], "filed as a gauge event, observed, with its VTEC times");
productFetches = 0;
eq(await R.recordRiverWarnings(h.env, tracked, { fetchJson, nowIso: "2026-11-12T09:25:00Z" }), 0, "a product already read is not read again");
eq(productFetches, 0, "…and is not even fetched");
products.set("p2", { issuanceTime: "2026-11-14T03:00:00+00:00", productText: FLS_CAN });
listing.FLS = [{ id: "p2", issuanceTime: "2026-11-14T03:00:00+00:00" }, { id: "p3", issuanceTime: "2026-11-14T04:00:00+00:00" }];
let threw = false;
try { await R.recordRiverWarnings(h.env, tracked, { fetchJson, nowIso: "2026-11-14T04:10:00Z" }); } catch { threw = true; }
ok(threw, "an unreadable product fails the step, so it is reported");
eq((await gaugeRows())[0].expires, "2026-11-14T03:00:00.000Z", "…while the readable one beside it is still filed: a cancellation ends the warning when it was sent");
eq(JSON.parse(h.kv.store.get(R.RIVER_PRODUCTS_KV_KEY)).seen, ["p1", "p2"], "the unreadable product is not marked read");
products.set("p3", { issuanceTime: "2026-11-14T04:00:00+00:00", productText: "nothing relevant" });
await R.recordRiverWarnings(h.env, tracked, { fetchJson, nowIso: "2026-11-14T04:25:00Z" });
eq(JSON.parse(h.kv.store.get(R.RIVER_PRODUCTS_KV_KEY)).seen, ["p1", "p2", "p3"], "the next tick retries it, and read products are remembered");
// A product NWS lists but no longer has, or one that never reads, cannot
// stall the products behind it.
{
  const gone = Object.assign(new Error("HTTP 404"), { status: 404 });
  const fj = async (url) => {
    if (/types\/FLW/.test(url)) return { "@graph": [{ id: "old404", issuanceTime: "2026-11-17T00:00:00+00:00" }, { id: "bad", issuanceTime: "2026-11-17T00:30:00+00:00" }, { id: "new1", issuanceTime: "2026-11-17T01:00:00+00:00" }] };
    if (/types\/FLS/.test(url)) return { "@graph": [] };
    if (url.endsWith("/old404")) throw gone;
    if (url.endsWith("/bad")) throw new Error("HTTP 500");
    return { issuanceTime: "2026-11-17T01:00:00+00:00", productText: "/O.NEW.KHGX.FL.W.0120.261117T0100Z-261119T0000Z/\n/NCET2.1.ER.261117T0100Z.261118T0000Z.261118T1200Z.NO/\n" };
  };
  let failedTicks = 0;
  for (const t of ["2026-11-17T01:10:00Z", "2026-11-17T01:25:00Z", "2026-11-17T01:40:00Z", "2026-11-17T01:55:00Z"]) {
    try { await R.recordRiverWarnings(h.env, tracked, { fetchJson: fj, nowIso: t }); } catch { failedTicks++; }
    if (t.endsWith("01:10:00Z")) {
      const st1 = JSON.parse(h.kv.store.get(R.RIVER_PRODUCTS_KV_KEY));
      ok(st1.seen.includes("old404") && !st1.seen.includes("bad"), "after one tick the gone product is read and the failing one is not");
    }
  }
  eq(await one("SELECT nwsli FROM nws_events WHERE etn = 120"), { nwsli: "NCET2" }, "a newer product behind a 404 and a failing one is still filed");
  eq(failedTicks, 3, "a product that keeps failing is reported for three ticks, then given up");
  const st = JSON.parse(h.kv.store.get(R.RIVER_PRODUCTS_KV_KEY));
  ok(st.seen.includes("old404") && st.seen.includes("bad") && !st.tries.bad, "the gone product is marked read at once, the failing one after three tries");
}
// A warning this site also received as an alert keeps the gauge it is for.
await R.recordAlerts(h.env, [{ id: "urn:fl", event: "Flood Warning", sent: "2026-11-12T09:01:00Z", geocode: { UGC: ["TXC201"] }, parameters: { VTEC: ["/O.CON.KHGX.FL.W.0101.000000T0000Z-261115T1200Z/"] } }], "2026-11-12T09:05:00Z");
eq((await gaugeRows())[0].scope + " " + (await gaugeRows())[0].nwsli, "gauge HCDT2", "an alert for the same event does not overwrite its gauge");
// …and one the site received as an alert FIRST gains its gauge when the product is read.
await R.recordAlerts(h.env, [{ id: "urn:fl2", event: "Flood Warning", sent: "2026-11-16T10:00:00Z", geocode: { UGC: ["TXC201"] }, parameters: { VTEC: ["/O.NEW.KHGX.FL.W.0110.261116T1000Z-261118T0000Z/"] } }], "2026-11-16T10:05:00Z");
eq(await one("SELECT scope, nwsli FROM nws_events WHERE etn = 110"), { scope: "county", nwsli: null }, "an alert alone files a county event with no gauge");
products.set("p4", { issuanceTime: "2026-11-16T10:00:00+00:00", productText: "/O.NEW.KHGX.FL.W.0110.261116T1000Z-261118T0000Z/\n/SHLT2.1.ER.261116T1000Z.261117T0000Z.261117T1200Z.NO/\n" });
listing.FLW = [{ id: "p4", issuanceTime: "2026-11-16T10:00:00+00:00" }];
await R.recordRiverWarnings(h.env, tracked, { fetchJson, nowIso: "2026-11-16T10:10:00Z" });
eq(await one("SELECT scope, nwsli FROM nws_events WHERE etn = 110"), { scope: "gauge", nwsli: "SHLT2" }, "reading the product then files it under its gauge");
eq(await R.gaugeWarningCounts(h.env), "HCDT2:1|NCET2:1|SHLT2:1", "per-gauge counts for IndexNow");

// --- the cron, end to end ---------------------------------------------------
// Real scheduled() with stubbed upstreams: the cache is refreshed AND the same
// tick lands in the record; then the database fails and the cache still does.
const cronH = await createHarness();
const { scheduled } = await import(pathToFileURL(join(SRC, "cron.js")).href);
const fx = await (await import("./lib/harness.mjs")).loadFixtures();
const nwps = (lid) => ({ name: `Gauge ${lid}`, usgsId: "0", status: { observed: { primary: 12.5, primaryUnit: "ft", secondary: 1.2, floodCategory: "no_flooding", validTime: new Date(Date.now() - 600000).toISOString() } },
  flood: { categories: { action: { stage: 50 } }, crests: { historic: [{ occurredTime: "2017-08-28T07:15:00Z", stage: 58.99, flow: 100 }] }, impacts: [{ stage: 50, statement: "Lowland flooding." }] } });
globalThis.fetch = async (u) => {
  const url = typeof u === "string" ? u : u.url;
  const m = url.match(/nwps\/v1\/gauges\/(\w+)/);
  if (m) return new Response(JSON.stringify(nwps(m[1])), { headers: { "content-type": "application/json" } });
  if (/api\.weather\.gov\/products\/types\/FL[WS]\/locations\/HGX$/.test(url)) return new Response(JSON.stringify({ "@graph": url.includes("FLW") ? [{ id: "c1", issuanceTime: "2026-11-11T09:00:00+00:00" }] : [] }));
  if (url.includes("api.waterdata.usgs.gov/ogcapi/v0/collections/continuous/items")) return new Response(JSON.stringify({ features: [
    { properties: { time: new Date(Date.now() - 900e3).toISOString(), value: "0.12", approval_status: "Provisional" } },
  ] }));
  if (url.includes("api.waterdata.usgs.gov/ogcapi/v0/collections/peaks/items")) return new Response(JSON.stringify({ features: [
    { properties: { parameter_code: "00060", value: "10600", time: "2017-08-28", water_year: 2017, qualifier: ["EVENT"] } },
    { properties: { parameter_code: "00065", value: "59.06", time: "2017-08-28", water_year: 2017 } },
    { properties: { parameter_code: "00060", value: "1200", time: "1973-06", water_year: 1973 } },
  ] }));
  if (url.startsWith("https://www.waterqualitydata.us/data/Result/search?")) return new Response(
    "MonitoringLocationIdentifier,ActivityIdentifier,ActivityStartDate,CharacteristicName,ResultMeasureValue,ResultMeasure/MeasureUnitCode,ResultSampleFractionText,ResultCommentText,ProjectIdentifier\n" +
    "TCEQMAIN-11212,TCEQMAIN-1,2026-05-13,Escherichia coli,59,None,,TCEQ Unit: MPN/100ml.,1949\n",
    { headers: { "content-type": "text/csv", "total-result-count": "1" } });
  if (url.endsWith("/products/c1")) return new Response(JSON.stringify({ issuanceTime: "2026-11-11T09:00:00+00:00", productText: "/O.NEW.KHGX.FL.W.0200.261111T0900Z-261113T0000Z/\n/SHLT2.1.ER.261111T0900Z.261112T0000Z.261112T1200Z.NO/\n" }));
  throw new Error("upstream down in test: " + url);
};
const quiet = console.error;
console.error = () => {};
cronH.kv.store.set("weather", JSON.stringify({ ...fx.weather })); // weather fetch will fail; water will succeed
await scheduled({}, cronH.env, cronH.ctx);
const cdb = cronH.env.DB;
eq((await cdb.prepare("SELECT COUNT(*) AS c FROM gauge_daily").first("c")), 6, "the cron files one daily row per gauge");
eq((await cdb.prepare("SELECT COUNT(*) AS c FROM gauge_crests").first("c")), 6, "the cron seeds crest history when the table is empty");
const status1 = JSON.parse(cronH.kv.store.get("cron_status"));
eq(status1.record?.ok, true, "cron_status reports the record write succeeded");
eq(await cdb.prepare("SELECT nwsli FROM nws_events WHERE scope = 'gauge' AND etn = 200").first("nwsli"), "SHLT2", "the cron files river flood warnings from NWS's flood products");
eq(await cdb.prepare("SELECT COUNT(*) AS c FROM gauge_peaks").first("c"), 6, "the cron seeds USGS peaks for every gauge, one row per dated peak (a month-only date is skipped)");
eq(await cdb.prepare("SELECT flow, stage, flow_qualifier FROM gauge_peaks WHERE day = '2017-08-28' LIMIT 1").first(), { flow: 10600, stage: 59.06, flow_qualifier: '["EVENT"]' }, "flow and height of one peak share its row");
const peaksBefore = (await cdb.prepare("SELECT * FROM gauge_peaks ORDER BY lid").all()).results;
await R.recordUsgsPeaks(cronH.env, peaksBefore[0].lid, peaksBefore[0].usgs_id, [{ day: "2017-08-28", waterYear: 2017, flow: 10600, stage: 59.06, flowQualifier: '["EVENT"]' }], peaksBefore[0].recorded);
eq((await cdb.prepare("SELECT * FROM gauge_peaks ORDER BY lid").all()).results, peaksBefore, "replaying a peak changes nothing");
eq(await cdb.prepare("SELECT inches FROM rain_readings").first("inches"), 0.12, "the cron files the latest rain readings");
eq(await cdb.prepare("SELECT station, day, measure, value, unit FROM water_samples").first(), { station: "TCEQMAIN-11212", day: "2026-05-13", measure: "ecoli", value: 59, unit: "MPN/100mL" }, "the cron loads TCEQ's water samples while the table is empty");
const ixSignals = JSON.parse(cronH.kv.store.get("indexnow_state") || "{}").signals || {};
eq([ixSignals.history, ixSignals.gaugeWarnings, ixSignals.rain, ixSignals.waterSamples], ["1|0", "SHLT2:1", "1", "TCEQMAIN-11212:1"], "the cron hands IndexNow the record's counts for /history, the gauge pages, /rain and the water samples");

cdb.batch = async () => { throw new Error("D1 is down"); };
const before = cronH.kv.store.get("water");
await new Promise((r) => setTimeout(r, 5));
await scheduled({}, cronH.env, cronH.ctx);
console.error = quiet;
const status2 = JSON.parse(cronH.kv.store.get("cron_status"));
eq(status2.record?.ok, false, "a failing database is reported");
ok(/D1 is down/.test(status2.record?.error || ""), "…with its error");
eq(status2.feeds.water.ok, true, "…and the water cache refresh still succeeded");
ok(cronH.kv.store.get("water") && JSON.parse(cronH.kv.store.get("water")).gauges.length === 6, "the cache was written regardless");
ok(!("history" in JSON.parse(cronH.kv.store.get("water"))), "crest history never enters the KV snapshot");
const health = await (await cronH.get("/api/health")).json();
eq(health.record?.ok, false, "/api/health surfaces the record's status");

if (failures.length) {
  console.error(`\nRecord checks failed (${failures.length}):\n  ${failures.join("\n  ")}\n`);
  process.exit(1);
}
console.log("Record OK — events, river flood warnings, gauges, pollen, air and burn-ban periods are replay-safe and true to their inputs; a database failure is reported and never costs the cache its refresh.");
process.exit(0);
