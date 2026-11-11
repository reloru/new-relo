// Backfill the `nws_events` table from the Iowa Environmental Mesonet's archive
// of National Weather Service products.
//
// The Worker records what it sees from the day it starts looking. This fills in
// what happened before that, from the public archive the NWS products
// themselves are kept in. It runs from a session or a laptop, never from the
// Worker: nothing the live site serves depends on IEM being reachable.
//
//   node scripts/backfill-nws-events.mjs            # fetch, write the SQL, print a summary
//   node scripts/backfill-nws-events.mjs --apply    # …and run it against production D1
//
// Safe to re-run: every row is an upsert on the event's own key, and a row the
// Worker has since observed keeps its 'observed' source.
//
// THREE QUERIES, AND WHY EACH IS SCOPED THE WAY IT IS
//
//   point   Warnings drawn as a polygon (tornado, severe thunderstorm, flash
//           flood, areal flood) whose polygon contained Crosby's coordinates.
//           Taken from 2007-10-01, the day polygons became the official
//           warning area. IEM holds earlier polygons, but before that date a
//           warning legally covered the whole county, so "the polygon included
//           Crosby" is not a statement about who was warned.
//   zone    Everything issued for forecast zone TXZ213, the zone that contains
//           Crosby: tropical, winter, heat, fire-weather and fog products.
//           Zone boundaries have been redrawn over the years, so an older entry
//           covers whatever TXZ213 covered then.
//   county  From Harris County (TXC201), only what is genuinely county-wide —
//           tornado and severe-thunderstorm WATCHES — plus river flood warnings
//           for the forecast points this site tracks. County-coded polygon
//           warnings are deliberately NOT taken from this list: most of them
//           were for some other part of a very large county.
//
// Source and credit: Iowa Environmental Mesonet, Iowa State University,
// https://mesonet.agron.iastate.edu/ — an archive of public-domain NWS text
// products.

import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = new URL("../src/", import.meta.url).pathname;
const { LAT, LON } = await import(pathToFileURL(join(SRC, "config.js")).href);
const { WATER_GAUGES } = await import(pathToFileURL(join(SRC, "features/water.js")).href);

const IEM = "https://mesonet.agron.iastate.edu/json";
const ZONE = "TXZ213";
const COUNTY = "TXC201";
export const POLYGONS_OFFICIAL_FROM = "2007-10-01";
const today = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const OUT = process.env.BACKFILL_SQL || "/tmp/backfill-nws-events.sql";

const POINT_EVENTS = new Set(["TO.W", "SV.W", "FF.W", "FA.W", "FA.Y"]);
const COUNTY_EVENTS = new Set(["TO.A", "SV.A"]);
const GAUGES = new Set(WATER_GAUGES.map((g) => g.lid));

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "crosbynews.com backfill (contact@crosbynews.com)" } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

const iso = (s) => {
  if (!s) return null;
  const d = new Date(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z");
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const yearOf = (e) => Number((String(e.url || "").match(/year=(\d{4})/) || [])[1]) || new Date(iso(e.issue)).getUTCFullYear();

// key -> row; the same event can be listed more than once (an extension, or
// one entry per product), so keep the earliest start and the latest end.
const rows = new Map();
function add(e, scope, extra = {}) {
  const issued = iso(e.issue);
  if (!issued || !e.phenomena || !e.significance || !Number.isFinite(Number(e.eventid))) return;
  const key = [yearOf(e), e.wfo, e.phenomena, e.significance, Number(e.eventid)].join("|");
  const prev = rows.get(key);
  const expires = iso(e.expire);
  if (prev) {
    if (issued < prev.issued) prev.issued = issued;
    if (expires && (!prev.expires || expires > prev.expires)) prev.expires = expires;
    return;
  }
  rows.set(key, { year: yearOf(e), wfo: e.wfo, phenomena: e.phenomena, significance: e.significance, etn: Number(e.eventid), scope, name: e.name || `${e.ph_name} ${e.sig_name}`, issued, expires, ...extra });
}

const [point, zone, county] = await Promise.all([
  getJson(`${IEM}/sbw_by_point.py?lon=${LON}&lat=${LAT}&sdate=${POLYGONS_OFFICIAL_FROM}&edate=${today}`),
  getJson(`${IEM}/vtec_events_byugc.py?ugc=${ZONE}&sdate=1986-01-01&edate=${today}`),
  getJson(`${IEM}/vtec_events_byugc.py?ugc=${COUNTY}&sdate=1986-01-01&edate=${today}`),
]);

for (const e of point.sbws || []) {
  if (!POINT_EVENTS.has(`${e.phenomena}.${e.significance}`)) continue;
  if (iso(e.issue) < `${POLYGONS_OFFICIAL_FROM}T00:00:00.000Z`) continue;
  const tags = {};
  if (e.issue_tornadotag) tags.tornado = e.issue_tornadotag;
  if (e.issue_damagetag || e.issue_tornadodamagetag || e.issue_thunderstormdamagetag) tags.damage = e.issue_damagetag || e.issue_tornadodamagetag || e.issue_thunderstormdamagetag;
  if (Number.isFinite(e.issue_hailtag)) tags.hailInches = e.issue_hailtag;
  if (Number.isFinite(e.issue_windtag)) tags.windMph = e.issue_windtag;
  add(e, "point", { tags: Object.keys(tags).length ? JSON.stringify(tags) : null });
}
for (const e of zone.events || []) add(e, "zone");
for (const e of county.events || []) {
  const k = `${e.phenomena}.${e.significance}`;
  if (COUNTY_EVENTS.has(k)) add(e, "county");
  else if (k === "FL.W" && GAUGES.has(e.hvtec_nwsli)) add(e, "gauge", { nwsli: e.hvtec_nwsli });
}

const q = (v) => (v == null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const sql = [...rows.values()]
  .sort((a, b) => (a.issued < b.issued ? -1 : 1))
  .map((r) =>
    `INSERT INTO nws_events (year, wfo, phenomena, significance, etn, scope, name, issued, expires, source, nwsli, tags) VALUES (${[r.year, r.wfo, r.phenomena, r.significance, r.etn, r.scope, r.name, r.issued, r.expires, "iem", r.nwsli ?? null, r.tags ?? null].map(q).join(", ")}) ` +
    `ON CONFLICT (year, wfo, phenomena, significance, etn) DO UPDATE SET issued = MIN(nws_events.issued, excluded.issued), ` +
    `expires = CASE WHEN nws_events.expires IS NULL OR excluded.expires > nws_events.expires THEN excluded.expires ELSE nws_events.expires END, ` +
    `scope = excluded.scope, name = excluded.name, nwsli = COALESCE(excluded.nwsli, nws_events.nwsli), tags = COALESCE(excluded.tags, nws_events.tags);`,
  )
  .join("\n");
writeFileSync(OUT, sql + "\n");

const by = {};
for (const r of rows.values()) {
  const k = `${r.scope.padEnd(6)} ${r.name}`;
  (by[k] ||= { n: 0, first: r.issued, last: r.issued });
  by[k].n++;
  if (r.issued < by[k].first) by[k].first = r.issued;
  if (r.issued > by[k].last) by[k].last = r.issued;
}
console.log(`${rows.size} events -> ${OUT}`);
for (const [k, v] of Object.entries(by).sort((a, b) => b[1].n - a[1].n)) console.log(`  ${String(v.n).padStart(4)}  ${k.padEnd(44)} ${v.first.slice(0, 10)} … ${v.last.slice(0, 10)}`);

if (process.argv.includes("--apply")) {
  execFileSync("npx", ["wrangler", "d1", "execute", "crosby-record", "--remote", "--file", OUT], { stdio: "inherit" });
} else {
  console.log(`\nDry run. Apply with: npx wrangler d1 execute crosby-record --remote --file ${OUT}   (or re-run with --apply)`);
}
