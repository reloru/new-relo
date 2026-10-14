// UV "peak today" across EPA's evening rollover.
//
// Why this file exists: EPA's hourly UV product is one forecast day (6 AM–6 PM)
// plus the previous evening, and it rolls to the next day around 7 PM CT. From
// then until midnight a fresh fetch carries none of today's daytime hours. A
// plain max over what was left reported "peak today: 0 (Low)" every night; the
// first fix turned that into null ("unknown") every night instead. The cron now
// carries today's rows forward from the previous snapshot (carryUvToday), so the
// real peak lasts until midnight, and the homepage switches to tomorrow's peak
// the same way its High row switches to "High tomorrow".
//
// NOON_OCT14 is the REAL product as served at 06:10 CDT on 2026-10-14, verbatim
// — the snapshot the cron holds during the day. ROLLED_OCT14 is the same rows
// with every date moved forward one day: the shape EPA serves after the Oct 14
// rollover (Oct 15 daytime + Oct 14 evening), with values copied, not observed.
//
// Run: node scripts/test-uv-peak.mjs

import { uvPeakToday, uvPeakOn, uvCurrent, carryUvToday } from "../src/features/air.js";
import { todayGlance } from "../src/features/home.js";

let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`}`);
};

const ROWS = [
  ["2026-10-14", 6, 0], ["2026-10-14", 7, 0], ["2026-10-14", 8, 0], ["2026-10-14", 9, 1],
  ["2026-10-14", 10, 2], ["2026-10-14", 11, 4], ["2026-10-14", 12, 6], ["2026-10-14", 13, 7],
  ["2026-10-14", 14, 7], ["2026-10-14", 15, 6], ["2026-10-14", 16, 4], ["2026-10-14", 17, 2],
  ["2026-10-14", 18, 0], ["2026-10-13", 19, 0], ["2026-10-13", 20, 0], ["2026-10-13", 21, 0],
  ["2026-10-13", 22, 0], ["2026-10-13", 23, 0], ["2026-10-14", 0, 0], ["2026-10-14", 1, 0],
  ["2026-10-14", 2, 0],
];
const uvOf = (rows) => ({ hourly: rows.map(([date, hour, value]) => ({ date, hour, value })) });
const nextDay = (d) => new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
const NOON_OCT14 = uvOf(ROWS);
const ROLLED_OCT14 = uvOf(ROWS.map(([d, h, v]) => [nextDay(d), h, v]));

const realNow = Date.now;
const at = (iso, fn) => {
  Date.now = () => Date.parse(iso);
  try { return fn(); } finally { Date.now = realNow; }
};
const NIGHT = "2026-10-14T23:00:00-05:00";

console.log("\nuvPeakToday — the forecast day reports its real peak:");
check("06:10 Oct 14 → 7", at("2026-10-14T06:10:00-05:00", () => uvPeakToday({ uv: NOON_OCT14 })), 7);
check("2 PM Oct 14 → 7", at("2026-10-14T14:00:00-05:00", () => uvPeakToday({ uv: NOON_OCT14 })), 7);

console.log("\nAfter the rollover, with the previous snapshot carried — today's real peak, not 0 or null:");
const carried = at(NIGHT, () => carryUvToday(ROLLED_OCT14, NOON_OCT14));
check("11 PM Oct 14: peak today → 7", at(NIGHT, () => uvPeakToday({ uv: carried })), 7);
check("...while the current hour still reads its real 0", at(NIGHT, () => uvCurrent({ uv: carried })), 0);
const keys = carried.hourly.map((e) => `${e.date} ${e.hour}`);
check("no duplicate (date, hour) rows", keys.length, new Set(keys).size);
check("no rows from Oct 13 carried", carried.hourly.some((e) => e.date === "2026-10-13"), false);
check("carrying again at a later tick keeps the peak", at(NIGHT, () => uvPeakToday({ uv: carryUvToday(ROLLED_OCT14, carried) })), 7);
const overlap = at(NIGHT, () => carryUvToday(uvOf([["2026-10-14", 13, 5], ["2026-10-14", 12, 5]]), NOON_OCT14));
check("fresh rows win on overlap", at(NIGHT, () => uvPeakToday({ uv: overlap })), 7);
check("...and the stale 13:00 value is not duplicated", overlap.hourly.filter((e) => e.date === "2026-10-14" && e.hour === 13).map((e) => e.value), [5]);

console.log("\nThe carry ends at midnight:");
const afterMidnight = at("2026-10-15T00:30:00-05:00", () => carryUvToday(ROLLED_OCT14, carried));
check("00:30 Oct 15: no Oct 14 rows kept", afterMidnight.hourly.some((e) => e.date === "2026-10-14" && e.hour < 19), false);
check("00:30 Oct 15: peak today is Oct 15's → 7", at("2026-10-15T00:30:00-05:00", () => uvPeakToday({ uv: afterMidnight })), 7);

console.log("\nWithout a previous snapshot (cold cache after the rollover) — null, never 0:");
check("11 PM Oct 14: rolled product alone → null", at(NIGHT, () => uvPeakToday({ uv: ROLLED_OCT14 })), null);
check("failed fetch is not replaced by the old snapshot", at(NIGHT, () => carryUvToday(null, NOON_OCT14)), null);
check("missing uv → null", uvPeakToday({}), null);
check("tomorrow's peak is available from the rolled product", uvPeakOn({ uv: ROLLED_OCT14 }, "2026-10-15"), 7);

console.log("\nHomepage glance — UV follows the High row:");
const uvRow = (uv, periods, iso, lang = "en") =>
  at(iso, () => todayGlance({ hourly: [], periods, uv }, lang).today.find(([l]) => /UV/.test(l)) ?? null);
const DAY_OCT14 = [{ isDaytime: true, startTime: "2026-10-14T06:00:00-05:00", temperature: 86 }, { isDaytime: false, startTime: "2026-10-14T18:00:00-05:00", temperature: 66 }];
const EVE_OCT14 = [{ isDaytime: false, startTime: "2026-10-14T18:00:00-05:00", temperature: 66 }, { isDaytime: true, startTime: "2026-10-15T06:00:00-05:00", temperature: 84 }];
check("2 PM Oct 14 → UV index 7 (High)", uvRow(NOON_OCT14, DAY_OCT14, "2026-10-14T14:00:00-05:00"), ["UV index", "7 (High)"]);
check("11 PM Oct 14 → UV tomorrow 7 (High)", uvRow(carried, EVE_OCT14, NIGHT), ["UV tomorrow", "7 (High)"]);
check("11 PM Oct 14, es → UV mañana 7 (Alto)", uvRow(carried, EVE_OCT14, NIGHT, "es"), ["UV mañana", "7 (Alto)"]);
check("evening before EPA has tomorrow → row hidden", uvRow(NOON_OCT14, EVE_OCT14, "2026-10-14T18:30:00-05:00"), null);

console.log(failed ? `\n${failed} UV peak check(s) FAILED\n` : "\nUV peak OK — today's real peak survives the evening rollover, never 0 or null.\n");
process.exit(failed ? 1 : 0);
