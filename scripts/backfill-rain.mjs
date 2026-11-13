// Backfill D1 `rain_readings` with every 15-minute rain amount the USGS
// station at the Lake Houston dam (08072000) has published, from the start of
// its record (2024-10-30) to now. The cron keeps it current from there; this
// fills what came before the cron started reading it.
//
//   node scripts/backfill-rain.mjs            # fetch and write the SQL, print a summary
//   node scripts/backfill-rain.mjs --apply    # ...and run it against production D1
//
// Safe to re-run: every row is an upsert on (station, at). Runs from a session,
// never from the Worker. Uses the same fetcher as the cron, so the rows are
// identical to what the cron writes.

import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = new URL("../src/", import.meta.url).pathname;
const { fetchRainReadings, RAIN_STATION } = await import(pathToFileURL(join(SRC, "features/rain.js")).href);
const { rainDay } = await import(pathToFileURL(join(SRC, "record.js")).href);

const OUT = process.env.BACKFILL_SQL || "/tmp/backfill-rain.sql";
const START = "2024-10-30T00:00:00Z";
const env = { USGS_API_KEY: process.env.USGS_API_KEY || "" };

// One request per calendar quarter keeps each well under the API's page size.
const readings = [];
const UNTIL = Date.now(); // fixed: a moving "now" would request empty windows forever
for (let t = Date.parse(START); t < UNTIL; ) {
  const d = new Date(t);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1);
  const end = Math.min(next, UNTIL);
  const part = await fetchRainReadings(env, new Date(t).toISOString(), new Date(end).toISOString());
  readings.push(...part);
  console.log(`${new Date(t).toISOString().slice(0, 10)} → ${new Date(end).toISOString().slice(0, 10)}: ${part.length} readings`);
  t = end;
}

const q = (v) => (v == null ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const seen = new Set();
const sql = [];
for (const r of readings) {
  if (seen.has(r.at)) continue; // quarter boundaries are inclusive at both ends
  seen.add(r.at);
  sql.push(`INSERT INTO rain_readings (station, at, day, inches, approval) VALUES (${[RAIN_STATION, r.at, rainDay(r.at), r.inches, r.approval].map(q).join(", ")}) ON CONFLICT (station, at) DO UPDATE SET inches = excluded.inches, approval = excluded.approval;`);
}
writeFileSync(OUT, sql.join("\n") + "\n");
const total = readings.filter((r, i, a) => a.findIndex((x) => x.at === r.at) === i).reduce((s, r) => s + r.inches, 0);
console.log(`${sql.length} readings, ${total.toFixed(2)} in total -> ${OUT}`);

if (process.argv.includes("--apply")) {
  execFileSync("npx", ["wrangler", "d1", "execute", "crosby-record", "--remote", "--file", OUT], { stdio: "inherit" });
} else {
  console.log(`Dry run. Apply with --apply.`);
}
