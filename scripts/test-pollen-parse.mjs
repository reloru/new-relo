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

import { pollenSlugDate, pollenNewestFromIndex, pollenMonth, parsePollenCount } from "../src/features/pollen.js";
// The pollen watchdog parses the same upstream HTML but must never share code
// with the selection it checks, so it lives outside src/ and is imported only
// here, to pin its text extraction in the same required CI job.
import { stripToText, advertisedDates } from "../.github/scripts/pollen-watch.mjs";

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

// The 2026-09-06 freeze: HHD dropped "count" from the slug on Sep 3, so the two
// newest days stopped matching a stem-anchored pattern while the older ones kept
// parsing — /pollen served Wednesday's count into Sunday.
//
// Every fixture above embeds `houston-pollen-mold-count`, which is exactly why
// this suite stayed green through that outage. These entries are the real hrefs
// from houstonhealth.org/services/pollen-mold on 2026-09-06, both stems on one
// page, plus the non-count links that share the section and must NOT be picked:
// the monthly archive spreadsheets, the section home, and a paginated link.
const STEM_CHANGE_FIXTURE = `
  <ul class="listing">
    <li><a href="/services/pollen-mold/houston-pollen-mold-friday-september-4-2026">Houston Pollen and Mold - Friday, September 4, 2026</a></li>
    <li><a href="/services/pollen-mold/houston-pollen-mold-thursday-september-3-2026">Houston Pollen and Mold - Thursday, September 3, 2026</a></li>
    <li><a href="/services/pollen-mold/houston-pollen-mold-count-wednesday-september-2-2026">Houston Pollen and Mold Count - Wednesday, September 2, 2026</a></li>
    <li><a href="/services/pollen-mold/houston-pollen-mold-count-tuesday-september-1-2026">Houston Pollen and Mold Count - Tuesday, September 1, 2026</a></li>
    <li><a href="/services/pollen-mold/houston-pollen-mold-count-monday-august-31-2026">Houston Pollen and Mold Count - Monday, August 31, 2026</a></li>
    <li><a href="/services/pollen-mold">Pollen &amp; Mold home</a></li>
    <li><a href="/services/pollen-mold?page=1">Next page</a></li>
    <li><a href="/media/14921/download?inline">pollen-count-archive-202608.xlsx</a></li>
  </ul>`;

console.log("\npollenNewestFromIndex — the 2026-09-06 slug-stem change (both stems on one index):");
const stemChange = pollenNewestFromIndex(STEM_CHANGE_FIXTURE);
check("the stemless newest wins over the older -count- entries", stemChange?.date, "2026-09-04");
check("...and returns its path", stemChange?.path, "/services/pollen-mold/houston-pollen-mold-friday-september-4-2026");

// Selection must not depend on the slug's words at all — only on living in the
// section and ending in a date. A stem nobody has seen yet still has to work,
// or this test is just re-pinning the shape that broke.
console.log("\npollenNewestFromIndex — an unseen future rename still parses:");
check(
  "a slug with no recognisable stem",
  pollenNewestFromIndex(`<a href="/services/pollen-mold/hhd-daily-aeroallergen-report-monday-september-7-2026">x</a>`)?.date,
  "2026-09-07",
);

// The section home, pagination and the archive spreadsheets carry no slug date,
// so pollenSlugDate discards them. Without that, a dateless link would be a
// candidate and the reduce would compare undefined.
console.log("\npollenNewestFromIndex — dateless links in the section are discarded:");
check(
  "section home + pagination + archive only",
  pollenNewestFromIndex(`
    <a href="/services/pollen-mold">home</a>
    <a href="/services/pollen-mold?page=2">Next</a>
    <a href="/media/14921/download?inline">archive.xlsx</a>`),
  null,
);

// parsePollenCount's species lists, against the markup HHD serves now. Drupal
// started stamping `data-list-item-id` on <li> without notice; a bare `<li>`
// match dropped every attributed entry, and because the section only renders
// when a group HAS species, "What's in the air" vanished from /pollen entirely
// rather than rendering empty. Counts and names below are the real Sep 4 page.
const COUNT_PAGE_FIXTURE = `
  <h3>Major tree pollen counted</h3>
  <div class="coh-wysiwyg"><ul>
    <li>Acer (Maple):&nbsp;0</li>
    <li>Betula (Birch): 0</li>
  </ul></div>
  <h3>Major weed pollen counted</h3>
  <div class="coh-wysiwyg"><ul>
    <li data-list-item-id="ed2e1671dd4be6f0c78c1b19f55461d18">Ambrosia (Ragweed):&nbsp;2</li>
    <li data-list-item-id="ecd6f06525fcc5b047b63b0b0d3c402fd">Amaranthaceae (Amaranth):&nbsp;0</li>
  </ul></div>
  <h3>Major mold spores counted</h3>
  <div class="coh-wysiwyg"><ul class="coh-list" data-block="1">
    <li data-list-item-id="e73b817e14480dd989a07fe2b94c4dda0">Algae:&nbsp;20</li>
    <li data-list-item-id="e2303ea63106aa9b755eb1c7defa2b3ec">Ascospores:&nbsp;6,123</li>
    <li data-list-item-id="e38fb25d2be2e3b93e719602b02ea92a1">Alternaria:&nbsp;4</li>
  </ul></div>`;

console.log("\nparsePollenCount — species lists whose markup carries attributes:");
const parsed = parsePollenCount(COUNT_PAGE_FIXTURE);
check("attributed <li> are read, not dropped", parsed.species.weed?.length, 1);
check("...and the genus name survives", parsed.species.weed?.[0]?.name, "Ambrosia (Ragweed)");
check("an attributed <ul> is found too", parsed.species.mold?.length, 3);
check("thousands separators parse", parsed.species.mold?.[0]?.count, 6123);
check("species sort by count, worst first", parsed.species.mold?.[0]?.name, "Ascospores");
check("bare <li> still parse (no regression)", parsed.species.tree?.length, 0);

// Zero-count genera are filtered deliberately: HHD lists the full panel every
// day, so without this the "what's in the air" block would be mostly zeros.
// Tree above is all zeros and must come back empty, NOT missing.
console.log("\nparsePollenCount — zero counts are filtered, not the section:");
check("an all-zero group yields an empty list", Array.isArray(parsed.species.tree), true);
check("...with nothing in it", parsed.species.tree?.length, 0);

// The watchdog's own text extraction. It lives outside src/ on purpose (it must
// not share code with the selection it checks), but it parses the same
// third-party HTML and needs the same pinning — CodeQL, not this suite, caught
// its first bug (js/incomplete-multi-character-sanitization, high, on #218).
//
// The failing case was NOT nesting: `<[^>]+>` needs a closing `>`, so an
// unterminated `<script` was never matched and passed through into a GitHub
// issue body verbatim.
console.log("\nstripToText — third-party anchor markup reduced to a plain label:");
check("tags are removed", stripToText("<b>Houston Pollen</b> - Friday"), "Houston Pollen - Friday");
check("&nbsp; becomes a space", stripToText("Friday,&nbsp;September&nbsp;4,&nbsp;2026"), "Friday, September 4, 2026");
check("an UNTERMINATED tag cannot survive", stripToText("Report <script src=x"), "Report script src=x");
check("no < survives at all", /[<>]/.test(stripToText("<a><<b>>x<script")), false);
check("nested markup leaves no tag", /[<>]/.test(stripToText("<div <span>>text</div>")), false);
check("a plain label is untouched", stripToText("Houston Pollen and Mold - Friday, September 4, 2026"), "Houston Pollen and Mold - Friday, September 4, 2026");

// The date must still parse out of markup-bearing text, or sanitizing would
// have quietly disabled the watchdog instead of hardening it.
console.log("\nadvertisedDates — a date still parses through the sanitizer:");
const dirty = advertisedDates(
  `<a href="/services/pollen-mold/houston-pollen-mold-friday-september-4-2026"><span>Houston Pollen and Mold - <b>Friday, September 4, 2026</b></span></a>`,
);
check("date survives nested markup", dirty[0]?.iso, "2026-09-04");
check("...and the label is clean", dirty[0]?.text, "Houston Pollen and Mold - Friday, September 4, 2026");

// The watchdog's SCOPE, and the projection exclusion that scope requires.
//
// Until 2026-09-17 advertisedDates() matched only hrefs under
// /services/pollen-mold/ — the same assumption pollenNewestFromIndex() makes,
// which meant the check could not falsify the very thing it exists to check.
// HHD then published
//   /houston-pollen-mold-projected-count-thursday-september-17-2026
// at the ROOT. Harmless in that instance (a projection, correctly ignored), but
// proof HHD publishes pollen pages off the section path — the exact cause the
// filed issue tells a reader to look for.
//
// Widening the scope makes the projection exclusion load-bearing rather than
// cosmetic: without it, a projection dated ahead of the newest measured count
// reports a missed count every time HHD posts one.
const ROOT_MEASURED = `
  <a href="/houston-pollen-mold-count-thursday-september-17-2026">Houston Pollen and Mold Count - Thursday, September 17, 2026</a>
  <a href="/services/pollen-mold/houston-pollen-mold-count-wednesday-september-16-2026">Houston Pollen and Mold Count - Wednesday, September 16, 2026</a>`;

console.log("\nadvertisedDates — a measured count OFF the section path is still seen:");
const rootSeen = advertisedDates(ROOT_MEASURED);
check("the root-level measured count is picked up", rootSeen[0]?.iso, "2026-09-17");
check("...from a root href", rootSeen[0]?.href, "/houston-pollen-mold-count-thursday-september-17-2026");
// The pre-fix pattern, inlined: proves the fixture discriminates rather than
// just passing. A section-scoped match sees only the older in-section entry.
const OLD_SCOPE = [...ROOT_MEASURED.matchAll(/<a\s[^>]*href="(\/services\/pollen-mold\/[^"#?]*)"[^>]*>/gi)];
check("the OLD section-scoped pattern missed it", OLD_SCOPE.length, 1);

const PROJECTED_INDEX = `
  <a href="/houston-pollen-mold-projected-count-thursday-september-17-2026">Houston Pollen and Mold Projected Count - Thursday, September 17, 2026</a>
  <a href="/services/pollen-mold/houston-pollen-mold-count-wednesday-september-16-2026">Houston Pollen and Mold Count - Wednesday, September 16, 2026</a>`;

console.log("\nadvertisedDates — a PROJECTED count is never advertised as measured:");
const proj = advertisedDates(PROJECTED_INDEX);
check("only the measured entry survives", proj.length, 1);
check("...and it is the measured date", proj[0]?.iso, "2026-09-16");
// Excluded on either signal, since HHD has put "Projected" in both.
check("excluded by link text alone", advertisedDates(`<a href="/services/pollen-mold/x-september-17-2026">Projected Count - Thursday, September 17, 2026</a>`).length, 0);
check("excluded by href alone", advertisedDates(`<a href="/pollen-mold-projected-x">Count - Thursday, September 17, 2026</a>`).length, 0);

// A projection dated AHEAD of the newest measured count is the live case as of
// 2026-09-17, and reporting it would be a false "missed count" — /pollen is the
// measured number and must not chase a forecast.
console.log("\nadvertisedDates — a projection dated ahead does not mask the measured newest:");
const newestAdvertised = proj.reduce((a, b) => (b.iso > a.iso ? b : a));
check("newest advertised is the measured count", newestAdvertised.iso, "2026-09-16");
check("...not the later projection", newestAdvertised.iso === "2026-09-17", false);

console.log(
  failures
    ? `\n${failures} pollen parse check(s) FAILED\n`
    : `\nPollen parsing OK — slug shape ignored, attributed markup read, newest wins.\n`,
);
process.exit(failures ? 1 : 0);
