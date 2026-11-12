// /calendar key dates: which events count, how days merge into a break, and
// what the page says about the feed's range. Expected values are written out
// by hand.
//
// Run: node scripts/test-calendar-keys.mjs

import { createHarness } from "./lib/harness.mjs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SRC = new URL("../src/", import.meta.url).pathname;
const C = await import(pathToFileURL(join(SRC, "features/calendar.js")).href);

const failures = [];
const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (cond, what) => { if (!cond) failures.push(what); };

const day = (iso) => Date.parse(`${iso}T00:00:00Z`);
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const allDay = (iso, summary, endIso) => ({ summary, location: "", start: day(iso), allDay: true, end: endIso ? day(endIso) : null });
const NOW = Date.parse("2026-11-11T15:00:00Z"); // 9 AM CST, Nov 11

// --- classification -----------------------------------------------------------
eq(
  ["NO SCHOOL!", "NO SCHOOL- THANKSGIVING BREAK!", "Winter Break", "EARLY RELEASE!", "Early Dismissal", "End of Grading Period for Semester 1", "FIRST DAY OF SCHOOL!", "Last Day of School", "Student Holiday"].map(C.keyDateKind),
  ["noSchool", "noSchool", "noSchool", "earlyRelease", "earlyRelease", "gradingEnd", "firstDay", "lastDay", "noSchool"],
  "the patterns name each kind",
);
eq(
  ["NES 12 Days of Christmas", "CMS Dance Team Winter Field Trip", "Veteran's Day", "Texas Independence Day", "STAAR/EOC Test- MakeUps", "Spring Picture Day"].map(C.keyDateKind),
  [null, null, null, null, null, null],
  "look-alikes and observances are not key dates",
);

// --- days an event covers -------------------------------------------------------
eq(C.eventDays(allDay("2027-03-15", "Spring Break", "2027-03-20")).map(ymd), ["2027-03-15", "2027-03-16", "2027-03-17", "2027-03-18", "2027-03-19"], "an all-day DTEND is exclusive: Mar 15 → Mar 20 covers the 15th through the 19th");
eq(C.eventDays(allDay("2026-11-13", "NO SCHOOL!", "2026-11-14")).map(ymd), ["2026-11-13"], "a one-day event with its exclusive end is one day");
eq(C.eventDays(allDay("2026-11-13", "NO SCHOOL!")).map(ymd), ["2026-11-13"], "no end is one day");

// --- merging and naming ---------------------------------------------------------
const events = [
  allDay("2026-11-10", "NO SCHOOL!"), // yesterday: dropped
  allDay("2026-11-13", "NO SCHOOL!"),
  allDay("2026-11-20", "NO SCHOOL!"),
  ...["23", "24", "25", "26", "27"].map((d) => allDay(`2026-11-${d}`, "NO SCHOOL- THANKSGIVING BREAK!")),
  allDay("2026-12-17", "EARLY RELEASE!"),
  allDay("2026-12-17", "End of Grading Period for Semester 1"),
  allDay("2026-12-18", "NO SCHOOL-WINTER BREAK!"),
  allDay("2026-12-18", "Winter Break"),
  allDay("2026-12-19", "Winter Break", "2026-12-22"), // a multi-day event overlapping the daily ones
  allDay("2026-12-22", "NO SCHOOL-WINTER BREAK!"),
  allDay("2027-03-15", "Spring Break", "2027-03-20"),
  { summary: "EARLY RELEASE!", location: "", start: Date.parse("2027-01-15T12:30:00Z"), allDay: false, end: null },
];
const keys = C.keyDates(events, NOW).map((k) => [k.kind, ymd(k.from), ymd(k.to), k.name]);
eq(keys, [
  ["noSchool", "2026-11-13", "2026-11-13", null],
  ["noSchool", "2026-11-20", "2026-11-20", null],
  ["noSchool", "2026-11-23", "2026-11-27", "thanksgiving"],
  ["earlyRelease", "2026-12-17", "2026-12-17", null],
  ["gradingEnd", "2026-12-17", "2026-12-17", null],
  ["noSchool", "2026-12-18", "2026-12-22", "winter"],
  ["earlyRelease", "2027-01-15", "2027-01-15", null],
  ["noSchool", "2027-03-15", "2027-03-19", "spring"],
], "days merge into breaks only when consecutive, past days drop, duplicates collapse");
eq(C.keyDateText(C.keyDates(events, NOW)[2], "en"), { label: "Thanksgiving Break (no school)", when: "Mon, Nov 23, 2026 – Fri, Nov 27, 2026" }, "English range text");
eq(C.keyDateText(C.keyDates(events, NOW)[0], "es"), { label: "Sin clases", when: "vie, 13 de nov de 2026" }, "Spanish single-day text");

// --- on the page ----------------------------------------------------------------
const h = await createHarness();
for (const [path, accept, wants] of [
  ["/calendar", "text/html", ["<h2>Key dates</h2>", "<strong>Winter Break (no school):</strong> <time datetime=\"2026-12-18\">", "currently runs through"]],
  ["/es/calendar", "text/html", ["<h2>Fechas clave</h2>", "Vacaciones de Acción de Gracias (sin clases)"]],
  ["/calendar", "text/markdown", ["## Key dates", "- **Thanksgiving Break (no school):** Mon, Nov 23, 2026 – Fri, Nov 27, 2026"]],
]) {
  const body = await (await h.get(path, { headers: { accept } })).text();
  for (const w of wants) ok(body.includes(w), `${path} (${accept}): expected ${JSON.stringify(w)}`);
}

if (failures.length) {
  console.error(`\nCalendar key-date checks failed (${failures.length}):\n  ${failures.join("\n  ")}\n`);
  process.exit(1);
}
console.log("Calendar key dates OK — tested patterns only, exclusive all-day ends, breaks merged and named, past days dropped, both languages.");
process.exit(0);
