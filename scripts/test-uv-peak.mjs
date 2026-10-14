// UV "peak today" across EPA's evening rollover.
//
// Why this file exists: EPA's hourly UV product is one forecast day (6 AM–6 PM)
// plus the previous evening, and it rolls to the next day around 7 PM CT. From
// then until midnight, today's only rows are its zero-UV evening hours, and a
// plain max over them reported "peak today: 0 (Low)" on /api/weather and the MCP
// conditions tool every night, for days that peaked at 7. A cheerful green: the
// value is well-formed, the endpoint answers 200, and only the number is false.
//
// The fixture is the REAL product as served at 06:10 CDT on 2026-10-14,
// verbatim. Evaluated at 11 PM Oct 13 it is exactly the rolled state.
//
// Run: node scripts/test-uv-peak.mjs

import { uvPeakToday, uvCurrent } from "../src/features/air.js";

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
const data = { uv: { hourly: ROWS.map(([date, hour, value]) => ({ date, hour, value })) } };

const realNow = Date.now;
const at = (iso, fn) => {
  Date.now = () => Date.parse(iso);
  try { return fn(); } finally { Date.now = realNow; }
};

console.log("\nuvPeakToday — after the rollover, today's peak is unknown, not 0:");
check("11 PM Oct 13: rolled product → null", at("2026-10-13T23:00:00-05:00", () => uvPeakToday(data)), null);
check("...while the current hour still reads its real 0", at("2026-10-13T23:00:00-05:00", () => uvCurrent(data)), 0);

console.log("\nuvPeakToday — the forecast day still reports its real peak:");
check("06:10 Oct 14 → 7", at("2026-10-14T06:10:00-05:00", () => uvPeakToday(data)), 7);
check("2 PM Oct 14 → 7", at("2026-10-14T14:00:00-05:00", () => uvPeakToday(data)), 7);

console.log("\nuvPeakToday — no data stays null:");
check("missing uv → null", uvPeakToday({}), null);

console.log(failed ? `\n${failed} UV peak check(s) FAILED\n` : "\nUV peak OK — the evening rollover reads as unknown, never as 0.\n");
process.exit(failed ? 1 : 0);
