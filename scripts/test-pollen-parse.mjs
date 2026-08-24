// Pin the contract for how we read HHD's pollen index.
//
// This exists because of a real, three-day production failure. On 2026-08-03
// the Houston Health Department changed the SHAPE of its count URLs — the slug
// lost the hyphen between day and year ("...-august-52026") and some days moved
// to a capitalized "/Services/" path. Two strict patterns in fetchPollen() each
// stopped matching, and /pollen served the July 31 count until 2026-08-05.
//
// The reason it needs a test rather than care is that NOTHING GOES WRONG when
// it breaks. The index fetches fine, an older slug still matches, that page
// still parses into four valid groups, the KV entry is rewritten on schedule,
// and the page renders a real, correctly-labelled count. It simply stops
// advancing. There is no exception to catch and no status code to alarm on; the
// only observable is that a date stops moving, which is exactly what a human is
// bad at noticing. (/api/health's `dataChangedAt` reports that stalled date
// after the fact — this test is what keeps it from happening.)
//
// So: pin the parsing, and pin it against the formats HHD has actually served.
// Pure string work, no network — the point is to fix the contract, not to
// monitor the upstream.
//
// Run: node scripts/test-pollen-parse.mjs

import { pollenSlugDate, pollenNewestFromIndex, pollenMonth } from "../src/features/pollen.js";

let failures = 0;
const check = (label, got, want) => {
  if (got === want) {
    console.log(`  PASS  ${label} → ${got}`);
  } else {
    failures++;
    console.log(`  FAIL  ${label} → got ${got}, want ${want}`);
  }
};

const SLUG = "/services/pollen-mold/houston-pollen-mold-count";

console.log("\npollenSlugDate — both URL formats HHD has served:");

// The format published through 2026-07-31.
check("thursday-july-30-2026 (hyphenated)", pollenSlugDate(`${SLUG}-thursday-july-30-2026`), "2026-07-30");
check("friday-july-31-2026 (hyphenated)", pollenSlugDate(`${SLUG}-friday-july-31-2026`), "2026-07-31");

// The format published from 2026-08-03: no day-year separator. Each of these
// parsed as null before the fix, which is what froze the page.
check("monday-august-32026 (no separator)", pollenSlugDate(`${SLUG}-monday-august-32026`), "2026-08-03");
check("tuesday-august-42026 (no separator)", pollenSlugDate(`${SLUG}-tuesday-august-42026`), "2026-08-04");
check("wednesday-august-52026 (no separator)", pollenSlugDate(`${SLUG}-wednesday-august-52026`), "2026-08-05");

// The ambiguity the no-separator format creates: "122026" could split as day 1
// + year 22026, or day 12 + year 2026. `\d{1,2}` is greedy, so the two-digit
// day wins; on a one-digit day it backtracks because `\d{4}` cannot otherwise
// be satisfied. Both branches are asserted because a "simplification" to
// `\d{1}` or a non-greedy `\d{1,2}?` would silently break one of them.
console.log("\npollenSlugDate — greedy/backtracking split on the joined form:");
check("december-122026 (two-digit day)", pollenSlugDate(`${SLUG}-friday-december-122026`), "2026-12-12");
check("december-92026 (one-digit day)", pollenSlugDate(`${SLUG}-wednesday-december-92026`), "2026-12-09");
check("january-12027 (year rollover)", pollenSlugDate(`${SLUG}-friday-january-12027`), "2027-01-01");

// The THIRD shape, observed live 2026-08-24: an abbreviated month. HHD served
// "-friday-august-212026" and "-monday-aug-242026" in the same week, from the
// same index. The exact-name lookup dropped the abbreviated one, so the newest
// entry was invisible and /pollen served Friday's count into Monday evening —
// the same silent freeze as 2026-08-03, with a different trigger.
console.log("\npollenSlugDate — abbreviated months (the 2026-08-24 freeze):");
check("monday-aug-242026 (the real slug)", pollenSlugDate(`${SLUG}-monday-aug-242026`), "2026-08-24");
check("sept abbreviation", pollenSlugDate(`${SLUG}-tuesday-sept-12026`), "2026-09-01");
check("three-letter, hyphenated day", pollenSlugDate(`${SLUG}-monday-dec-7-2026`), "2026-12-07");
check("full name still parses", pollenSlugDate(`${SLUG}-friday-august-212026`), "2026-08-21");

// The contract, not the mechanism: a prefix that does not identify exactly one
// month must yield NO date. A wrong month would date a stale count as current,
// which is worse than showing none.
//
// pollenMonth enforces this twice over — a three-character floor, and a
// uniqueness check — and the two are deliberately redundant, so removing
// EITHER alone still satisfies every assertion below. That is the point: the
// guards cover for each other, and what is pinned here is the observable
// behaviour, which is what callers depend on.
console.log("\npollenMonth — resolves an abbreviation, never guesses:");
check("'aug' resolves", pollenMonth("aug"), 8);
check("'sept' resolves", pollenMonth("sept"), 9);
check("full name still resolves", pollenMonth("august"), 8);
check("'AUG' is case-insensitive", pollenMonth("AUG"), 8);
check("'ju' (june or july) yields nothing", pollenMonth("ju"), null);
check("'ma' (march or may) yields nothing", pollenMonth("ma"), null);
check("'j' alone yields nothing", pollenMonth("j"), null);
check("a non-month yields nothing", pollenMonth("notamonth"), null);

console.log("\npollenSlugDate — an ambiguous prefix produces no date:");
check("'ju' (june or july)", pollenSlugDate(`${SLUG}-monday-ju-242026`), null);
check("'ma' (march or may)", pollenSlugDate(`${SLUG}-monday-ma-242026`), null);
check("'j' alone", pollenSlugDate(`${SLUG}-monday-j-242026`), null);

console.log("\npollenSlugDate — non-dates stay null (never guess a date):");
check("index path itself", pollenSlugDate("/services/pollen-mold"), null);
check("unknown month name", pollenSlugDate(`${SLUG}-monday-notamonth-52026`), null);
check("no date at all", pollenSlugDate(`${SLUG}-latest`), null);

// The composed selection, against an index carrying BOTH path casings and BOTH
// slug formats — which is what houstonhealth.org actually served on 2026-08-05.
//
// This is the assertion that would have caught the bug. Testing the date parser
// alone would not have: fixing only the separator still leaves the two
// capitalized August days invisible, and the newest parseable entry becomes
// Aug 3 — wrong, but plausible enough to pass a careless eye.
const INDEX_FIXTURE = `
  <ul class="listing">
    <li><a href="/Services/pollen-mold/houston-pollen-mold-count-wednesday-august-52026">Aug 5</a></li>
    <li><a href="/Services/pollen-mold/houston-pollen-mold-count-tuesday-august-42026">Aug 4</a></li>
    <li><a href="/services/pollen-mold/houston-pollen-mold-count-monday-august-32026">Aug 3</a></li>
    <li><a href="/services/pollen-mold/houston-pollen-mold-count-friday-july-31-2026">Jul 31</a></li>
    <li><a href="/services/pollen-mold/houston-pollen-mold-count-thursday-july-30-2026">Jul 30</a></li>
    <li><a href="/services/pollen-mold">Pollen &amp; Mold home</a></li>
  </ul>`;

console.log("\npollenNewestFromIndex — mixed casings and mixed formats on one page:");
const newest = pollenNewestFromIndex(INDEX_FIXTURE);
check("newest date", newest?.date, "2026-08-05");
check("newest path (capitalized /Services/)", newest?.path, "/Services/pollen-mold/houston-pollen-mold-count-wednesday-august-52026");

// The same assertion for the abbreviated-month freeze, against the index
// houstonhealth.org actually served on 2026-08-24. This is the one that
// matters: with only the parser fixed in isolation you can still convince
// yourself it works, because the full-name entries all parse and the newest
// parseable one (Friday) is a real, correctly-labelled count — just three
// days old. The composed call is what proves the ABBREVIATED entry wins.
const ABBREV_FIXTURE = `
  <ul class="listing">
    <li><a href="/Services/pollen-mold/houston-pollen-mold-count-monday-aug-242026">Aug 24</a></li>
    <li><a href="/Services/pollen-mold/houston-pollen-mold-count-friday-august-212026">Aug 21</a></li>
    <li><a href="/Services/pollen-mold/houston-pollen-mold-count-thursday-august-202026">Aug 20</a></li>
    <li><a href="/services/pollen-mold/houston-pollen-mold-count-tuesday-august-18-2026">Aug 18</a></li>
  </ul>`;

console.log("\npollenNewestFromIndex — abbreviated and full months on one index:");
const abbrev = pollenNewestFromIndex(ABBREV_FIXTURE);
check("abbreviated newest wins over full-name older", abbrev?.date, "2026-08-24");
check("...and returns its path", abbrev?.path, "/Services/pollen-mold/houston-pollen-mold-count-monday-aug-242026");

// Order must not matter — the reduce picks by date, not document position.
console.log("\npollenNewestFromIndex — selection is by date, not page order:");
const reversed = INDEX_FIXTURE.split("\n").reverse().join("\n");
check("newest from reversed index", pollenNewestFromIndex(reversed)?.date, "2026-08-05");

// An index with no parseable count pages returns null so fetchPollen() can
// throw and the cron aborts without writing, leaving the last good count.
console.log("\npollenNewestFromIndex — nothing parseable returns null (so fetchPollen throws):");
check("no count links", pollenNewestFromIndex(`<a href="/services/pollen-mold">home</a>`), null);
check("empty document", pollenNewestFromIndex(""), null);

console.log(
  failures
    ? `\n${failures} pollen parse check(s) FAILED\n`
    : `\nPollen parsing OK — both URL formats, both path casings, newest wins.\n`,
);
process.exit(failures ? 1 : 0);
